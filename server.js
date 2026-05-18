/**
 * Smart Water ATM Backend
 * - Creates Razorpay orders (fixed amount: ₹5 => 500 paise)
 * - Verifies Razorpay payment signature server-side
 * - After successful verification, triggers ESP8266 water release
 *
 * Important:
 * - Razorpay KEY_SECRET must NEVER be exposed to the frontend.
 */

require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();

// Basic middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve static frontend
app.use(express.static(path.join(__dirname)));

// Validate required env vars on startup (fail fast)
const REQUIRED_VARS = ["KEY_ID", "KEY_SECRET", "ESP_IP"];
for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    console.error(`Missing required environment variable: ${v}`);
  }
}

const PORT = Number(process.env.PORT) || 3000;
const ESP_IP = process.env.ESP_IP;
const KEY_ID = process.env.KEY_ID;
const KEY_SECRET = process.env.KEY_SECRET;

// Razorpay SDK client (server-side only)
const razorpay = new Razorpay({
  key_id: KEY_ID,
  key_secret: KEY_SECRET,
});

const WATER_RELEASE_URL = `http://${ESP_IP}/water`;

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
 * Verifies Razorpay signature and only then triggers ESP8266 water release.
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

    let espResponse;
    try {
      // Call ESP with strict timeout after payment verification succeeds.
      espResponse = await axios.get(WATER_RELEASE_URL, { timeout: 7000 });
    } catch (espErr) {
      console.error("ESP water release failed:", espErr?.response?.data || espErr.message || espErr);

      try {
        await razorpay.payments.refund(razorpay_payment_id, {
          amount: 500,
          notes: {
            reason: "Water release failed",
          },
        });
        console.log("Refund initiated");
      } catch (refundErr) {
        console.error("Refund failed:", refundErr?.response?.data || refundErr.message || refundErr);
      }

      return res.status(502).json({
        success: false,
        message: "Water release failed. Refund initiated.",
        error: "Water release failed. Refund initiated.",
      });
    }

    const espBody = typeof espResponse.data === "string" ? espResponse.data : JSON.stringify(espResponse.data);
    const isWaterReleaseSuccess =
      espResponse.status === 200 && espBody.toLowerCase().includes("water released");

    if (!isWaterReleaseSuccess) {
      console.error("ESP water release failed:", {
        status: espResponse.status,
        data: espResponse.data,
      });

      try {
        await razorpay.payments.refund(razorpay_payment_id, {
          amount: 500,
          notes: {
            reason: "Water release failed",
          },
        });
        console.log("Refund initiated");
      } catch (refundErr) {
        console.error("Refund failed:", refundErr?.response?.data || refundErr.message || refundErr);
      }

      return res.status(502).json({
        success: false,
        message: "Water release failed. Refund initiated.",
        error: "Water release failed. Refund initiated.",
      });
    }

    console.log("ESP water release success");
    return res.json({
      success: true,
      message: "Payment verified and water released successfully.",
    });
  } catch (err) {
    console.error("Error verifying payment / releasing water:", err?.response?.data || err.message || err);

    return res.status(500).json({
      success: false,
      error: "Internal server error.",
    });
  }
});

// Fallback 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.post("/webhook/razorpay", express.json(), (req, res) => {

  console.log("Webhook received");

  console.log(req.body);

  res.status(200).json({
    success: true
  });

});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
