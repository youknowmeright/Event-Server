
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

// ===================== MONGODB =====================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster2.8qeyj7g.mongodb.net/?appName=Cluster2`;

let client;
let db;
let usersCollection;
let eventsCollection;
let bookingsCollection;

async function connectDB() {
  if (db) return;

  client = new MongoClient(uri);
  await client.connect();

  db = client.db('event-management');
  usersCollection = db.collection('users');
  eventsCollection = db.collection('events');
  bookingsCollection = db.collection('bookings');

  // console.log('✅ MongoDB connected');
}

// ===================== ADMIN =====================
const ADMIN_EMAIL = "admin@event.com";
const ADMIN_PASSWORD = "admin123";

const verifyAdmin = (req, res, next) => {
  const email = req.headers['admin-email'] || req.body.email;
  const password = req.headers['admin-password'] || req.body.password;

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(403).send({ error: "Unauthorized admin" });
  }
  next();
};

// ===================== ROUTES =====================
app.get('/', async (req, res) => {
  await connectDB();
  res.send('Event management server is running smoothly');
});

// USERS
app.post('/users', async (req, res) => {
  await connectDB();
  const user = req.body;

  const exists = await usersCollection.findOne({ email: user.email });
  if (exists) return res.send({ message: "User already exists" });

  user.role = "user";
  user.createdAt = new Date();

  const result = await usersCollection.insertOne(user);
  res.send(result);
});

app.get('/users', async (req, res) => {
  await connectDB();
  const users = await usersCollection.find().toArray();
  res.send(users);
});

app.get('/users/:email', async (req, res) => {
  await connectDB();
  const user = await usersCollection.findOne({ email: req.params.email });
  if (!user) return res.status(404).send({ error: "User not found" });

  delete user.password;
  res.send(user);
});

// EVENTS
app.get('/events', async (req, res) => {
  await connectDB();
  const events = await eventsCollection.find().toArray();
  res.send(events);
});

app.get('/events/:id', async (req, res) => {
  await connectDB();
  const event = await eventsCollection.findOne({ _id: new ObjectId(req.params.id) });
  if (!event) return res.status(404).send({ error: "Event not found" });
  res.send(event);
});

app.post('/events', verifyAdmin, async (req, res) => {
  await connectDB();
  const event = {
    ...req.body,
    availableSeats: Number(req.body.availableSeats),
    registrationFee: Number(req.body.registrationFee),
    createdAt: new Date()
  };
  const result = await eventsCollection.insertOne(event);
  res.send(result);
});

// BOOKINGS
app.post('/bookings', async (req, res) => {
  await connectDB();
  const { eventId, numberOfTickets, userEmail } = req.body;

  const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
  if (!event) return res.status(404).send({ error: "Event not found" });

  const booked = await bookingsCollection.aggregate([
    { $match: { eventId } },
    { $group: { _id: null, total: { $sum: "$numberOfTickets" } } }
  ]).toArray();

  const totalBooked = booked[0]?.total || 0;
  if (numberOfTickets > event.availableSeats - totalBooked) {
    return res.status(400).send({ error: "Not enough seats" });
  }

  const booking = {
    eventId,
    userEmail,
    numberOfTickets,
    createdAt: new Date()
  };

  const result = await bookingsCollection.insertOne(booking);
  res.send(result);
});

// ===================== LOCAL ONLY =====================
if (process.env.NODE_ENV !== 'production') {
  // app.listen(port, () => {
  //   console.log(`🚀 Local server running on http://localhost:${port}`);
  // });
}

module.exports = app;
