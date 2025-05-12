const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const { uploadToCloudinary } = require('../utils/cloudinary');
const multer = require('multer');
const { body, param, validationResult, query } = require('express-validator');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Cache control middleware
const cacheControl = (req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  next();
};

// Get user profile
router.get('/profile', auth, cacheControl, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('-password -__v')
      .populate('contacts', 'name username profilePicture status lastSeen');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch profile',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update profile
router.put(
  '/profile',
  auth,
  upload.single('profilePicture'),
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Name must be between 2-50 characters'),
    body('username')
      .optional()
      .trim()
      .isLength({ min: 3, max: 20 })
      .withMessage('Username must be between 3-20 characters')
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage('Username can only contain letters, numbers, and underscores')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const updateData = {};
      if (req.body.name) updateData.name = req.body.name;
      if (req.body.username) updateData.username = req.body.username;

      if (req.file) {
        const result = await uploadToCloudinary(req.file);
        updateData.profilePicture = result.secure_url;
        updateData.profilePicturePublicId = result.public_id;
      }

      const user = await User.findByIdAndUpdate(
        req.user.userId,
        { $set: updateData },
        { new: true, runValidators: true }
      ).select('-password -__v');

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(user);
    } catch (error) {
      console.error('Update profile error:', error);
      const status = error.name === 'ValidationError' ? 400 : 500;
      res.status(status).json({ 
        error: 'Profile update failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Search users
router.get(
  '/search',
  auth,
  [
    query('query')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Search query must be at least 2 characters')
      .escape()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { query } = req.query;
      const users = await User.find({
        $or: [
          { username: new RegExp(query, 'i') },
          { name: new RegExp(query, 'i') }
        ],
        _id: { $ne: req.user.userId }
      })
      .select('name username profilePicture status lastSeen')
      .limit(20)
      .lean(); // Use lean() for read-only operations

      // Cache results in Redis if available
      if (req.redisClient) {
        await req.redisClient.setEx(
          `userSearch:${query}`,
          3600, // 1 hour cache
          JSON.stringify(users)
        );
      }

      res.json(users);
    } catch (error) {
      console.error('Search users error:', error);
      res.status(500).json({ 
        error: 'Search failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Add contact
router.post(
  '/contacts/:userId',
  auth,
  [
    param('userId')
      .isMongoId()
      .withMessage('Invalid user ID format')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const [user, contact] = await Promise.all([
        User.findById(req.user.userId),
        User.findById(req.params.userId)
      ]);

      if (!contact) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.contacts.includes(contact._id)) {
        return res.status(409).json({ error: 'Contact already exists' });
      }

      // Add to both users' contact lists for mutual contacts
      await Promise.all([
        User.findByIdAndUpdate(
          req.user.userId,
          { $addToSet: { contacts: contact._id } },
          { new: true }
        ).populate('contacts', 'name username profilePicture status lastSeen'),
        
        // Optional: For mutual contacts, add both ways
        // User.findByIdAndUpdate(
        //   contact._id,
        //   { $addToSet: { contacts: req.user.userId } }
        // )
      ]);

      const updatedUser = await User.findById(req.user.userId)
        .populate('contacts', 'name username profilePicture status lastSeen');

      res.json(updatedUser);
    } catch (error) {
      console.error('Add contact error:', error);
      res.status(500).json({ 
        error: 'Failed to add contact',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Remove contact
router.delete(
  '/contacts/:userId',
  auth,
  [
    param('userId')
      .isMongoId()
      .withMessage('Invalid user ID format')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const user = await User.findByIdAndUpdate(
        req.user.userId,
        { $pull: { contacts: req.params.userId } },
        { new: true }
      ).populate('contacts', 'name username profilePicture status lastSeen');

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(user);
    } catch (error) {
      console.error('Remove contact error:', error);
      res.status(500).json({ 
        error: 'Failed to remove contact',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

module.exports = router;