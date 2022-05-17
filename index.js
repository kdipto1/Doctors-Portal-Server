const { MongoClient, ServerApiVersion } = require("mongodb");
const jwt = require("jsonwebtoken");
const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 5000;
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");

//middleware
app.use(cors());
app.use(express.json());

const emailSenderOptions = {
  auth: {
    api_key: process.env.EMAIL_SENDER_KEY,
  },
};
const emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));
//Email sender function
function sendAppointmentEmail(booking) {
  const { patient, patientName, treatment, date, slot } = booking;
  var email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `Your appointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    text: `Your appointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    html: `<div>
    <p>Hello ${patientName}</p>
    <h4>Yor appointment for ${treatment} is confirmed</h4>
    <p>Looking forward to seeing you on ${date} at ${slot}</p>
    <p>Our Address:</p>
    <p>Dhaka, Bangladesh</p>
    <a href="https://www.programming-hero.com/">Subscribe</a>
    </div>`,
  };
  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log("Message sent: ", info);
    }
  });
}
//Verify token function:
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
  });
}

//MongoDb
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.iqxdx.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});
async function run() {
  try {
    await client.connect();
    //provided services
    const serviceCollection = client.db("doctors_portal").collection("service");
    // users bookings
    const bookingCollection = client.db("doctors_portal").collection("booking");
    // users
    const userCollection = client.db("doctors_portal").collection("users");
    //Doctor collection
    const doctorCollection = client.db("doctors_portal").collection("doctors");

    //Verify admin function
    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "Forbidden Access" });
      }
    };

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query);
      const services = await cursor.toArray();
      res.send(services);
    });
    // Get users
    app.get("/user", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });
    //admin get API
    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });
    //admin make api
    app.put("/user/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount === "admin") {
        const filter = { email: email };
        const updateDoc = {
          $set: { role: "admin" },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      } else {
        res.status(403).send({ message: "Forbidden" });
      }
    });
    // user put
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const option = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, option);
      const token = jwt.sign(
        { email: email },
        process.env.ACCCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ result: result, token: token });
    });

    // Warning: This is not the proper way to query multiple collection.
    // After learning more about mongodb. use aggregate, lookup, pipeline, match, group
    app.get("/available", async (req, res) => {
      const date = req?.query?.date || "May 14, 2022";
      //step 1: get all services
      const services = await serviceCollection.find().toArray();

      //step 2 : get the booking of the day
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();
      //step 3 : for each service
      services.forEach((service) => {
        //step 4: find bookings for that service
        const serviceBooking = bookings.filter(
          (book) => book.treatment === service.name
        );
        //step 5: select slots for the service bookings:
        const bookedSlots = serviceBooking.map((book) => book.slot);
        //step 6 : select those slotsthat are not in bookedSlots
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        //step 7: set available to slots to make it easier
        service.slots = available;
      });
      res.send(services);
    });
    /**
     * API Naming Convention
     * app.get('/booking') // get all bookings in this collection. or get more than one or by filter
     * app.get('/booking/:id') // get a specific booking
     * app.post('/booking') // add a new booking
     * app.patch('/booking/:id) //
     * app.delete('/booking/:id) //
     */
    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingCollection.find(query).toArray();
        return res.send(bookings);
      } else {
        return res.status(403).send({ message: "Forbidden access" });
      }
    });
    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingCollection.insertOne(booking);
      sendAppointmentEmail(booking);
      return res.send({ success: true, result: result });
    });
    //get all doctors
    app.get("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.send(doctors);
    });
    //adding doctors API
    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });
    //delete doctor
    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
      res.send(result);
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("Doctor server root path🐧");
});

app.listen(port, () => {
  console.log(`Doctors app listening on port ${port}`);
});
