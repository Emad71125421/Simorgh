require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const meRoutes = require("./routes/me");
const orderRoutes = require("./routes/orders");
const referralRoutes = require("./routes/referrals");
const rewardRoutes = require("./routes/rewards");
const adminRoutes = require("./routes/admin");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/rewards", rewardRoutes);
app.use("/api/admin", adminRoutes);

app.post("/api/telegram/webhook", express.json(), async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body.message;
    if (!msg || !msg.text || !msg.text.startsWith("/start")) return;

    const chatId = msg.chat.id;
    const parts = msg.text.split(" ");
    const startParam = parts[1] || "";
    const appUrl = `https://t.me/${process.env.BOT_USERNAME}/${process.env.MINIAPP_SHORT_NAME}${
      startParam ? `?startapp=${startParam}` : ""
    }`;

    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "به فروشگاه زعفرون سیمرغ خوش اومدی 🌸",
        reply_markup: {
          inline_keyboard: [[{ text: "باز کردن فروشگاه", web_app: { url: appUrl } }]],
        },
      }),
    });
  } catch (e) {
    console.error("webhook error", e);
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Simorgh loyalty server running on port ${PORT}`));
