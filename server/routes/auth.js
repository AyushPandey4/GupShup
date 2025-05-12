const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const { sendResetPasswordEmail } = require("../utils/email");
const auth = require("../middleware/auth");
const { body, validationResult } = require("express-validator");
const axios = require("axios");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Common response function
const sendAuthResponse = (res, user) => {
  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  return res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      username: user.username,
      profilePicture: user.profilePicture,
    },
  });
};

// Generate unique username helper
const generateUniqueUsername = async (email) => {
  const baseUsername = email
    .split("@")[0]
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
  let username = baseUsername;
  let exists = await User.exists({ username });

  if (!exists) return username;

  // Find the highest numbered duplicate
  const similarUsers = await User.find({
    username: new RegExp(`^${baseUsername}[0-9]*$`),
  })
    .sort({ username: -1 })
    .limit(1);

  if (similarUsers.length === 0) {
    return `${baseUsername}1`;
  }

  const lastNumber = similarUsers[0].username.match(/\d+$/);
  const nextNumber = lastNumber ? parseInt(lastNumber[0]) + 1 : 1;
  return `${baseUsername}${nextNumber}`;
};

// Register
router.post(
  "/register",
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, email, password } = req.body;

      if (await User.exists({ email })) {
        return res.status(409).json({ error: "User already exists" });
      }

      const username = await generateUniqueUsername(email);
      const user = new User({ name, email, username, password });

      await user.save();
      sendAuthResponse(res, user);
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed. Please try again." });
    }
  }
);

// Login
router.post(
  "/login",
  [body("email").isEmail().normalizeEmail(), body("password").exists()],
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });

      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      sendAuthResponse(res, user);
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  }
);

// Google OAuth
router.post("/google", async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: "Access token is required" });
    }

    // Get user info from Google
    const response = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const { name, email, picture, sub: googleId } = response.data;

    // Find or create user
    let user = await User.findOne({ email });

    if (!user) {
      const username = await generateUniqueUsername(email);
      user = new User({
        name,
        email,
        username,
        googleId,
        profilePicture: picture,
        isVerified: true,
      });
      await user.save();
    }

    sendAuthResponse(res, user);
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(401).json({ error: "Google authentication failed" });
  }
});

// Forgot password
router.post(
  "/forgot-password",
  body("email").isEmail().normalizeEmail(),
  async (req, res) => {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });

      if (!user) {
        // Don't reveal whether user exists for security
        return res.json({
          message: "If the email exists, a reset link has been sent",
        });
      }

      const resetToken = jwt.sign(
        { userId: user._id },
        process.env.JWT_SECRET,
        {
          expiresIn: "1h",
        }
      );

      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = Date.now() + 3600000;
      await user.save();

      await sendResetPasswordEmail(user.email, resetToken);
      res.json({ message: "Password reset email sent" });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ error: "Password reset failed" });
    }
  }
);

// Reset password
router.post(
  "/reset-password",
  [body("token").exists(), body("password").isLength({ min: 6 })],
  async (req, res) => {
    try {
      const { token, password } = req.body;
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await User.findOne({
        _id: decoded.userId,
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: Date.now() },
      });

      if (!user) {
        return res.status(400).json({ error: "Invalid or expired token" });
      }

      user.password = password;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      res.json({ message: "Password reset successful" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(400).json({ error: "Password reset failed" });
    }
  }
);

// Update username
router.put(
  "/username",
  auth,
  [
    body("username")
      .trim()
      .isLength({ min: 3 })
      .withMessage("Username must be at least 3 characters")
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage(
        "Username can only contain letters, numbers and underscores"
      ),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username } = req.body;

      if (await User.exists({ username })) {
        return res.status(409).json({ error: "Username already taken" });
      }

      const user = await User.findByIdAndUpdate(
        req.user.userId,
        { username },
        { new: true, runValidators: true }
      ).select("-password");

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(user);
    } catch (error) {
      console.error("Update username error:", error);
      res.status(500).json({ error: "Username update failed" });
    }
  }
);

module.exports = router;
