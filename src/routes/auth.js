const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { verifyInitData } = require("../telegramVerify");

const router = express.Router();

function makeReferralCode() {
  return crypto.randomBytes(4).toString("hex");
}

router.post("/telegram", (req, res) => {
  const { initData } = req.body;
  if (!initData) return res.status(400).json({ error: "missing_init_data" });

  const verified = verifyInitData(initData, process.env.BOT_TOKEN);
  if (!verified || !verified.user) return res.status(401).json({ error: "invalid_init_data" });

  const tgUser = verified.user;
  const telegramUserId = String(tgUser.id);

  let user = db.prepare("SELECT * FROM users WHERE telegram_user_id = ?").get(telegramUserId);

  if (!user) {
    let referredBy = null;
    if (verified.startParam) {
      const referrer = db.prepare("SELECT * FROM users WHERE referral_code = ?").get(verified.startParam);
      if (referrer) referredBy = referrer.id;
    }

    let code;
    do {
      code = makeReferralCode();
    } while (db.prepare("SELECT id FROM users WHERE referral_code = ?").get(code));

    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
    const info = db
      .prepare(
        `INSERT INTO users (telegram_user_id, name, referral_code, referred_by) VALUES (?, ?, ?, ?)`
      )
      .run(telegramUserId, name, code, referredBy);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  }

  const token = jwt.sign({ uid: user.id, role: "user" }, process.env.JWT_SECRET, { expiresIn: "30d" });
  res.json({ token });
});

router.post("/phone", require("../middleware/auth").requireAuth, (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "missing_phone" });
  db.prepare("UPDATE users SET phone = ? WHERE id = ?").run(phone, req.userId);
  res.json({ ok: true });
});

module.exports = router;
