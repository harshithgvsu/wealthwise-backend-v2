const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const { authenticate, signToken, cookieOptions } = require("../middleware/auth");

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
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

    const user = await User.create({ email, name, passwordHash: password });
    const token = signToken(user._id);

    // Cookie still set for same-site/custom-domain deploys; token is also
    // returned in the body since *.onrender.com is on the public suffix list
    // and browsers won't attach a cookie across two different Render
    // services on that shared domain — the frontend falls back to sending
    // this as a Bearer token instead. See authenticate() in middleware/auth.js.
    res
      .cookie("ww_token", token, cookieOptions(NINETY_DAYS_MS))
      .status(201)
      .json({ success: true, user: user.toProfile(), token });
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
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, error: "Invalid email or password" });
    }

    const token = signToken(user._id);

    res
      .cookie("ww_token", token, cookieOptions(NINETY_DAYS_MS))
      .json({ success: true, user: user.toProfile(), token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /auth/logout — clears the httpOnly cookie
router.post("/logout", (req, res) => {
  res
    .clearCookie("ww_token", cookieOptions(0))
    .json({ success: true });
});

// GET /auth/me — validate session and return fresh profile
router.get("/me", authenticate, async (req, res) => {
  res.json({ success: true, user: req.user.toProfile() });
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
    if (!user) return res.json({ success: true }); // don't reveal if email exists

    user.passwordHash = newPassword;
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
