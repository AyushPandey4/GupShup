const nodemailer = require("nodemailer");
const logger = require("./logger");

// Validate environment variables on startup
const requiredEnvVars = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "FRONTEND_URL",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Create reusable transporter object
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Better connection handling
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  connectionTimeout: 10000, // 10 seconds
  socketTimeout: 30000, // 30 seconds
});

// Email templates
const templates = {
  resetPassword: (resetUrl) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #333;">Password Reset Request</h1>
      <p style="font-size: 16px; color: #555;">
        You requested to reset your password. Click the button below to proceed:
      </p>
      <div style="text-align: center; margin: 25px 0;">
        <a href="${resetUrl}" 
           style="background-color: #4CAF50; color: white; 
                  padding: 12px 24px; text-decoration: none; 
                  border-radius: 4px; font-weight: bold;">
          Reset Password
        </a>
      </div>
      <p style="font-size: 14px; color: #888;">
        This link will expire in 1 hour. If you didn't request this, 
        please ignore this email or contact support if you have concerns.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #aaa;">
        For security reasons, please do not share this email with anyone.
      </p>
    </div>
  `,
};

const sendResetPasswordEmail = async (email, token) => {
  try {
    // Validate inputs
    if (!email || !token) {
      throw new Error("Email and token are required");
    }

    const resetUrl = new URL(
      `/auth/reset-password?token=${encodeURIComponent(token)}`,
      process.env.FRONTEND_URL
    ).toString();

    const mailOptions = {
      from: `"GupShap Support" <${process.env.SMTP_FROM}>`,
      to: email,
      subject: "Reset Your GupShap Password",
      html: templates.resetPassword(resetUrl),
      text: `To reset your password, visit this link: ${resetUrl}\n\nThis link expires in 1 hour.`,
      // Email headers for better deliverability
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        Importance: "high",
      },
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Password reset email sent to ${email}: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error(`Failed to send password reset email to ${email}:`, error);
    throw new Error("Failed to send password reset email");
  }
};

module.exports = {
  sendResetPasswordEmail,
};
