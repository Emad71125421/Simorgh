const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const db = require("../db");
const products = require("../products");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
const REWARD_THRESHOLD = 500;
const REFERRAL_POINTS = 50;

const uploadDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("only_images_allowed"));
    cb(null, true);
  },
});

router.get("/products", (req, res) => res.json(products));

// ---- کاربر: ساخت سفارش ----
router.post("/", requireAuth, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "empty_order" });
  }

  let total = 0;
  const lines = [];
  for (const it of items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p || !it.qty || it.qty < 1) return res.status(400).json({ error: "invalid_item" });
    total += p.price * it.qty;
    lines.push({ id: p.id, name: p.name, price: p.price, qty: it.qty });
  }

  const invoiceNumber = `SM-${Date.now()}`;
  const info = db
    .prepare(
      `INSERT INTO orders (user_id, invoice_number, products, total_amount, status) VALUES (?, ?, ?, ?, 'awaiting_payment')`
    )
    .run(req.userId, invoiceNumber, JSON.stringify(lines), total);

  res.json({
    order_id: info.lastInsertRowid,
    invoice_number: invoiceNumber,
    total_amount: total,
    bank_card_number: process.env.BANK_CARD_NUMBER,
    bank_card_holder: process.env.BANK_CARD_HOLDER,
  });
});

// ---- کاربر: آپلود رسید ----
router.post("/:id/receipt", requireAuth, upload.single("receipt"), (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(req.params.id, req.userId);
  if (!order) return res.status(404).json({ error: "not_found" });
  if (!req.file) return res.status(400).json({ error: "missing_receipt" });

  const { payment_reference } = req.body;
  db.prepare(
    `UPDATE orders SET payment_reference = ?, receipt_image = ?, status = 'pending_review' WHERE id = ?`
  ).run(payment_reference || null, req.file.filename, order.id);

  res.json({ ok: true });
});

// ---- کاربر: تاریخچه سفارش‌ها ----
router.get("/mine", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT id, invoice_number, products, total_amount, status, created_at, confirmed_at FROM orders WHERE user_id = ? ORDER BY id DESC")
    .all(req.userId);
  res.json(rows.map((r) => ({ ...r, products: JSON.parse(r.products) })));
});

// ---- ادمین: لیست سفارش‌ها ----
router.get("/", requireAdmin, (req, res) => {
  const { status, q } = req.query;
  let sql = `SELECT o.*, u.name as user_name, u.telegram_user_id FROM orders o JOIN users u ON u.id = o.user_id WHERE 1=1`;
  const args = [];
  if (status) {
    sql += " AND o.status = ?";
    args.push(status);
  }
  if (q) {
    sql += " AND (o.invoice_number LIKE ? OR u.name LIKE ? OR u.telegram_user_id LIKE ?)";
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY o.id DESC";
  const rows = db.prepare(sql).all(...args);
  res.json(rows.map((r) => ({ ...r, products: JSON.parse(r.products) })));
});

// ---- ادمین: دیدن عکس رسید (توکن از query string، چون <img> نمی‌تونه هدر بفرسته) ----
router.get("/:id/receipt-image", (req, res) => {
  try {
    const payload = jwt.verify(req.query.t, process.env.JWT_SECRET);
    if (payload.role !== "admin") return res.status(401).end();
  } catch (e) {
    return res.status(401).end();
  }

  const order = db.prepare("SELECT receipt_image FROM orders WHERE id = ?").get(req.params.id);
  if (!order || !order.receipt_image) return res.status(404).end();
  res.sendFile(path.join(uploadDir, order.receipt_image));
});

// ---- ادمین: تأیید سفارش ----
router.post("/:id/approve", requireAdmin, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "not_found" });
  if (order.status === "confirmed") return res.json({ ok: true, already: true });

  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?").run(order.id);

    const buyer = db.prepare("SELECT * FROM users WHERE id = ?").get(order.user_id);
    if (buyer.referred_by) {
      const existingReferral = db.prepare("SELECT id FROM referrals WHERE referred_user_id = ?").get(buyer.id);
      if (!existingReferral) {
        db.prepare(
          `INSERT INTO referrals (referrer_id, referred_user_id, order_id, points, status) VALUES (?, ?, ?, ?, 'credited')`
        ).run(buyer.referred_by, buyer.id, order.id, REFERRAL_POINTS);

        db.prepare("UPDATE users SET points = points + ? WHERE id = ?").run(REFERRAL_POINTS, buyer.referred_by);

        const referrer = db.prepare("SELECT * FROM users WHERE id = ?").get(buyer.referred_by);
        if (referrer.points >= REWARD_THRESHOLD) {
          db.prepare(
            `INSERT INTO rewards (user_id, required_points, points_used, reward_type, status) VALUES (?, ?, ?, 'saffron_gift', 'pending')`
          ).run(referrer.id, REWARD_THRESHOLD, REWARD_THRESHOLD);
          db.prepare("UPDATE users SET points = points - ? WHERE id = ?").run(REWARD_THRESHOLD, referrer.id);
        }
      }
    }
  });
  tx();

  res.json({ ok: true });
});

// ---- ادمین: رد سفارش ----
router.post("/:id/reject", requireAdmin, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "not_found" });
  db.prepare("UPDATE orders SET status = 'rejected' WHERE id = ?").run(order.id);
  res.json({ ok: true });
});

module.exports = router;
