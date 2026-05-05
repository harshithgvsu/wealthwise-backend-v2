const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const { authenticate, signToken } = require("../middleware/auth");

// Stricter rate limit for auth endpoints — prevents brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, error: "Too many attempts, try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /auth/signup
router.post("/signup", authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, error: "Email already registered. Please log in." });
    }

    const user = await User.create({
      email,
      name,
      passwordHash: password, // pre-save hook hashes this
    });

    const token = signToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: user.toProfile(),
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /auth/login
router.post("/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid email or password" });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      return res.status(401).json({ success: false, error: "Invalid email or password" });
    }

    const token = signToken(user._id);

    res.json({
      success: true,
      token,
      user: user.toProfile(),
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /auth/me — validate token and return fresh user profile
router.get("/me", authenticate, async (req, res) => {
  res.json({
    success: true,
    user: req.user.toProfile(),
  });
});

// POST /auth/reset-password
router.post("/reset-password", authLimiter, async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ success: false, error: "Email and new password required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal whether email exists — return success either way
      return res.json({ success: true });
    }

    user.passwordHash = newPassword; // pre-save hook re-hashes
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
