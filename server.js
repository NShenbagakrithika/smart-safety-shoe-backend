const express = require("express");
const admin = require("firebase-admin");

const app = express();

app.use(express.json());

/*
 * Firebase Admin credentials will be stored securely
 * as environment variables on Render.
 *
 * They will NOT be stored in GitHub.
 */
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

/*
 * Simple health check.
 *
 * Visiting the backend URL should return:
 * Smart Safety Shoe backend is running.
 */
app.get("/", (req, res) => {
  res.status(200).send("Smart Safety Shoe backend is running.");
});

/*
 * FALL ALERT ENDPOINT
 *
 * Later the ESP32 will call this endpoint when
 * its fall-detection logic confirms a fall.
 */
app.post("/fall-alert", async (req, res) => {
  try {
    const {
      fcmToken,
      latitude,
      longitude,
      timestamp
    } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        error: "FCM token is required"
      });
    }

    const message = {
      token: fcmToken,

      /*
       * DATA message.
       *
       * Our SmartSafetyMessagingService will receive
       * this and create the Android notification itself.
       */
      data: {
        type: "fall_alert",
        title: "🚨 Fall Detected",
        body:
          "Possible fall detected by Smart Safety Shoe. Tap to view location.",
        latitude: String(latitude ?? ""),
        longitude: String(longitude ?? ""),
        timestamp: String(timestamp ?? "")
      },

      android: {
        priority: "high"
      }
    };

    const response =
      await admin.messaging().send(message);

    console.log(
      "Fall notification sent:",
      response
    );

    return res.status(200).json({
      success: true,
      messageId: response
    });

  } catch (error) {

    console.error(
      "Error sending fall notification:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Smart Safety Shoe backend running on port ${PORT}`
  );
});
