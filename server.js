const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());


// ======================================================
// FIREBASE ADMIN SETUP
// ======================================================

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const database = admin.database();


// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/", (req, res) => {
  res.status(200).send(
    "Smart Safety Shoe backend is running."
  );
});


// ======================================================
// SEND FALL NOTIFICATION
// ======================================================

async function sendFallNotifications(sensorData) {

  try {

    const tokensSnapshot =
      await database
        .ref("notificationTokens")
        .once("value");

    const tokenData = tokensSnapshot.val();

    if (!tokenData) {

      console.log(
        "No notification tokens registered."
      );

      return;
    }

    const tokens = Object.keys(tokenData);

    console.log(
      `Sending fall alert to ${tokens.length} device(s).`
    );


    for (const token of tokens) {

      const message = {

        token: token,

        data: {
          type: "fall_alert",

          title:
            "🚨 Fall Detected",

          body:
            "Possible fall detected by Smart Safety Shoe. Tap to view location.",

          latitude:
            String(
              sensorData.latitude ?? ""
            ),

          longitude:
            String(
              sensorData.longitude ?? ""
            ),

          timestamp:
            String(
              sensorData.timestamp ?? ""
            )
        },

        android: {
          priority: "high"
        }
      };


      try {

        const response =
          await admin
            .messaging()
            .send(message);

        console.log(
          "Notification sent:",
          response
        );

      } catch (error) {

        console.error(
          "Failed to send to device:",
          error.message
        );
      }
    }

  } catch (error) {

    console.error(
      "Notification error:",
      error
    );
  }
}


// ======================================================
// WATCH FIREBASE FALL STATUS
// ======================================================

let previousFallState = null;

const sensorReference =
  database.ref("sensorData");


sensorReference.on(
  "value",

  async (snapshot) => {

    const sensorData =
      snapshot.val();

    if (!sensorData) {
      return;
    }


    const currentFallState =
      sensorData.fallDetected === true;


    console.log(
      "Fall state:",
      currentFallState
    );


    /*
     * First Firebase reading:
     *
     * Store the state but DO NOT send an alert.
     * This prevents a notification every time
     * Render restarts.
     */
    if (previousFallState === null) {

      previousFallState =
        currentFallState;

      console.log(
        "Initial fall state recorded."
      );

      return;
    }


    /*
     * Send notification ONLY when:
     *
     * false → true
     */
    if (
      previousFallState === false &&
      currentFallState === true
    ) {

      console.log(
        "NEW FALL DETECTED"
      );

      await sendFallNotifications(
        sensorData
      );
    }


    previousFallState =
      currentFallState;
  },

  (error) => {

    console.error(
      "Firebase listener error:",
      error
    );
  }
);


// ======================================================
// MANUAL TEST ENDPOINT
// ======================================================

app.post(
  "/fall-alert",

  async (req, res) => {

    try {

      await sendFallNotifications(
        req.body
      );

      res.status(200).json({
        success: true
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);


// ======================================================
// START SERVER
// ======================================================

const PORT =
  process.env.PORT || 3000;


app.listen(
  PORT,

  () => {

    console.log(
      `Smart Safety Shoe backend running on port ${PORT}`
    );
  }
);
