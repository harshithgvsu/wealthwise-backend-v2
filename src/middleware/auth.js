const jwt = require("jsonwebtoken");
const User = require("../models/User");

const isProd = process.env.NODE_ENV === "production";

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge,
    path: "/",
  };
}

async function authenticate(req, res, next) {
  // Read from httpOnly cookie first, fall back to Bearer header for backward compat
  const token =
    req.cookies?.ww_token ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) {
    return res.status(401).json({ success: false, error: "No token provided" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId).select("-passwordHash");

    if (!user) {
      return res.status(401).json({ success: false, error: "User not found" });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, error: "Token expired" });
    }
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
}

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "90d",
  });
}

module.exports = { authenticate, signToken, cookieOptions };
