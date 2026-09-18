const express = require("express");
const db = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/mine", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM rewards WHERE user_id = ? ORDER BY id DESC").all(req.userId);
  res.json(rows);
});

router.get("/", requireAdmin, (req, res) => {
  const rows = db
    .prepare(`SELECT rw.*, u.name as user_name, u.telegram_user_id FROM rewards rw JOIN users u ON u.id = rw.user_id ORDER BY rw.id DESC`)
    .all();
  res.json(rows);
});

router.post("/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!["pending", "fulfilled", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "invalid_status" });
  }
  db.prepare("UPDATE rewards SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
