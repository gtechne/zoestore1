// server/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const path = require("path");
const admin = require("firebase-admin");
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// CORS Configuration
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:4243",
  // Add other allowed origins if necessary
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Body Parser Middleware
app.use(express.json());

// Serve Static Files in Production
if (process.env.NODE_ENV === "production") {
  app.use(express.static("build"));
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "build", "index.html"));
  });
}

// Root Route
app.get("/", (req, res) => {
  res.send("Welcome to the Zoestore website.");
});

// Create Payment Intent
app.post("/create-payment-intent", async (req, res) => {
  const { items, email, shipping, description } = req.body;
  const totalAmount = calculateOrderAmount(items);

  try {
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: totalAmount,
        currency: "NGN",
        callback_url: `${process.env.FRONTEND_URL}/Payment-success`, // Updated Callback URL
        description,
        metadata: {
          custom_fields: [
            {
              display_name: shipping.name,
              variable_name: shipping.phone,
              value: `${shipping.line1}, ${shipping.city}, ${shipping.country}`,
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.send({
      authorizationUrl: response.data.data.authorization_url,
      reference: response.data.data.reference,  // Paystack reference
      
    });
    //console.log("Generated reference:", response.data.data.reference);
  } catch (error) {
    //console.error("Error initializing payment:", error.response?.data || error.message);
    res.status(500).send({
      message: "Payment initialization failed. Please try again.",
      error: error.response?.data || error.message,
    });
  }
  
});

// Verify Payment
app.post("/verify-payment/:reference", async (req, res) => {
  const { reference } = req.params; // Use req.params to get the reference


  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );
    //console.log("Paystack verification response:", response.data);

    const paymentStatus = response.data.data.status;

    if (paymentStatus === "success") {
      // Save the order to Firebase
      const order = {
        userID: req.body.userID || "Unknown User", // Set default if undefined
        userEmail: req.body.email || "No Email",
        orderDate: new Date().toDateString(),
        orderTime: new Date().toLocaleTimeString(),
        orderAmount: req.body.amount || 0, // Ensure amount is provided
        orderStatus: "Order Placed...",
        cartItems: req.body.items || [], // Provide an empty array if undefined
        shippingAddress: req.body.shipping || {}, // Provide an empty object if undefined
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      if (!order.userID || !order.userEmail || !order.cartItems.length) {
        console.error("Missing required fields for order:", order);
        res.status(400).send({ message: "Order fields are missing or invalid." });
        return;
      }

       // Save order to Firebase Firestore
       // Save order in Firestore
      const orderRef = await db.collection("orders").add(order);
      //console.log("Order saved to Firebase with ID:", orderRef.id);

      res.json({ status: "success", orderId: orderRef.id });
    } else {
      res.json({ status: "failed" });
    }

    //console.log(`Verifying payment with reference: ${reference}`);
  } catch (error) {
    //console.error("Payment verification error:", error.response?.data || error.message);
    res.status(500).send({
      message: "Payment verification failed.",
      error: error.response?.data || error.message,
    });
  }
});

// Calculate Order Amount
const calculateOrderAmount = (items) => {
  const total = items.reduce((acc, item) => acc + item.price * item.cartQuantity, 0);
  return total * 100; // Convert to Kobo
};

// Start Server
const PORT = process.env.PORTW || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
