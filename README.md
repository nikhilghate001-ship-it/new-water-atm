# Smart Water ATM (Razorpay Live + ESP8266)

This project uses Razorpay Live payment gateway for a fixed amount of **₹5**.
Only after server-side payment signature verification, it calls:

`http://${ESP_IP}/water`

to release water.

## Folder Structure

```text
water-atm/
├── server.js
├── package.json
├── .env
└── public/
    ├── index.html
    ├── style.css
    └── script.js
```

## .env Format

Use this exact format:

```env
KEY_ID=your_live_key_id_here
KEY_SECRET=your_live_key_secret_here
ESP_IP=10.180.118.153
PORT=5000
```

## Exact Run Steps

1. Open terminal and go to project:
   - `cd "c:\Users\rutes\Downloads\water atm final\water-atm"`
2. Install packages:
   - `npm install`
3. Update `.env` with your Live Key ID and Live Key Secret.
4. Start server:
   - `npm start`
   - or `npm run dev`
5. Open browser:
   - `http://localhost:5000`
6. Click **Pay ₹5** and complete payment in Razorpay Checkout.
7. On successful backend verification, ESP8266 water endpoint is triggered.

## Backend Flow

- `POST /create-order` creates Razorpay order for **500 paise** (₹5).
- `POST /verify-payment`:
  - verifies signature with `crypto` using `KEY_SECRET`
  - calls `http://${ESP_IP}/water` only if signature is valid
- `GET /` serves frontend from `public/`.

## Security Rules Enforced

- Live `KEY_SECRET` is read from `.env` only.
- `KEY_SECRET` is never exposed to frontend.
- Frontend receives only `KEY_ID` via `/create-order`.
- Water is never released unless payment verification succeeds.
