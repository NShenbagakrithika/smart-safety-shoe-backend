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

  // Generate real Unix timestamp in milliseconds
  const realTimestamp = Date.now();

  // Replace ESP32 uptime timestamp with real server time
  sensorData.timestamp = realTimestamp;

  // Update Firebase so Android receives the correct time
  await database
    .ref("sensorData/timestamp")
    .set(realTimestamp);

  console.log(
    "Fall timestamp:",
    realTimestamp
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
// WATCH FIREBASE MANUAL SOS STATUS
// ======================================================

let previousSOSState = null;

const sosReference =
  database.ref("sensorData/manualSOS");

sosReference.on(
  "value",

  async (snapshot) => {

    const currentSOSState =
      snapshot.val() === true;

    console.log(
      "Manual SOS state:",
      currentSOSState
    );

    // First reading after Render starts:
    // remember state but don't send an alert.
    if (previousSOSState === null) {

      previousSOSState =
        currentSOSState;

      console.log(
        "Initial SOS state recorded."
      );

      return;
    }

    // Send only when SOS changes false -> true.
    if (
      previousSOSState === false &&
      currentSOSState === true
    ) {

      console.log(
        "NEW MANUAL SOS DETECTED"
      );

      // Get the latest GPS/timestamp from sensorData.
      const sensorSnapshot =
        await database
          .ref("sensorData")
          .once("value");

      const sensorData =
  sensorSnapshot.val() || {};

// Generate real Unix timestamp in milliseconds
const realTimestamp = Date.now();

// Replace ESP32 uptime timestamp
sensorData.timestamp = realTimestamp;

// Update Firebase so Android receives the correct time
await database
  .ref("sensorData/timestamp")
  .set(realTimestamp);

console.log(
  "SOS timestamp:",
  realTimestamp
);

await sendSOSNotifications(
  sensorData
);
    }

    previousSOSState =
      currentSOSState;
  },

  (error) => {

    console.error(
      "Manual SOS listener error:",
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

// ======================================================
// OPTIONAL ML FALL ALERTS (separate from existing sensorData)
// Set ENABLE_ML_NOTIFICATIONS=true only after testing.
// ======================================================
if (process.env.ENABLE_ML_NOTIFICATIONS === 'true') {
  let previousMLFall = null;
  let lastMLAlertAt = 0;
  const cooldownMs = 60 * 1000;
  database.ref('mlPrediction').on('value', async (snapshot) => {
    const ml = snapshot.val();
    if (!ml) return;
    const current = ml.fallDetected === true;
    if (previousMLFall === null) {
      previousMLFall = current;
      return; // No alert on initial startup.
    }
    if (!previousMLFall && current && Date.now() - lastMLAlertAt > cooldownMs) {
      // Ignore stale events; Render may restart or reconnect.
      if (Number.isFinite(ml.timestamp) && Date.now() - ml.timestamp < 15000) {
        lastMLAlertAt = Date.now();
        try {
          const sensorSnapshot = await database.ref('sensorData').once('value');
          const sensor = sensorSnapshot.val() || {};
          await sendFallNotifications({
            latitude: sensor.latitude,
            longitude: sensor.longitude,
            timestamp: ml.timestamp,
          });
          console.log('ML fall notification dispatched');
        } catch (err) {
          console.error('ML notification error:', err);
        }
      }
    }
    previousMLFall = current;
  }, (error) => console.error('ML listener error:', error));
}
