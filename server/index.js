const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const { Redis } = require("@upstash/redis");
const cors = require("cors");
const { Ratelimit } = require("@upstash/ratelimit");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000", // :: Uncomment this line to restrict CORS to your frontend URL
    // origin: "*", // Allow all origins for development purposes
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Initialize Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create rate limiter
const rateLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(100, "15 m"), // 100 requests per 15 minutes
  prefix: "rate-limit",
});

// Express middleware
async function rateLimitMiddleware(req, res, next) {
  const identifier = req.ip; // or use req.user.id if authenticated
  const result = await rateLimiter.limit(identifier);
  // Temporarily increase rate limit for testing/development
  console.log(`Rate limit remaining: ${result.remaining} requests`);
  console.log(`Rate limit resets in: ${Math.ceil(result.reset / 1000)} seconds`);
  result.success = true; // Override rate limit check

  if (!result.success) {
    return res.status(429).json({
      error: "Too many requests",
      retryAfter: `${Math.ceil(result.reset / 1000)} seconds`,
    });
  }

  next();
}
app.use(rateLimitMiddleware);

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/chats", require("./routes/chats"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/files", require("./routes/files"));

// Socket.IO event handlers
require("./socket")(io, redis);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chat_app")
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Test the connection
redis
  .ping()
  .then(() => {
    console.log("Connected to Upstash Redis");
  })
  .catch((err) => {
    console.error("Redis connection error:", err);
  });

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
