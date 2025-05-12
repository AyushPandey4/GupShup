const express = require("express");
const router = express.Router();
const Chat = require("../models/Chat");
const Message = require("../models/Message");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { body, param, validationResult } = require("express-validator");

// Enhanced populate helper with error handling
const populateChat = async (chatQuery) => {
  try {
    return await chatQuery
      .populate({
        path: "participants",
        select: "name username profilePicture status",
        model: User,
      })
      .populate({
        path: "admins",
        select: "name username",
        model: User,
      })
      .populate({
        path: "lastMessage",
        model: Message,
      })
      .exec();
  } catch (error) {
    console.error("Population error:", error);
    throw error;
  }
};

// Get user's chats with Redis caching
router.get("/", auth, async (req, res) => {
  try {
    const cacheKey = `userChats:${req.user.userId}`;

    // Try Redis cache first
    if (req.redisClient) {
      const cachedChats = await req.redisClient.get(cacheKey);
      if (cachedChats) {
        return res.json(JSON.parse(cachedChats));
      }
    }

    const chats = await populateChat(
      Chat.find({ participants: req.user.userId }).sort("-updatedAt").lean() // Use lean for better performance
    );

    // Cache in Redis if available
    if (req.redisClient) {
      await req.redisClient.setEx(
        cacheKey,
        1800, // 30 minutes cache
        JSON.stringify(chats)
      );
    }

    res.json(chats);
  } catch (error) {
    console.error("Get chats error:", error);
    res.status(500).json({
      error: "Failed to fetch chats",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Create new 1:1 chat with validation
router.post(
  "/",
  auth,
  [
    body("participantId")
      .notEmpty()
      .withMessage("Participant ID is required")
      .isMongoId()
      .withMessage("Invalid participant ID format"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { participantId } = req.body;

      // Check if participant exists
      const participant = await User.findById(participantId);
      if (!participant) {
        return res.status(404).json({ error: "Participant not found" });
      }

      // Check for existing chat
      const existingChat = await populateChat(
        Chat.findOne({
          isGroup: false,
          participants: {
            $all: [req.user.userId, participantId],
            $size: 2,
          },
        })
      );

      if (existingChat) {
        return res.json(existingChat);
      }

      // Create new chat
      const chat = new Chat({
        participants: [req.user.userId, participantId],
      });

      await chat.save();
      const populatedChat = await populateChat(Chat.findById(chat._id));

      // Invalidate chats cache for both users
      if (req.redisClient) {
        await Promise.all([
          req.redisClient.del(`userChats:${req.user.userId}`),
          req.redisClient.del(`userChats:${participantId}`),
        ]);
      }

      res.status(201).json(populatedChat);
    } catch (error) {
      console.error("Create chat error:", error);
      res.status(500).json({
        error: "Failed to create chat",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Create group chat with validation
router.post(
  "/group",
  auth,
  [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Group name is required")
      .isLength({ max: 50 })
      .withMessage("Group name cannot exceed 50 characters"),
    body("participants")
      .isArray({ min: 1 })
      .withMessage("Participants must be an array with at least 1 member"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, participants } = req.body;
      const allParticipants = [...new Set([req.user.userId, ...participants])];

      // Verify all participants exist
      const usersExist = await User.countDocuments({
        _id: { $in: allParticipants },
      });

      if (usersExist !== allParticipants.length) {
        return res
          .status(404)
          .json({ error: "One or more participants not found" });
      }

      const chat = new Chat({
        isGroup: true,
        name,
        participants: allParticipants,
        admins: [req.user.userId],
        createdBy: req.user.userId,
      });

      await chat.save();
      const populatedChat = await populateChat(Chat.findById(chat._id));

      // Invalidate cache for all participants
      if (req.redisClient) {
        await Promise.all(
          allParticipants.map((userId) =>
            req.redisClient.del(`userChats:${userId}`)
          )
        );
      }

      res.status(201).json(populatedChat);
    } catch (error) {
      console.error("Create group chat error:", error);
      res.status(500).json({
        error: "Failed to create group chat",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Add participant to group with validation
router.post(
  "/:chatId/participants",
  auth,
  [
    param("chatId").isMongoId().withMessage("Invalid chat ID format"),
    body("userId")
      .notEmpty()
      .withMessage("User ID is required")
      .isMongoId()
      .withMessage("Invalid user ID format"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId } = req.body;
      const { chatId } = req.params;

      const [chat, user] = await Promise.all([
        Chat.findById(chatId),
        User.findById(userId),
      ]);

      if (!chat) return res.status(404).json({ error: "Chat not found" });
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!chat.isGroup)
        return res.status(400).json({ error: "Not a group chat" });
      if (!chat.admins.includes(req.user.userId)) {
        return res.status(403).json({ error: "Not an admin" });
      }
      if (chat.participants.includes(userId)) {
        return res.status(409).json({ error: "User already in group" });
      }

      const updatedChat = await Chat.findByIdAndUpdate(
        chatId,
        { $addToSet: { participants: userId } },
        { new: true }
      );

      const populatedChat = await populateChat(Chat.findById(updatedChat._id));

      // Invalidate cache for added user
      if (req.redisClient) {
        await req.redisClient.del(`userChats:${userId}`);
      }

      res.json(populatedChat);
    } catch (error) {
      console.error("Add participant error:", error);
      res.status(500).json({
        error: "Failed to add participant",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Remove participant from group with validation
router.delete(
  "/:chatId/participants/:userId",
  auth,
  [
    param("chatId").isMongoId().withMessage("Invalid chat ID format"),
    param("userId").isMongoId().withMessage("Invalid user ID format"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { chatId, userId } = req.params;

      const chat = await Chat.findById(chatId);
      if (!chat) return res.status(404).json({ error: "Chat not found" });
      if (!chat.isGroup)
        return res.status(400).json({ error: "Not a group chat" });
      if (!chat.admins.includes(req.user.userId)) {
        return res.status(403).json({ error: "Not an admin" });
      }
      if (!chat.participants.includes(userId)) {
        return res.status(404).json({ error: "User not in group" });
      }

      const updatedChat = await Chat.findByIdAndUpdate(
        chatId,
        {
          $pull: {
            participants: userId,
            admins: userId,
          },
        },
        { new: true }
      );

      const populatedChat = await populateChat(Chat.findById(updatedChat._id));

      // Invalidate cache for removed user
      if (req.redisClient) {
        await req.redisClient.del(`userChats:${userId}`);
      }

      res.json(populatedChat);
    } catch (error) {
      console.error("Remove participant error:", error);
      res.status(500).json({
        error: "Failed to remove participant",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Leave group with validation
router.post(
  "/:chatId/leave",
  auth,
  [param("chatId").isMongoId().withMessage("Invalid chat ID format")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { chatId } = req.params;
      const chat = await Chat.findById(chatId);

      if (!chat) return res.status(404).json({ error: "Chat not found" });
      if (!chat.isGroup)
        return res.status(400).json({ error: "Not a group chat" });
      if (!chat.participants.includes(req.user.userId)) {
        return res.status(400).json({ error: "Not a participant" });
      }

      // Remove user from participants and admins
      chat.participants = chat.participants.filter(
        (id) => id.toString() !== req.user.userId
      );
      chat.admins = chat.admins.filter(
        (id) => id.toString() !== req.user.userId
      );

      // Handle empty group
      if (chat.participants.length === 0) {
        await Promise.all([
          Chat.findByIdAndDelete(chatId),
          Message.deleteMany({ chat: chatId }),
        ]);
        return res.json({ message: "Chat deleted" });
      }

      // Assign new admin if needed
      if (chat.admins.length === 0) {
        chat.admins = [chat.participants[0]];
      }

      await chat.save();
      const populatedChat = await populateChat(Chat.findById(chat._id));

      // Invalidate cache for leaving user
      if (req.redisClient) {
        await req.redisClient.del(`userChats:${req.user.userId}`);
      }

      res.json({
        message: "Left group successfully",
        chat: populatedChat,
      });
    } catch (error) {
      console.error("Leave group error:", error);
      res.status(500).json({
        error: "Failed to leave group",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Delete chat with validation
router.delete(
  "/:chatId",
  auth,
  [param("chatId").isMongoId().withMessage("Invalid chat ID format")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { chatId } = req.params;
      const chat = await Chat.findById(chatId);

      if (!chat) return res.status(404).json({ error: "Chat not found" });

      // Authorization check
      if (chat.isGroup) {
        if (!chat.admins.includes(req.user.userId)) {
          return res.status(403).json({ error: "Not an admin" });
        }
      } else if (!chat.participants.includes(req.user.userId)) {
        return res.status(403).json({ error: "Not a participant" });
      }

      await Promise.all([
        Chat.findByIdAndDelete(chatId),
        Message.deleteMany({ chat: chatId }),
      ]);

      // Invalidate cache for all participants
      if (req.redisClient) {
        await Promise.all(
          chat.participants.map((userId) =>
            req.redisClient.del(`userChats:${userId}`)
          )
        );
      }

      res.json({ message: "Chat deleted successfully" });
    } catch (error) {
      console.error("Delete chat error:", error);
      res.status(500).json({
        error: "Failed to delete chat",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

module.exports = router;
