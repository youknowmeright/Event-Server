require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

// ========== MONGODB SETUP ==========
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster2.8qeyj7g.mongodb.net/?appName=Cluster2`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Serve uploaded images
app.use('/uploads', express.static('uploads'));

// ========== MULTER SETUP FOR IMAGE UPLOADS ==========
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'event-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const isMime = allowedTypes.test(file.mimetype);
    const isExt = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (isMime && isExt) return cb(null, true);
    cb(new Error('Only images allowed!'));
  }
});

// ========== START SERVER ==========
async function run() {
  try {
    // await client.connect();
    // console.log("✅ MongoDB connected successfully!");

    const database = client.db('event-management');
    const eventsCollection = database.collection("events");
    const usersCollection = database.collection("users");
    const bookingsCollection = database.collection("bookings");
    const reviewsCollection = database.collection("reviews");

    const ADMIN_EMAIL = "admin@event.com";
    const ADMIN_PASSWORD = "admin123";

    // ========== MIDDLEWARE ==========
    const verifyUser = async (req, res, next) => {
      try {
        const email = req.headers['user-email'] || req.body.email;
        if (!email) return res.status(401).send({ error: "User email required" });
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(401).send({ error: "User not found" });
        req.user = { email: user.email, role: user.role };
        next();
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.headers['admin-email'] || req.body.email;
        const password = req.headers['admin-password'] || req.body.password;

        if (!email || !password) return res.status(401).send({ error: "Admin email and password required" });
        if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) return res.status(401).send({ error: "Invalid admin credentials" });

        req.admin = { email: ADMIN_EMAIL, role: "admin" };
        next();
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    };

    // ========== AUTH ROUTES ==========
    app.post('/auth/admin/login', async (req, res) => {
      try {
        const { email, password } = req.body;
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
          return res.send({ message: "Admin login successful", user: { email: ADMIN_EMAIL, role: "admin" } });
        }
        res.status(401).send({ error: "Invalid admin credentials" });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ========== USER ROUTES ==========
    app.post('/users', async (req, res) => {
      try {
        const user = req.body;
        const exists = await usersCollection.findOne({ email: user.email });

        if (exists) {
          const userResponse = { ...exists };
          delete userResponse.password;
          return res.send({ message: "User already exists", user: userResponse });
        }

        user.role = "user";
        user.createdAt = new Date();
        user.profilePicture = user.profilePicture || "";
        user.phone = user.phone || "";
        user.emailVerified = user.emailVerified || false;

        const result = await usersCollection.insertOne(user);
        const newUser = await usersCollection.findOne({ _id: result.insertedId });
        delete newUser.password;
        res.send({ message: "User created successfully", user: newUser });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // for testing purpose only 
    app.get("/events", async (req, res) => {
      const events = await eventsCollection.find().toArray();
      res.send(events);
    });
    app.get("/bookings", async (req, res) => {
      const bookings = await bookingsCollection.find().toArray();
      res.send(bookings);
    });
    app.get("/reviews", async (req, res) => {
      const reviews = await reviewsCollection.find().toArray();
      res.send(reviews);
    });
    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });
    // end of testing purpose only 🥺

    app.get('/users/:email', async (req, res) => {
      try {
        const user = await usersCollection.findOne({ email: req.params.email });
        if (!user) return res.status(404).send({ error: "User not found" });
        const userResponse = { ...user };
        delete userResponse.password;
        res.send(userResponse);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get('/users/admin/:email', async (req, res) => {
      try {
        const email = req.params.email;
        if (email === ADMIN_EMAIL) return res.send({ admin: true });
        const user = await usersCollection.findOne({ email });
        res.send({ admin: user?.role === "admin" });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.patch('/users/:email', verifyUser, async (req, res) => {
      try {
        const email = req.params.email;
        const userEmail = req.user.email;
        if (email !== userEmail && req.user.role !== "admin") {
          return res.status(403).send({ error: "Unauthorized" });
        }

        const updateData = req.body;
        if (updateData.role && req.user.role !== "admin") delete updateData.role;
        if (updateData.password) delete updateData.password;

        const result = await usersCollection.updateOne(
          { email: email },
          { $set: updateData }
        );
        if (result.matchedCount === 0) return res.status(404).send({ error: "User not found" });

        const updatedUser = await usersCollection.findOne({ email: email });
        delete updatedUser.password;
        res.send({ message: "Profile updated successfully", user: updatedUser });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ========== EVENT ROUTES ==========
    app.get('/events', async (req, res) => {
      try {
        const { search, category } = req.query;
        let query = {};
        if (search) query.$or = [
          { eventName: { $regex: search, $options: 'i' } },
          { category: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
        if (category) query.category = category;
        const data = await eventsCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.send(data);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get('/events/featured', async (req, res) => {
      try {
        const data = await eventsCollection.find()
          .sort({ createdAt: -1 })
          .limit(3)
          .toArray();
        res.send(data);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get('/events/:id', async (req, res) => {
      try {
        const event = await eventsCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!event) return res.status(404).send({ error: "Event not found" });
        res.send(event);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.post('/events', verifyAdmin, async (req, res) => {
      try {
        const event = { ...req.body, createdAt: new Date() };
        event.availableSeats = parseInt(event.availableSeats) || 0;
        event.registrationFee = parseFloat(event.registrationFee) || 0;
        const result = await eventsCollection.insertOne(event);
        const newEvent = await eventsCollection.findOne({ _id: result.insertedId });
        res.send({ message: "Event created successfully", event: newEvent });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.patch('/events/:id', verifyAdmin, async (req, res) => {
      try {
        const updateData = req.body;
        const result = await eventsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: updateData }
        );
        if (result.matchedCount === 0) return res.status(404).send({ error: "Event not found" });
        const updatedEvent = await eventsCollection.findOne({ _id: new ObjectId(req.params.id) });
        res.send({ message: "Event updated successfully", event: updatedEvent });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.delete('/events/:id', verifyAdmin, async (req, res) => {
      try {
        const result = await eventsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).send({ error: "Event not found" });
        res.send({ message: "Event deleted successfully" });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ========== BOOKING ROUTES ==========
    app.post('/bookings', verifyUser, async (req, res) => {
      try {
        const { eventId, numberOfTickets, phone, paymentMethod } = req.body;
        if (!eventId || !numberOfTickets) return res.status(400).send({ error: "Missing required fields" });

        const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
        if (!event) return res.status(404).send({ error: "Event not found" });

        // Check registration deadline
        if (event.registrationDeadline && new Date(event.registrationDeadline) < new Date()) {
          return res.status(400).send({ error: "Registration deadline has passed" });
        }

        // Fix: Convert eventId to string for consistency
        const eventIdString = eventId.toString();
        const booked = await bookingsCollection.aggregate([
          { $match: { eventId: eventIdString } },
          { $group: { _id: null, total: { $sum: "$numberOfTickets" } } }
        ]).toArray();

        const totalBooked = booked[0]?.total || 0;
        const remainingSeats = event.availableSeats - totalBooked;
        if (parseInt(numberOfTickets) > remainingSeats) {
          return res.status(400).send({ error: "Not enough seats available" });
        }

        // Get user details
        const user = await usersCollection.findOne({ email: req.user.email });

        const booking = {
          eventId: eventIdString,
          userEmail: req.user.email,
          userName: user?.name || req.user.email,
          userPhone: phone || user?.phone || "",
          numberOfTickets: parseInt(numberOfTickets),
          paymentMethod: paymentMethod || "",
          status: "confirmed",
          createdAt: new Date()
        };

        const result = await bookingsCollection.insertOne(booking);
        const newBooking = await bookingsCollection.findOne({ _id: result.insertedId });
        res.send({ message: "Booking confirmed", booking: newBooking });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get('/bookings/user/:email', verifyUser, async (req, res) => {
      try {
        const email = req.params.email;
        const userEmail = req.user.email;
        if (email !== userEmail && req.user.role !== "admin") {
          return res.status(403).send({ error: "Unauthorized" });
        }

        const bookings = await bookingsCollection.find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        // Populate event details
        const bookingsWithEvents = await Promise.all(
          bookings.map(async (booking) => {
            const event = await eventsCollection.findOne({ _id: new ObjectId(booking.eventId) });
            return { ...booking, event };
          })
        );

        res.send(bookingsWithEvents);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.delete('/bookings/:id', verifyUser, async (req, res) => {
      try {
        const bookingId = req.params.id;
        const userEmail = req.user.email;

        const booking = await bookingsCollection.findOne({ _id: new ObjectId(bookingId) });
        if (!booking) return res.status(404).send({ error: "Booking not found" });

        if (booking.userEmail !== userEmail && req.user.role !== "admin") {
          return res.status(403).send({ error: "Unauthorized" });
        }

        const result = await bookingsCollection.deleteOne({ _id: new ObjectId(bookingId) });
        res.send({ message: "Booking cancelled successfully" });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ========== REVIEW ROUTES ==========
    app.post('/reviews', verifyUser, async (req, res) => {
      try {
        const { eventId, rating, comment } = req.body;
        const userEmail = req.user.email;

        if (!eventId || !rating) return res.status(400).send({ error: "Missing required fields" });

        // Check if user has booked this event
        const booking = await bookingsCollection.findOne({
          userEmail: userEmail,
          eventId: eventId.toString()
        });

        if (!booking) {
          return res.status(400).send({ error: "You must book this event before reviewing" });
        }

        const review = {
          eventId: eventId.toString(),
          userEmail: userEmail,
          rating: parseInt(rating),
          comment: comment || "",
          createdAt: new Date()
        };

        const result = await reviewsCollection.insertOne(review);
        const newReview = await reviewsCollection.findOne({ _id: result.insertedId });
        res.send({ message: "Review added successfully", review: newReview });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get('/reviews/event/:eventId', async (req, res) => {
      try {
        const reviews = await reviewsCollection.find({ eventId: req.params.eventId })
          .sort({ createdAt: -1 })
          .toArray();

        const reviewsWithUsers = await Promise.all(
          reviews.map(async (review) => {
            const user = await usersCollection.findOne({ email: review.userEmail });
            return {
              ...review,
              userName: user?.name || "Anonymous",
              userImage: user?.profilePicture || ""
            };
          })
        );

        res.send(reviewsWithUsers);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get('/reviews/recent', async (req, res) => {
      try {
        const reviews = await reviewsCollection.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();

        const reviewsWithDetails = await Promise.all(
          reviews.map(async (review) => {
            const user = await usersCollection.findOne({ email: review.userEmail });
            const event = await eventsCollection.findOne({ _id: new ObjectId(review.eventId) });
            return {
              ...review,
              userName: user?.name || "Anonymous",
              userImage: user?.profilePicture || "",
              eventName: event?.eventName || "Unknown Event"
            };
          })
        );

        res.send(reviewsWithDetails);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ========== IMAGE UPLOAD ==========
    app.post('/upload/event-image', verifyAdmin, upload.single('image'), async (req, res) => {
      try {
        if (!req.file) return res.status(400).send({ error: "No image file" });
        const imageUrl = `/uploads/${req.file.filename}`;
        res.send({ message: "Image uploaded", imageUrl, filename: req.file.filename });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ========== STRIPE PAYMENT ==========
    app.post('/create-payment-intent', async (req, res) => {
      try {
        const { amount } = req.body;

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

  } finally {
    // connection stays open
  }
}

run().catch(console.dir);

// DEFAULT ROUTE
app.get('/', (req, res) => {
  res.send('Event management server is running smoothly');
});

// START SERVER
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;
