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
// GET REGISTERED PHONES
// ======================================================

async function getNotificationTokens() {

  const tokensSnapshot =
    await database
      .ref("notificationTokens")
      .once("value");

  const tokenData = tokensSnapshot.val();

  if (!tokenData) {
    return [];
  }

  return Object.keys(tokenData);
}


// ======================================================
// SEND FALL NOTIFICATION
// ======================================================

async function sendFallNotifications(sensorData) {

  try {

    const tokens =
      await getNotificationTokens();

    if (tokens.length === 0) {

      console.log(
        "No notification tokens registered."
      );

      return;
    }

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
          "Fall notification sent:",
          response
        );

      } catch (error) {

        console.error(
          "Failed to send fall notification:",
          error.message
        );
      }
    }

  } catch (error) {

    console.error(
      "Fall notification error:",
      error
    );
  }
}


// ======================================================
// SEND SOS NOTIFICATION
// ======================================================

async function sendSOSNotifications(sensorData) {

  try {

    const tokens =
      await getNotificationTokens();

    if (tokens.length === 0) {

      console.log(
        "No notification tokens registered."
      );

      return;
    }

    console.log(
      `Sending SOS alert to ${tokens.length} device(s).`
    );


    for (const token of tokens) {

      const message = {

        token: token,

        data: {

          type: "sos_alert",

          title:
            "🆘 SOS Emergency",

          body:
            "The Smart Safety Shoe wearer manually triggered an emergency alert. Tap to view location.",

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
          "SOS notification sent:",
          response
        );

      } catch (error) {

        console.error(
          "Failed to send SOS notification:",
          error.message
        );
      }
    }

  } catch (error) {

    console.error(
      "SOS notification error:",
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


    // Initial reading - do not send notification
    if (previousFallState === null) {

      previousFallState =
        currentFallState;

      console.log(
        "Initial fall state recorded."
      );

      return;
    }


    // Notify only on false -> true
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
// MANUAL FALL ENDPOINT
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
// MANUAL SOS ENDPOINT
// ======================================================

app.post(
  "/sos-alert",

  async (req, res) => {

    try {

      /*
       * Use coordinates supplied by ESP32 if available.
       *
       * If they are missing, read the latest GPS data
       * directly from Firebase.
       */

      let sensorData =
        req.body || {};


      if (
        sensorData.latitude == null ||
        sensorData.longitude == null
      ) {

        const snapshot =
          await database
            .ref("sensorData")
            .once("value");

        sensorData =
          snapshot.val() || {};
      }


      console.log(
        "MANUAL SOS TRIGGERED"
      );


      await sendSOSNotifications(
        sensorData
      );


      res.status(200).json({
        success: true,
        type: "sos_alert"
      });

    } catch (error) {

      console.error(
        "SOS endpoint error:",
        error
      );


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
