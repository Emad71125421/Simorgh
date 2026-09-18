const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
});

router.get("/users", requireAdmin, (req, res) => {
  const { q } = req.query;
  let sql = "SELECT id, telegram_user_id, phone, name, referral_code, referred_by, points, created_at FROM users WHERE 1=1";
  const args = [];
  if (q) {
    sql += " AND (name LIKE ? OR telegram_user_id LIKE ? OR phone LIKE ?)";
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY id DESC";
  res.json(db.prepare(sql).all(...args));
});

module.exports = router;
