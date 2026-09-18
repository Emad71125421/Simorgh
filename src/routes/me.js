const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const REWARD_THRESHOLD = 500;

router.get("/", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (!user) return res.status(404).json({ error: "not_found" });

  const referralLink = `https://t.me/${process.env.BOT_USERNAME}/${process.env.MINIAPP_SHORT_NAME}?startapp=${user.referral_code}`;

  res.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    points: user.points,
    progress: {
      current: user.points % REWARD_THRESHOLD,
      target: REWARD_THRESHOLD,
    },
    referral_code: user.referral_code,
    referral_link: referralLink,
  });
});

module.exports = router;
