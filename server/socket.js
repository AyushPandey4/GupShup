const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Chat = require("./models/Chat");
const Message = require("./models/Message");
const Call = require("./models/Call");
const logger = require("./utils/logger"); // For better logging

// Constants
const MESSAGE_CACHE_TTL = 86400; // 24 hours in seconds
const ONLINE_STATUS_UPDATE_INTERVAL = 30000; // 30 seconds

module.exports = function (io, redis) {
  // Middleware for authentication with improved error handling
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentication error: Token missing"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.userId) {
        return next(new Error("Authentication error: Invalid token payload"));
      }

      // Verify user exists
      const userExists = await User.exists({ _id: decoded.userId });
      if (!userExists) {
        return next(new Error("Authentication error: User not found"));
      }

      socket.userId = decoded.userId;
      socket.userRooms = new Set([socket.userId]); // Track rooms user is in

      // Update user status with timestamp
      await User.findByIdAndUpdate(decoded.userId, {
        status: "online",
        lastSeen: new Date(),
        socketId: socket.id,
      });

      next();
    } catch (error) {
      logger.error("Socket authentication error:", error);
      if (error.name === "TokenExpiredError") {
        next(new Error("Authentication error: Token expired"));
      } else if (error.name === "JsonWebTokenError") {
        next(new Error("Authentication error: Invalid token"));
      } else {
        next(new Error("Authentication error"));
      }
    }
  });

  io.on("connection", async (socket) => {
    logger.info(`User connected: ${socket.userId} (socket ${socket.id})`);

    try {
      // Join user's personal room
      socket.join(socket.userId);

      // Join all chat rooms the user is part of with batch processing
      const userChats = await Chat.find(
        { participants: socket.userId },
        { _id: 1 }
      ).lean();

      const chatRooms = userChats.map((chat) => {
        const roomId = `chat:${chat._id}`;
        socket.join(roomId);
        socket.userRooms.add(roomId);
        return roomId;
      });

      logger.debug(
        `User ${socket.userId} joined ${chatRooms.length} chat rooms`
      );

      // Periodic status update to prevent stale online status
      const statusUpdateInterval = setInterval(async () => {
        try {
          await User.findByIdAndUpdate(socket.userId, {
            lastSeen: new Date(),
          });
        } catch (error) {
          logger.error("Status update error:", error);
        }
      }, ONLINE_STATUS_UPDATE_INTERVAL);

      // Handle new messages with improved validation
      socket.on("message:send", async (data, callback) => {
        try {
          const { chatId, text, type = "text", fileUrl, fileName } = data;

          // Validate message data
          if (!chatId || (!text && !fileUrl)) {
            throw new Error("Invalid message data");
          }

          // Verify user is a participant
          const isParticipant = await Chat.exists({
            _id: chatId,
            participants: socket.userId,
          });
          if (!isParticipant) {
            throw new Error("Not a chat participant");
          }

          // Create and save message in transaction
          const message = await Message.create({
            chatId,
            sender: socket.userId,
            text,
            type,
            fileUrl,
            fileName,
          });

          // Update chat's last message
          await Chat.findByIdAndUpdate(chatId, {
            lastMessage: message._id,
            updatedAt: new Date(),
          });

          // Populate sender details
          await message.populate({
            path: "sender",
            select: "name username profilePicture",
            model: User,
          });

          // Prepare message data for broadcasting
          const messageData = message.toObject();
          messageData.socketId = socket.id; // Include sender's socket ID

          // Broadcast to all participants except sender
          socket.to(`chat:${chatId}`).emit("message:received", messageData);

          // Store in Redis with additional metadata
          await redis.set(
            `message:${message._id}`,
            JSON.stringify({
              ...messageData,
              cachedAt: new Date().toISOString(),
            }),
            'EX',
            MESSAGE_CACHE_TTL
          );

          // Acknowledge to sender
          if (typeof callback === "function") {
            callback({ status: "success", messageId: message._id });
          }
        } catch (error) {
          logger.error("Message send error:", error);
          if (typeof callback === "function") {
            callback({ status: "error", error: error.message });
          }
        }
      });

      // Handle typing indicators with debounce
      const typingTimers = new Map();

      socket.on("typing:start", ({ chatId, userId }) => {
        try {
          if (!chatId) throw new Error("Chat ID required");

          // Clear any existing timer
          if (typingTimers.has(chatId)) {
            clearTimeout(typingTimers.get(chatId));
          }

          // Broadcast typing start
          socket.to(`chat:${chatId}`).emit("typing:start", {
            chatId,
            userId: socket.userId,
          });

          // Set timer to auto-stop after 5 seconds
          typingTimers.set(
            chatId,
            setTimeout(() => {
              socket.emit("typing:stop", { chatId });
              typingTimers.delete(chatId);
            }, 5000)
          );
        } catch (error) {
          logger.error("Typing start error:", error);
        }
      });

      socket.on("typing:stop", ({ chatId }) => {
        try {
          if (!chatId) throw new Error("Chat ID required");

          if (typingTimers.has(chatId)) {
            clearTimeout(typingTimers.get(chatId));
            typingTimers.delete(chatId);
          }

          socket.to(`chat:${chatId}`).emit("typing:stop", {
            chatId,
            userId: socket.userId,
          });
        } catch (error) {
          logger.error("Typing stop error:", error);
        }
      });

      // Handle message delivery confirmations
      socket.on("message:delivered", async ({ messageId }) => {
        try {
          if (!messageId) throw new Error("Message ID required");

          // Find message and update delivery status
          const message = await Message.findById(messageId);
          if (!message) {
            logger.warn(`Message not found for delivery confirmation: ${messageId}`);
            return;
          }

          // Don't update if sender is the same as receiver
          if (message.sender.toString() === socket.userId) {
            return;
          }

          // Find original sender's socket(s) to notify
          const sender = await User.findById(message.sender);
          if (!sender || !sender.socketId) {
            return;
          }

          // Emit status update to sender
          io.to(sender.socketId).emit("message:status", {
            messageId,
            status: "delivered",
          });

          logger.info(`Message ${messageId} marked as delivered for user ${socket.userId}`);
        } catch (error) {
          logger.error("Message delivery error:", error);
        }
      });

      // Handle marking messages as read
      socket.on("messages:read", async ({ chatId }) => {
        try {
          if (!chatId) throw new Error("Chat ID required");

          // Verify chat exists and user is participant
          const chat = await Chat.findById(chatId);
          if (!chat) {
            logger.warn(`Chat not found for read confirmation: ${chatId}`);
            return;
          }
          
          if (!chat.participants.includes(socket.userId)) {
            logger.warn(`User ${socket.userId} not participant in chat ${chatId}`);
            return;
          }

          // Find all unread messages not sent by the current user
          const messages = await Message.find({
            chatId,
            sender: { $ne: socket.userId },
            readBy: { $ne: socket.userId }
          });

          if (messages.length === 0) {
            return;
          }

          // Update all messages
          await Message.updateMany(
            {
              chatId,
              sender: { $ne: socket.userId },
              readBy: { $ne: socket.userId }
            },
            {
              $addToSet: { readBy: socket.userId }
            }
          );

          // Notify senders about read status
          const senderIds = [...new Set(messages.map(m => m.sender.toString()))];
          
          for (const senderId of senderIds) {
            const sender = await User.findById(senderId);
            if (sender && sender.socketId) {
              // Get all message IDs for this sender
              const messageIds = messages
                .filter(m => m.sender.toString() === senderId)
                .map(m => m._id.toString());
                
              // Emit status updates for each message
              messageIds.forEach(msgId => {
                io.to(sender.socketId).emit("message:status", {
                  messageId: msgId,
                  status: "read",
                });
              });
            }
          }

          logger.info(`Marked ${messages.length} messages as read in chat ${chatId} for user ${socket.userId}`);
        } catch (error) {
          logger.error("Mark messages as read error:", error);
        }
      });

      // Handle calls with improved state management
      const activeCalls = new Map();

      socket.on("call:initiate", async (data, callback) => {
        try {
          const { recipientId, type, isGroup } = data;

          // Validate call data
          if (
            (!isGroup && !recipientId) ||
            (isGroup &&
              (!data.participants || !Array.isArray(data.participants)))
          ) {
            throw new Error("Invalid call data");
          }

          const participants = isGroup
            ? [...new Set(data.participants)]
            : [socket.userId, recipientId];

          // Verify participants exist and are connected
          const connectedParticipants = await Promise.all(
            participants.map(async (participantId) => {
              const sockets = await io.in(participantId).fetchSockets();
              return sockets.length > 0 ? participantId : null;
            })
          ).then((results) => results.filter(Boolean));

          if (connectedParticipants.length < 2) {
            throw new Error("Recipient not available");
          }

          // Create call record
          const call = await Call.create({
            type,
            isGroup,
            participants,
            initiator: socket.userId,
            status: "ringing",
          });

          // Track active call
          activeCalls.set(call._id.toString(), {
            participants,
            startTime: null,
            type,
            isGroup,
            initiator: socket.userId,
          });

          // Emit to recipient(s)
          const recipients = isGroup
            ? participants.filter((id) => id !== socket.userId)
            : [recipientId];

          // Populate initiator details for the notification
          const initiator = await User.findById(socket.userId, 'name username profilePicture').lean();

          recipients.forEach((recipientId) => {
            io.to(recipientId).emit("call:incoming", {
              callId: call._id.toString(),
              initiator,
              type,
              isGroup,
              groupInfo: isGroup ? { 
                id: data.groupId, 
                name: data.groupName
              } : null
            });
          });

          logger.info(`Call initiated: ${call._id} by ${socket.userId}, type: ${type}, isGroup: ${isGroup}`);

          if (typeof callback === "function") {
            callback({
              status: "success",
              callId: call._id,
              participants: connectedParticipants,
            });
          }
        } catch (error) {
          logger.error("Call initiation error:", error);
          if (typeof callback === "function") {
            callback({ status: "error", error: error.message });
          }
        }
      });

      // Handle call acceptance
      socket.on("call:accept", async (data, callback) => {
        try {
          const { callId } = data;
          if (!callId) throw new Error("Call ID required");

          const call = await Call.findById(callId);
          if (!call) throw new Error("Call not found");

          // Verify user is a participant
          if (!call.participants.includes(socket.userId)) {
            throw new Error("Not a call participant");
          }

          // Update call status
          call.status = "ongoing";
          call.startTime = new Date();
          await call.save();

          // Update active call tracking
          const activeCall = activeCalls.get(callId);
          if (activeCall) {
            activeCall.startTime = new Date();
          }

          // Identify the initiator to send acceptance
          const initiatorId = call.initiator.toString();
          console.log(`Call ${callId} accepted by ${socket.userId}, notifying initiator ${initiatorId}`);

          // Notify initiator and trigger WebRTC signaling
          io.to(initiatorId).emit("call:accepted", { 
            callId,
            acceptedBy: socket.userId 
          });

          // Also notify other participants in group calls
          if (call.isGroup) {
            call.participants.forEach((participantId) => {
              if (participantId.toString() !== socket.userId && 
                  participantId.toString() !== initiatorId) {
                io.to(participantId.toString()).emit("call:accepted", { 
                  callId,
                  acceptedBy: socket.userId 
                });
              }
            });
          }

          logger.info(`Call accepted: ${callId} by ${socket.userId}`);

          if (typeof callback === "function") {
            callback({ status: "success", initiatorId });
          }
        } catch (error) {
          logger.error("Call acceptance error:", error);
          if (typeof callback === "function") {
            callback({ status: "error", error: error.message });
          }
        }
      });

      // Handle call rejection
      socket.on("call:reject", async (data, callback) => {
        try {
          const { callId, reason } = data;
          if (!callId) throw new Error("Call ID required");

          const call = await Call.findById(callId);
          if (!call) throw new Error("Call not found");

          // Verify user is a participant
          if (!call.participants.includes(socket.userId)) {
            throw new Error("Not a call participant");
          }

          // Update call status
          call.status = "missed";
          await call.save();

          // Remove from active calls
          activeCalls.delete(callId);

          // Notify other participants
          call.participants.forEach((participantId) => {
            if (participantId.toString() !== socket.userId) {
              io.to(participantId.toString()).emit("call:rejected", { 
                callId,
                rejectedBy: socket.userId,
                reason
              });
            }
          });

          logger.info(`Call rejected: ${callId} by ${socket.userId}, reason: ${reason || 'No reason provided'}`);

          if (typeof callback === "function") {
            callback({ status: "success" });
          }
        } catch (error) {
          logger.error("Call rejection error:", error);
          if (typeof callback === "function") {
            callback({ status: "error", error: error.message });
          }
        }
      });

      // Handle call ending
      socket.on("call:end", async (data, callback) => {
        try {
          const { callId, reason } = data || {};
          
          // Try to find active calls where user is participant
          let foundCallId = callId;
          
          if (!foundCallId) {
            // Look through active calls to find one where user is participant
            for (const [id, callData] of activeCalls.entries()) {
              if (callData.participants.includes(socket.userId)) {
                foundCallId = id;
                break;
              }
            }
          }
          
          if (!foundCallId) {
            logger.warn(`No active call found for user ${socket.userId} to end`);
            if (typeof callback === "function") {
              callback({ status: "error", error: "No active call found" });
            }
            return;
          }

          const call = await Call.findById(foundCallId);
          if (!call) {
            logger.warn(`Call not found in database: ${foundCallId}`);
            activeCalls.delete(foundCallId);
            if (typeof callback === "function") {
              callback({ status: "error", error: "Call not found" });
            }
            return;
          }

          // Calculate duration and end call
          const now = new Date();
          const duration = call.startTime 
            ? Math.round((now - call.startTime) / 1000) 
            : 0;

          call.status = "ended";
          call.endTime = now;
          call.duration = duration;
          await call.save();

          // Get active call data
          const activeCallData = activeCalls.get(foundCallId);
          
          // Notify other participants
          if (activeCallData) {
            activeCallData.participants.forEach((participantId) => {
              if (participantId !== socket.userId) {
                io.to(participantId).emit("call:ended", {
                  callId: foundCallId,
                  endedBy: socket.userId,
                  reason: reason || "Call ended by other participant",
                  duration
                });
              }
            });
          }

          // Remove from active calls
          activeCalls.delete(foundCallId);

          logger.info(`Call ended: ${foundCallId} by ${socket.userId}, duration: ${duration}s`);

          if (typeof callback === "function") {
            callback({ status: "success" });
          }
        } catch (error) {
          logger.error("Call end error:", error);
          if (typeof callback === "function") {
            callback({ status: "error", error: error.message });
          }
        }
      });

      // Handle WebRTC signaling
      socket.on("webrtc:signal", async (data, callback) => {
        try {
          const { signal, recipientId, callId } = data;
          
          if (!signal) {
            throw new Error("WebRTC signal required");
          }

          let targetId = recipientId;
          
          // If no specific recipient, try to find from active call
          if (!targetId && callId) {
            const activeCall = activeCalls.get(callId);
            if (activeCall) {
              // Find all other participants in this call
              targetId = activeCall.participants.find(id => id !== socket.userId);
              console.log(`Found target ${targetId} from call ${callId}`);
            }
          }
          
          // If still no target, try to find from any active call
          if (!targetId) {
            console.log("No specific recipient or call ID, searching active calls...");
            for (const [id, callData] of activeCalls.entries()) {
              if (callData.participants.includes(socket.userId)) {
                const otherParticipants = callData.participants.filter(
                  (p) => p !== socket.userId
                );
                if (otherParticipants.length > 0) {
                  targetId = otherParticipants[0];
                  console.log(`Found target ${targetId} from active call ${id}`);
                  break;
                }
              }
            }
          }

          if (!targetId) {
            throw new Error("No recipient found for WebRTC signal");
          }

          // Log the signal type for debugging
          const signalType = signal.type || 'unknown';
          console.log(`WebRTC ${signalType} signal from ${socket.userId} to ${targetId}`);

          // Send the signal to the recipient
          io.to(targetId).emit("webrtc:signal", {
            signal,
            from: socket.userId,
            callId
          });

          logger.debug(`WebRTC signal sent from ${socket.userId} to ${targetId}, type: ${signalType}`);

          if (typeof callback === "function") {
            callback({ status: "success" });
          }
        } catch (error) {
          logger.error("WebRTC signal error:", error);
          if (typeof callback === "function") {
            callback({ status: "error", error: error.message });
          }
        }
      });

      // Handle WebRTC reconnection requests
      socket.on("webrtc:reconnect", async (data, callback) => {
        try {
          const { recipientId, callId } = data || {};
          
          let targetId = recipientId;
          
          // Try to find target from call ID if provided
          if (!targetId && callId) {
            const activeCall = activeCalls.get(callId);
            if (activeCall) {
              targetId = activeCall.participants.find(id => id !== socket.userId);
            }
          }
          
          // If still no target, try to find from any active call
          if (!targetId) {
            for (const [id, callData] of activeCalls.entries()) {
              if (callData.participants.includes(socket.userId)) {
                const otherParticipants = callData.participants.filter(
                  (p) => p !== socket.userId
                );
                if (otherParticipants.length > 0) {
                  targetId = otherParticipants[0];
                  break;
                }
              }
            }
          }

          if (!targetId) {
            throw new Error("No recipient found for WebRTC reconnection");
          }

          // Notify the recipient about reconnection
          io.to(targetId).emit("webrtc:reconnect", {
            from: socket.userId,
            callId
          });

          logger.info(`WebRTC reconnect request sent from ${socket.userId} to ${targetId}`);

          if (typeof callback === "function") {
            callback({ status: "success" });
          }
        } catch (error) {
          logger.error("WebRTC reconnect error:", error);
          if (typeof callback === "function") {
            callback({ status: "error", error: error.message });
          }
        }
      });

      // Handle disconnection
      socket.on("disconnect", async () => {
        try {
          clearInterval(statusUpdateInterval);

          // Update user status
          await User.findByIdAndUpdate(socket.userId, {
            status: "offline",
            lastSeen: new Date(),
            $unset: { socketId: 1 },
          });

          // End any active calls
          for (const [callId, callData] of activeCalls.entries()) {
            if (callData.participants.includes(socket.userId)) {
              try {
                // Update call status in database
                const call = await Call.findById(callId);
                if (call) {
                  const now = new Date();
                  const duration = call.startTime
                    ? Math.round((now - call.startTime) / 1000)
                    : 0;

                  call.status = "ended";
                  call.endTime = now;
                  call.duration = duration;
                  await call.save();
                  
                  logger.info(`Call ${callId} ended due to disconnection of user ${socket.userId}, duration: ${duration}s`);
                }

                // Notify other participants
                callData.participants.forEach((participantId) => {
                  if (participantId !== socket.userId) {
                    io.to(participantId).emit("call:ended", {
                      callId,
                      endedBy: socket.userId,
                      reason: "User disconnected",
                    });
                  }
                });
              } catch (error) {
                logger.error(`Error ending call ${callId} on disconnect:`, error);
              }

              // Remove from active calls tracking
              activeCalls.delete(callId);
            }
          }

          logger.info(
            `User disconnected: ${socket.userId} (socket ${socket.id})`
          );
        } catch (error) {
          logger.error("Disconnection handler error:", error);
        }
      });

      // Error handling
      socket.on("error", (error) => {
        logger.error(`Socket error for user ${socket.userId}:`, error);
      });
    } catch (error) {
      logger.error("Connection handler error:", error);
      socket.disconnect(true);
    }
  });

  // Global error handling
  io.on("error", (error) => {
    logger.error("Socket.IO server error:", error);
  });
};
