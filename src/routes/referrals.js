const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/mine", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, u.name as referred_name FROM referrals r JOIN users u ON u.id = r.referred_user_id WHERE r.referrer_id = ? ORDER BY r.id DESC`
    )
    .all(req.userId);
  res.json(rows);
});

module.exports = router;
