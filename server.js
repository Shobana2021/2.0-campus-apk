
const express = require("express");
const { Pool } = require("pg");
const admin = require("firebase-admin");

const app = express();

app.use(express.json());

// Firebase Admin must have valid credentials configured.
if (!admin.apps.length) {
  admin.initializeApp();
}

// PostgreSQL connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined
});

// Verify Firebase login token
const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "");

    if (!token) {
      return res.status(401).json({
        error: "Login required"
      });
    }

    req.u = await admin.auth().verifyIdToken(token);
    next();
  } catch (e) {
    return res.status(401).json({
      error: "Invalid or expired login token"
    });
  }
};

// Find database user using authenticated email
async function findUser(email) {
  const result = await db.query(
    "SELECT id FROM users WHERE email = $1",
    [email]
  );

  return result.rows[0] || null;
}

// Send notification to a user if an FCM token exists
async function push(userId, body) {
  try {
    const result = await db.query(
      "SELECT fcm_token FROM users WHERE id = $1",
      [userId]
    );

    const token = result.rows[0]?.fcm_token;

    if (token) {
      await admin.messaging().send({
        token,
        notification: {
          title: "Smart Campus",
          body
        }
      });
    }
  } catch (e) {
    console.error("Notification error:", e.message);
  }
}

// Health check
app.get("/", (req, res) => {
  res.json({
    message: "Smart Campus backend is running"
  });
});

// Create a facility booking
app.post("/book", auth, async (req, res) => {
  const { facility_id, day, period } = req.body;

  if (
    facility_id === undefined ||
    facility_id === null ||
    facility_id === "" ||
    !day ||
    period === undefined ||
    period === null ||
    period === ""
  ) {
    return res.status(400).json({
      error: "Facility, date and period are required"
    });
  }

  // Require a valid YYYY-MM-DD date
  if (
    typeof day !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number.isNaN(Date.parse(day)) ||
    new Date(day).toISOString().slice(0, 10) !== day
  ) {
    return res.status(400).json({
      error: "Invalid booking date"
    });
  }

  try {
    const user = await findUser(req.u.email);

    if (!user) {
      return res.status(403).json({
        error: "Student account not found"
      });
    }

    const result = await db.query(
      `INSERT INTO bookings
       (facility_id, user_id, day, period, status)
       VALUES ($1, $2, $3, $4, 'booked')
       RETURNING id`,
      [facility_id, user.id, day, period]
    );

    return res.status(201).json({
      id: result.rows[0].id,
      message: "Booking successful"
    });
  } catch (e) {
    if (e.code === "23505" || e.code === "23P01") {
      return res.status(409).json({
        error: "This booking slot is already unavailable"
      });
    }

    console.error("Booking error:", e.message);

    return res.status(500).json({
      error: "Unable to complete booking"
    });
  }
});

// Watch a facility time slot
app.post("/watch", auth, async (req, res) => {
  const { facility_id, day, period } = req.body;

  if (
    facility_id === undefined ||
    facility_id === null ||
    !day ||
    period === undefined ||
    period === null
  ) {
    return res.status(400).json({
      error: "Facility, date and period are required"
    });
  }

  try {
    const user = await findUser(req.u.email);

    if (!user) {
      return res.status(403).json({
        error: "Student account not found"
      });
    }

    await db.query(
      `INSERT INTO watches
       (user_id, facility_id, day, period)
       VALUES ($1, $2, $3, $4)`,
      [user.id, facility_id, day, period]
    );

    return res.status(201).json({
      ok: true,
      message: "Slot watch added"
    });
  } catch (e) {
    console.error("Watch error:", e.message);

    return res.status(500).json({
      error: "Unable to watch this slot"
    });
  }
});

// Cancel a booking and notify users watching that slot
app.post("/cancel/:id", auth, async (req, res) => {
  try {
    const user = await findUser(req.u.email);

    if (!user) {
      return res.status(403).json({
        error: "Student account not found"
      });
    }

    const result = await db.query(
      `UPDATE bookings
       SET status = 'cancelled'
       WHERE id = $1
         AND user_id = $2
         AND status = 'booked'
       RETURNING facility_id, day, period`,
      [req.params.id, user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Booking not found or already cancelled"
      });
    }

    const booking = result.rows[0];

    const watchers = await db.query(
      `DELETE FROM watches
       WHERE facility_id = $1
         AND day = $2
         AND period = $3
       RETURNING user_id`,
      [
        booking.facility_id,
        booking.day,
        booking.period
      ]
    );

    await Promise.all(
      watchers.rows.map((watcher) =>
        push(
          watcher.user_id,
          "A slot you were watching is now available."
        )
      )
    );

    return res.json({
      ok: true,
      message: "Booking cancelled successfully"
    });
  } catch (e) {
    console.error("Cancellation error:", e.message);

    return res.status(500).json({
      error: "Unable to cancel booking"
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Smart Campus backend running on port ${PORT}`);
});
