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

// ---- کاربر: ثبت اطلاعات گیرنده + رسید ----
router.post("/:id/receipt", requireAuth, upload.single("receipt"), (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(req.params.id, req.userId);
  if (!order) return res.status(404).json({ error: "not_found" });
  if (!req.file) return res.status(400).json({ error: "missing_receipt" });

  const { payment_reference, customer_name, customer_phone, shipping_address } = req.body;
  db.prepare(
    `UPDATE orders SET payment_reference = ?, receipt_image = ?, customer_name = ?, customer_phone = ?, shipping_address = ?, status = 'pending_review' WHERE id = ?`
  ).run(
    payment_reference || null,
    req.file.filename,
    customer_name || null,
    customer_phone || null,
    shipping_address || null,
    order.id
  );

  // شماره تلفن رو روی پروفایل کاربر هم ذخیره کن تا دفعه بعد لازم نباشه دوباره بگیره
  if (customer_phone) {
    db.prepare("UPDATE users SET phone = ? WHERE id = ?").run(customer_phone, req.userId);
  }

  res.json({ ok: true });
});

router.get("/mine", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT id, invoice_number, products, total_amount, status, created_at, confirmed_at FROM orders WHERE user_id = ? ORDER BY id DESC")
    .all(req.userId);
  res.json(rows.map((r) => ({ ...r, products: JSON.parse(r.products) })));
});

router.get("/", requireAdmin, (req, res) => {
  const { status, q } = req.query;
  let sql = `SELECT o.*, u.name as user_name, u.telegram_user_id FROM orders o JOIN users u ON u.id = o.us
