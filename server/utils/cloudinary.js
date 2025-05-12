const cloudinary = require('cloudinary').v2;
const logger = require('./logger'); // Optional: for better logging

// Log configuration details (without sensitive info)
console.log('Cloudinary configuration status:', {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME ? 'Configured' : 'Missing',
  apiKey: process.env.CLOUDINARY_API_KEY ? 'Configured' : 'Missing',
  apiSecret: process.env.CLOUDINARY_API_SECRET ? 'Configured' : 'Missing'
});

// Validate configuration
if (!process.env.CLOUDINARY_CLOUD_NAME || 
    !process.env.CLOUDINARY_API_KEY || 
    !process.env.CLOUDINARY_API_SECRET) {
  console.error('⚠️ WARNING: Cloudinary configuration missing, file uploads will fail!');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true // Always use HTTPS
});

const uploadToCloudinary = async (file, options = {}) => {
  try {
    // Validate input
    if (!file || !file.buffer) {
      console.error('Invalid file object:', file);
      throw new Error('Invalid file object');
    }

    console.log('Preparing to upload file:', {
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });

    // Convert buffer to base64
    const b64 = Buffer.from(file.buffer).toString('base64');
    const dataURI = `data:${file.mimetype};base64,${b64}`;
    
    // Upload with default options + any custom options
    const uploadOptions = {
      resource_type: 'auto',
      folder: 'chat_app',
      quality: 'auto',
      fetch_format: 'auto',
      ...options
    };

    console.log('Uploading to Cloudinary with options:', {
      resource_type: uploadOptions.resource_type,
      folder: uploadOptions.folder
    });

    // Perform the upload
    const result = await cloudinary.uploader.upload(dataURI, uploadOptions);
    
    console.log('Cloudinary upload successful:', {
      public_id: result.public_id,
      url: result.secure_url,
      resource_type: result.resource_type
    });
    
    // Return enhanced response
    return {
      secure_url: result.secure_url,
      public_id: result.public_id,
      resource_type: result.resource_type,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      format: result.format,
      original_filename: file.originalname
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    
    // Detailed error information for debugging
    const errorDetails = {
      message: error.message,
      code: error.http_code || error.code,
      type: error.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
    
    console.error('Cloudinary error details:', errorDetails);
    
    throw new Error(
      error.message.includes('File size too large') ? 
      'File size exceeds maximum limit' :
      'Failed to upload file: ' + error.message
    );
  }
};

const deleteFromCloudinary = async (publicId) => {
  try {
    if (!publicId || typeof publicId !== 'string') {
      throw new Error('Invalid public ID');
    }

    const result = await cloudinary.uploader.destroy(publicId, {
      invalidate: true // CDN cache invalidation
    });

    if (result.result !== 'ok') {
      throw new Error(result.result === 'not found' ? 
        'File not found' : 
        'Failed to delete file');
    }

    return result;
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error(
      error.message.includes('Invalid') ? 
      'Invalid public ID' : 
      'Failed to delete file'
    );
  }
};

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary
};