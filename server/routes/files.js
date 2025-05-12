const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');
const auth = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');

// Configure multer with file type filtering
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      // Images
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      // Videos
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'video/x-msvideo',
      // Audio
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/aac',
      // Documents
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Text files
      'text/plain',
      'text/rtf',
      'text/markdown',
      // Code files
      'text/javascript',
      'text/css',
      'text/html',
      'application/json',
      // Compressed files
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      console.log('Rejected file type:', file.mimetype);
      cb(new Error(`File type not allowed: ${file.mimetype}`), false);
    }
  }
});

// Upload file with validation
router.post(
  '/upload',
  auth,
  upload.single('file'),
  [
    body('file').custom((value, { req }) => {
      if (!req.file) {
        throw new Error('No file provided');
      }
      return true;
    })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      console.log('Processing file upload:', {
        name: req.file.originalname,
        type: req.file.mimetype,
        size: `${(req.file.size / (1024 * 1024)).toFixed(2)}MB`
      });

      const result = await uploadToCloudinary(req.file, {
        folder: 'gup-shap',
        resource_type: 'auto',
        quality: 'auto',
        fetch_format: 'auto'
      });

      console.log('Cloudinary upload result:', {
        url: result.secure_url,
        type: result.resource_type,
        format: result.format,
        size: `${(result.bytes / (1024 * 1024)).toFixed(2)}MB`
      });

      res.json({
        success: true,
        url: result.secure_url,
        publicId: result.public_id,
        fileType: req.file.mimetype,
        resourceType: result.resource_type,
        format: result.format,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        originalName: req.file.originalname
      });

    } catch (error) {
      console.error('File upload error:', error);
      
      const statusCode = error.message.includes('File too large') || 
                        error.message.includes('File type not allowed') ? 
                        400 : 500;
      
      res.status(statusCode).json({ 
        success: false,
        error: error.message.includes('File too large') ? 
          'File size exceeds 50MB limit' :
          error.message.includes('File type not allowed') ?
          error.message :
          'File upload failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Delete file with validation
router.delete(
  '/:publicId',
  auth,
  [
    param('publicId')
      .notEmpty()
      .withMessage('Public ID is required')
      .isString()
      .withMessage('Invalid Public ID format')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { publicId } = req.params;
      const result = await deleteFromCloudinary(publicId);

      if (result.result === 'not found') {
        return res.status(404).json({ 
          success: false,
          error: 'File not found' 
        });
      }

      res.json({ 
        success: true,
        message: 'File deleted successfully',
        result
      });

    } catch (error) {
      console.error('File delete error:', error);
      
      const statusCode = error.message.includes('Invalid') ? 400 : 500;
      
      res.status(statusCode).json({ 
        success: false,
        error: error.message.includes('Invalid') ?
          'Invalid Public ID' :
          'Failed to delete file'
      });
    }
  }
);

module.exports = router;