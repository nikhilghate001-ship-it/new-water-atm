/**
 * Smart Water ATM Backend
 * - Creates Razorpay orders (fixed amount: ₹5 => 500 paise)
 * - Verifies Razorpay payment signature server-side
 * - Sets an in-memory water release command for ESP8266 to poll
 *
 * Flow:
 *   Frontend payment success -> POST /verify-payment -> backend sets flag
 *   -> ESP polls GET /water-status -> relay ON -> ESP calls POST /water-done
 *
 * Important:
 * - Razorpay KEY_SECRET must NEVER be exposed to the frontend.
 * - In-memory flag is fine for demo. For production, use a database
 *   (Firebase, MongoDB, etc.) because a server restart will reset the flag.
 */

require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();

// Basic middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve static frontend
app.use(express.static(path.join(__dirname)));

// Validate required env vars on startup (fail fast)
const REQUIRED_VARS = ["KEY_ID", "KEY_SECRET"];
for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    console.error(`Missing required environment variable: ${v}`);
  }
}

const PORT = Number(process.env.PORT) || 3000;
const KEY_ID = process.env.KEY_ID;
const KEY_SECRET = process.env.KEY_SECRET;

// Razorpay SDK client (server-side only)
const razorpay = new Razorpay({
  key_id: KEY_ID,
  key_secret: KEY_SECRET,
});

// In-memory water release command (demo only — use DB in production)
let waterCommand = {
  releaseWater: false,
  amount: 0,
  paymentId: null,
  orderId: null,
  createdAt: null,
};

let lastRelease = null;

/**
 * GET /
 * Health route and also serves the frontend index.html.
 */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/**
 * POST /create-order
 * Creates a Razorpay order for a fixed amount of ₹5 (500 paise).
 *
 * Returns:
 * - orderId
 * - keyId (safe to expose, needed by Razorpay Checkout in frontend)
 * - amount (paise)
 * - currency
 */
app.post("/create-order", async (req, res) => {
  try {
    const amountPaise = 500; // Fixed amount: ₹5 => 500 paise
    const currency = "INR";

    const receipt = `water-atm-${Date.now()}`;
    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency,
      receipt,
    });

    res.json({
      orderId: order.id,
      keyId: KEY_ID,
      amount: amountPaise,
      currency,
    });
  } catch (err) {
    console.error("Error creating Razorpay order:", err?.response?.data || err.message || err);
    res.status(500).json({
      error: "Failed to create Razorpay order.",
    });
  }
});

/**
 * POST /verify-payment
 * Verifies Razorpay signature and sets in-memory water release command.
 *
 * Body:
 * {
 *   razorpay_order_id,
 *   razorpay_payment_id,
 *   razorpay_signature
 * }
 */
app.post("/verify-payment", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        error: "Missing required fields for payment verification.",
      });
    }

    // Razorpay signature verification:
    // signature = HMAC_SHA256(key_secret, razorpay_order_id + "|" + razorpay_payment_id)
    const expectedSignature = crypto
      .createHmac("sha256", KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        error: "Invalid payment signature.",
      });
    }

    console.log("Payment verified");

    waterCommand = {
      releaseWater: true,
      amount: 500,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      createdAt: new Date().toISOString(),
    };

    console.log("Water command created:", waterCommand);

    return res.json({
      success: true,
    });
  } catch (err) {
    console.error("Error verifying payment:", err?.response?.data || err.message || err);

    return res.status(500).json({
      success: false,
      error: "Internal server error.",
    });
  }
});

/**
 * GET /water-status
 * ESP8266 polls this route to check if water should be released.
 */
app.get("/water-status", (req, res) => {
  console.log("ESP checked status:", {
    releaseWater: waterCommand.releaseWater,
    paymentId: waterCommand.paymentId,
  });

  res.json({
    releaseWater: waterCommand.releaseWater,
    amount: waterCommand.amount,
    paymentId: waterCommand.paymentId,
    orderId: waterCommand.orderId,
  });
});

/**
 * POST /water-done
 * ESP8266 calls this after relay ON to confirm water was released.
 *
 * Body:
 * {
 *   paymentId: "...",
 *   status: "released"
 * }
 */
app.post("/water-done", (req, res) => {
  const { paymentId, status } = req.body || {};

  if (!paymentId || !status) {
    return res.status(400).json({
      error: "Missing paymentId or status.",
    });
  }

  waterCommand.releaseWater = false;

  lastRelease = {
    paymentId,
    status,
    releasedAt: new Date().toISOString(),
  };

  console.log("ESP confirmed water released:", lastRelease);

  res.json({
    success: true,
    lastRelease,
  });
});

/**
 * POST /test-release
 * Development-only route to trigger water release without payment.
 */
app.post("/test-release", (req, res) => {
  waterCommand = {
    releaseWater: true,
    amount: 500,
    paymentId: `test-${Date.now()}`,
    orderId: `test-order-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };

  console.log("Test water command created:", waterCommand);

  res.json({
    success: true,
    message: "Test water release command set.",
    waterCommand,
  });
});

// Fallback 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
