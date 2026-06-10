const { setDefaultResultOrder } = require('dns');
setDefaultResultOrder('ipv4first');
require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { connectDB } = require("./config/db");

const app = express();

// ── Security headers (crossOriginResourcePolicy must be cross-origin for Cloudflare Tunnel + GitHub Pages)
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// ── CORS — only allow your frontend origin(s)
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// ── Body parser
app.use(express.json({ limit: "1mb" }));

// ── Global rate limiter — generous, auth routes have their own stricter one
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ── Routes
app.use("/auth", require("./routes/auth"));
app.use("/users", require("./routes/users"));
app.use("/expenses", require("./routes/expenses"));
app.use("/cards", require("./routes/cards"));
app.use("/ai", require("./routes/ai"));

// ── Health check
app.get("/health", (req, res) => res.json({ ok: true }));

// ── 404
app.use((req, res) => res.status(404).json({ success: false, error: "Not found" }));

// ── Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, error: "Server error" });
});

// ── Start
const PORT = process.env.PORT || 3001;

connectDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 WealthWise API running on port ${PORT}`);
  });
});
