const API_BASE = "https://new-water-atm.onrender.com";
const payBtn = document.getElementById("payBtn");
const statusMessage = document.getElementById("statusMessage");

function setStatus(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status ${type}`.trim();
}

async function startPayment() {
  try {
    payBtn.disabled = true;
    setStatus("Creating secure order...");

    // Step 1: Ask backend to create fixed ₹5 order
    const orderRes = await fetch(`${API_BASE}/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const orderData = await orderRes.json();

    if (!orderRes.ok) {
      throw new Error(orderData.error || "Could not create order.");
    }

    // Step 2: Open Razorpay Checkout popup
    const options = {
      key: orderData.keyId,
      amount: orderData.amount,
      currency: orderData.currency,
      name: "Smart Water ATM",
      description: "₹5 = 1 Liter Water",
      order_id: orderData.orderId,
      handler: async function (response) {
        try {
          setStatus("Verifying payment and releasing water...");

          // Step 3: Verify payment at backend, then trigger ESP8266 /water
          const verifyRes = await fetch(`${API_BASE}/verify-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });
          const verifyData = await verifyRes.json();

          if (!verifyRes.ok || !verifyData.success) {
            throw new Error(
              verifyData.message || verifyData.error || "Payment verification failed."
            );
          }

          setStatus("Payment successful. 1 liter water released.", "success");
        } catch (error) {
          setStatus(error.message || "Payment captured, but water release failed.", "error");
        } finally {
          payBtn.disabled = false;
        }
      },
      modal: {
        ondismiss: function () {
          setStatus("Payment popup closed before completion.", "error");
          payBtn.disabled = false;
        },
      },
      theme: {
        color: "#0077cc",
      },
    };

    const rzp = new Razorpay(options);

    rzp.on("payment.failed", function (response) {
      const reason = response?.error?.description || "Payment failed. Please try again.";
      setStatus(reason, "error");
      payBtn.disabled = false;
    });

    rzp.open();
  } catch (error) {
    setStatus(error.message || "Something went wrong. Please try again.", "error");
    payBtn.disabled = false;
  }
}

payBtn.addEventListener("click", startPayment);

