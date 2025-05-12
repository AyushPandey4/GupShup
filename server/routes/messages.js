const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const Chat = require("../models/Chat");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { uploadToCloudinary } = require("../utils/cloudinary");
const multer = require("multer");
const { body, param, query, validationResult } = require("express-validator");

// Configure multer with better file filtering
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      // Images
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      // Videos
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-msvideo",
      // Audio
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/aac",
      // Documents
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      // Text files
      "text/plain",
      "text/rtf",
      "text/markdown",
      // Code files
      "text/javascript",
      "text/css",
      "text/html",
      "application/json",
      // Compressed files
      "application/zip",
      "application/x-rar-compressed",
      "application/x-7z-compressed"
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      console.log('Rejected file type:', file.mimetype);
      cb(new Error(`File type not allowed: ${file.mimetype}`), false);
    }
  },
});

// Redis cache TTL configuration
const MESSAGE_CACHE_TTL = 1800; // 30 minutes
const CHAT_LAST_MESSAGE_TTL = 86400; // 24 hours

// Get chat messages with Redis caching and pagination
router.get(
  "/:chatId",
  auth,
  [
    param("chatId").isMongoId().withMessage("Invalid chat ID format"),
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1-100"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { chatId } = req.params;
      const { page = 1, limit = 50 } = req.query;
      const cacheKey = `chatMessages:${chatId}:${page}:${limit}`;

      // Check Redis cache first
      if (req.redisClient) {
        const cachedMessages = await req.redisClient.get(cacheKey);
        if (cachedMessages) {
          return res.json(JSON.parse(cachedMessages));
        }
      }

      // Verify chat exists and user is participant
      const chat = await Chat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.participants.includes(req.user.userId)) {
        return res.status(403).json({ error: "Not a participant" });
      }

      const messages = await Message.find({
        chatId,
        deletedFor: { $ne: req.user.userId },
      })
        .populate([
          {
            path: "sender",
            select: "name username profilePicture",
            model: User,
          },
          {
            path: "replyTo",
            model: Message,
          },
        ])
        .sort("-createdAt")
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      // Cache results in Redis
      if (req.redisClient) {
        await req.redisClient.setEx(
          cacheKey,
          MESSAGE_CACHE_TTL,
          JSON.stringify(messages)
        );
      }

      res.json(messages.reverse());
    } catch (error) {
      console.error("Get messages error:", error);
      res.status(500).json({
        error: "Failed to fetch messages",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Send message with validation and Redis invalidation
router.post(
  "/:chatId",
  auth,
  upload.single("file"),
  [
    param("chatId").isMongoId().withMessage("Invalid chat ID format"),
    body("text")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 5000 })
      .withMessage("Message text cannot exceed 5000 characters"),
    body("type")
      .optional()
      .isIn(["text", "image", "video", "audio", "file"])
      .withMessage("Invalid message type"),
    body("replyTo")
      .optional()
      .isMongoId()
      .withMessage("Invalid reply message ID format"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { chatId } = req.params;
      const { text, type = "text", replyTo } = req.body;

      // Verify chat exists and user is participant
      const [chat, replyMessage] = await Promise.all([
        Chat.findById(chatId),
        replyTo ? Message.findById(replyTo) : null,
      ]);

      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.participants.includes(req.user.userId)) {
        return res.status(403).json({ error: "Not a participant" });
      }
      if (replyTo && !replyMessage) {
        return res.status(404).json({ error: "Reply message not found" });
      }

      const messageData = {
        chatId,
        sender: req.user.userId,
        text,
        type,
        replyTo,
      };

      // Handle file upload if present
      if (req.file) {
        try {
          console.log("Uploading file to Cloudinary:", {
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
          
          console.log("Cloudinary upload result:", {
            url: result.secure_url,
            type: result.resource_type,
            format: result.format,
            size: `${(result.bytes / (1024 * 1024)).toFixed(2)}MB`
          });
          
          // Map the Cloudinary result to the correct fields
          messageData.fileUrl = result.secure_url;
          messageData.fileName = req.file.originalname || req.body.fileName || 'Untitled';
          messageData.fileSize = req.file.size;
          messageData.fileType = req.file.mimetype;
          
          // Update type if needed
          if (type === 'text' || !type) {
            // Auto-detect type based on mimetype
            if (req.file.mimetype.startsWith('image/')) {
              messageData.type = 'image';
            } else if (req.file.mimetype.startsWith('video/')) {
              messageData.type = 'video';
            } else if (req.file.mimetype.startsWith('audio/')) {
              messageData.type = 'audio';
            } else {
              messageData.type = 'file';
            }
          }
        } catch (error) {
          console.error("File upload error:", error);
          return res.status(500).json({
            error: "Failed to upload file",
            details: process.env.NODE_ENV === "development" ? error.message : undefined
          });
        }
      }

      const message = new Message(messageData);
      await message.save();

      // Update chat's last message
      chat.lastMessage = message._id;
      await chat.save();

      // Populate before sending response
      await message.populate([
        {
          path: "sender",
          select: "name username profilePicture",
          model: User,
        },
        {
          path: "replyTo",
          model: Message,
        },
      ]);

      // Invalidate Redis caches
      if (req.redisClient) {
        await Promise.all([
          // Invalidate messages cache for this chat
          req.redisClient.del(`chatMessages:${chatId}:*`),
          // Update last message cache
          req.redisClient.setEx(
            `chatLastMessage:${chatId}`,
            CHAT_LAST_MESSAGE_TTL,
            JSON.stringify(message)
          ),
          // Invalidate chat list cache for all participants
          ...chat.participants.map((userId) =>
            req.redisClient.del(`userChats:${userId}`)
          ),
        ]);
      }

      res.status(201).json(message);
    } catch (error) {
      console.error("Send message error:", error);

      // Handle file upload errors specifically
      if (
        error.message.includes("File too large") ||
        error.message.includes("Invalid file type")
      ) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({
        error: "Failed to send message",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Delete message with Redis invalidation
router.delete(
  "/:messageId",
  auth,
  [param("messageId").isMongoId().withMessage("Invalid message ID format")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { messageId } = req.params;
      const message = await Message.findById(messageId);

      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }

      // Check if user is sender or participant
      const chat = await Chat.findById(message.chatId);
      if (!chat || !chat.participants.includes(req.user.userId)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      let shouldUpdateLastMessage = false;
      let deletedForEveryone = false;

      if (message.sender.toString() === req.user.userId) {
        // Delete for everyone
        await Message.findByIdAndDelete(messageId);
        deletedForEveryone = true;
        shouldUpdateLastMessage = true;
      } else {
        // Delete for this user only
        if (!message.deletedFor.includes(req.user.userId)) {
          message.deletedFor.push(req.user.userId);
          await message.save();
        }
      }

      // Update last message if needed
      if (
        shouldUpdateLastMessage &&
        chat.lastMessage?.toString() === messageId
      ) {
        const lastMessage = await Message.findOne({
          chatId: chat._id,
          _id: { $ne: message._id },
        }).sort("-createdAt");

        chat.lastMessage = lastMessage ? lastMessage._id : null;
        await chat.save();

        // Update Redis cache if available
        if (req.redisClient && lastMessage) {
          await req.redisClient.setEx(
            `chatLastMessage:${chat._id}`,
            CHAT_LAST_MESSAGE_TTL,
            JSON.stringify(lastMessage)
          );
        }
      }

      // Invalidate relevant caches
      if (req.redisClient) {
        await Promise.all([
          // Invalidate messages cache for this chat
          req.redisClient.del(`chatMessages:${message.chatId}:*`),
          // Invalidate chat list cache for all participants if deleted for everyone
          deletedForEveryone
            ? Promise.all(
                chat.participants.map((userId) =>
                  req.redisClient.del(`userChats:${userId}`)
                )
              )
            : Promise.resolve(),
        ]);
      }

      res.json({
        message: "Message deleted successfully",
        deletedForEveryone,
      });
    } catch (error) {
      console.error("Delete message error:", error);
      res.status(500).json({
        error: "Failed to delete message",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Mark messages as read with Redis support
router.post(
  "/:chatId/read",
  auth,
  [param("chatId").isMongoId().withMessage("Invalid chat ID format")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { chatId } = req.params;

      // Verify chat exists and user is participant
      const chat = await Chat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.participants.includes(req.user.userId)) {
        return res.status(403).json({ error: "Not a participant" });
      }

      const result = await Message.updateMany(
        {
          chatId,
          sender: { $ne: req.user.userId },
          readBy: { $ne: req.user.userId },
        },
        {
          $addToSet: { readBy: req.user.userId },
        }
      );

      // Update unread count in Redis if available
      if (req.redisClient) {
        await req.redisClient.del(`unreadCount:${chatId}:${req.user.userId}`);
      }

      res.json({
        message: "Messages marked as read",
        updatedCount: result.modifiedCount,
      });
    } catch (error) {
      console.error("Mark as read error:", error);
      res.status(500).json({
        error: "Failed to mark messages as read",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

module.exports = router;
