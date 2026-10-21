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
          gpsValid: String(sensorData.gpsValid === true),
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
          gpsValid: String(sensorData.gpsValid === true),
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


    const wasFall = previousFallState;
    previousFallState = currentFallState; // Record before any awaited Firebase mutation.

    // Notify only on false -> true
    if (
  wasFall === false &&
  currentFallState === true
) {

  console.log(
    "NEW FALL DETECTED"
  );

  // Generate real Unix timestamp in milliseconds
  const realTimestamp = Date.now();

  // Replace ESP32 uptime timestamp with real server time
  sensorData.timestamp = realTimestamp;

  // A timestamp write failure must not prevent the notification.
  await database.ref("sensorData/timestamp").set(realTimestamp)
    .catch(() => console.error("Fall timestamp update failed"));

  console.log(
    "Fall timestamp:",
    realTimestamp
  );

  void recordEmergency("fall", sensorData, "device");
  await sendFallNotifications(
    sensorData
  );
}


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

    const wasSOS = previousSOSState;
    previousSOSState = currentSOSState;

    // Send only when SOS changes false -> true.
    if (
      wasSOS === false &&
      currentSOSState === true
    ) {

      console.log(
        "NEW MANUAL SOS DETECTED"
      );

      // Get the latest GPS/timestamp from sensorData.
      const sensorSnapshot =
        await database
          .ref("sensorData")
          .once("value").catch(() => ({ val: () => ({}) }));

      const sensorData =
  sensorSnapshot.val() || {};

// Generate real Unix timestamp in milliseconds
const realTimestamp = Date.now();

// Replace ESP32 uptime timestamp
sensorData.timestamp = realTimestamp;

// Update Firebase so Android receives the correct time
await database.ref("sensorData/timestamp").set(realTimestamp)
  .catch(() => console.error("SOS timestamp update failed"));

console.log(
  "SOS timestamp:",
  realTimestamp
);

void recordEmergency("sos", sensorData, "device");
await sendSOSNotifications(
  sensorData
);
    }

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
  authorizeAlert,

  async (req, res) => {

    try {

      void recordEmergency("fall", req.body || {}, "endpoint");
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
  authorizeAlert,

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


      void recordEmergency("sos", sensorData, "endpoint");
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
// ML FALL NOTIFICATION LISTENER
// Uses the existing Firebase + FCM notification service
// ======================================================

if (
  process.env.ENABLE_ML_NOTIFICATIONS === "true" ||
  process.env.ENABLE_ANALYTICS === "true"
) {

  console.log("ML prediction listener enabled");

  const ML_COOLDOWN_MS = 60000;
  const ML_MAX_AGE_MS = 15000;

  let lastMLAlertAt = 0;
  let lastProcessedMLTimestamp = 0;
  let mlListenerInitialized = false;
  let mlAlertInProgress = false;

  const mlReference = database.ref("mlPrediction");

  mlReference.on(
    "value",

    async (snapshot) => {

      const ml = snapshot.val();

      if (!ml || typeof ml !== "object") {
        return;
      }

      const currentFall = ml.fallDetected === true;
      const predictionTimestamp = Number(ml.timestamp);
      const now = Date.now();

      console.log("========== ML PREDICTION ==========");
      console.log("Fall detected:", currentFall);
      console.log("Probability:", ml.probability);
      console.log("Threshold:", ml.threshold);
      console.log("Prediction timestamp:", predictionTimestamp);
      console.log("Current timestamp:", now);
      console.log("===================================");

      // --------------------------------------------
      // 1. Validate timestamp
      // --------------------------------------------

      if (!Number.isFinite(predictionTimestamp)) {
        console.log("ML: Invalid timestamp");
        return;
      }

      // --------------------------------------------
      // 2. Ignore existing data on startup
      // --------------------------------------------

      if (!mlListenerInitialized) {

        mlListenerInitialized = true;

        lastProcessedMLTimestamp = predictionTimestamp;

        console.log("ML: Initial prediction recorded");

        return;
      }

      // --------------------------------------------
      // 3. Ignore previously processed predictions
      // --------------------------------------------

      if (predictionTimestamp <= lastProcessedMLTimestamp) {

        console.log("ML: Prediction already processed");

        return;
      }

      lastProcessedMLTimestamp = predictionTimestamp;

      // --------------------------------------------
      // 4. Check prediction freshness
      // --------------------------------------------

      const predictionAge = now - predictionTimestamp;

      if (
        predictionAge < 0 ||
        predictionAge > ML_MAX_AGE_MS
      ) {

        console.log(
          "ML: Prediction rejected due to age:",
          predictionAge
        );

        return;
      }

      // --------------------------------------------
      // 5. Check whether a fall was detected
      // --------------------------------------------

      if (!currentFall) {

        console.log("ML: Normal activity detected");

        return;
      }

      console.log("ML: FALL DETECTED");

      // --------------------------------------------
      // 6. Prevent duplicate notifications
      // --------------------------------------------

      if (
        now - lastMLAlertAt < ML_COOLDOWN_MS ||
        mlAlertInProgress
      ) {

        console.log("ML: Notification cooldown active");

        return;
      }

      mlAlertInProgress = true;
      lastMLAlertAt = now;

      // --------------------------------------------
      // 7. Fetch GPS from existing sensorData
      // --------------------------------------------

      try {

        const sensorSnapshot = await database
          .ref("sensorData")
          .once("value");

        const sensor = sensorSnapshot.val() || {};

        const notificationData = {

          latitude: sensor.latitude,

          longitude: sensor.longitude,

          gpsValid: sensor.gpsValid,

          timestamp: predictionTimestamp,

          probability: ml.probability

        };

        // ------------------------------------------
        // 8. Record ML emergency in analytics
        // ------------------------------------------

        void recordEmergency(
          "fall",
          notificationData,
          "sisfall-rf"
        );

        // ------------------------------------------
        // 9. Send notification using existing FCM
        // ------------------------------------------

        if (
          process.env.ENABLE_ML_NOTIFICATIONS === "true"
        ) {

          console.log(
            "ML: Sending fall notification through FCM"
          );

          await sendFallNotifications(notificationData);

          console.log(
            "ML: Notification dispatch completed"
          );

        } else {

          console.log(
            "ML: Fall recorded; notifications disabled"
          );

        }

      } catch (error) {

        console.error(
          "ML notification processing error:",
          error
        );

      } finally {

        mlAlertInProgress = false;

      }

    },

    (error) => {

      console.error(
        "ML Firebase listener error:",
        error
      );

    }
  );
}


// Optional shared secret for existing device/server callers. Configure caller first.
function authorizeAlert(req, res, next) {
  const secret = process.env.ALERT_API_KEY;
  const supplied = req.get('X-API-Key') || '';
  const crypto = require('node:crypto');
  if (secret && (Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
      !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(supplied)))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// History failures never suppress emergency delivery. Existing fallEvents untouched.
async function recordEmergency(type, sensor, source) {
  if (process.env.ENABLE_ANALYTICS !== 'true') return;
  try {
    const now = Date.now();
    const event = { type, source, timestamp: now };
    if (Number.isFinite(sensor.probability)) event.probability = sensor.probability;
    if (sensor.gpsValid === true && Number.isFinite(sensor.latitude) &&
        Number.isFinite(sensor.longitude) && Math.abs(sensor.latitude) <= 90 &&
        Math.abs(sensor.longitude) <= 180) {
      event.latitude = sensor.latitude;
      event.longitude = sensor.longitude;
      event.gpsValid = true;
    }
    await database.ref('analytics/events').push(event);
    const cutoff = now - 365 * 86400000;
    const expired = await database.ref('analytics/events').orderByChild('timestamp')
      .endAt(cutoff).limitToFirst(100).once('value');
    const updates = {};
    expired.forEach(child => { updates[child.key] = null; });
    if (Object.keys(updates).length) await database.ref('analytics/events').update(updates);
  } catch (_) { console.error('Emergency history write failed; continuing alert delivery'); }
}
