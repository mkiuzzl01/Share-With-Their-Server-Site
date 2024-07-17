const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());

//Token Verify
const verifyToken = (req, res, next) => {
  // console.log(req.headers.authorization);
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorize access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorize access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster0.rbychrh.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const usersCollection = client.db("ShareWithTheir").collection("users");
    const transactionCollection = client
      .db("ShareWithTheir")
      .collection("Total-Transaction");

    // ========================= All Get Request =======================================

    //On Auth Observer Set
    app.get("/user/:emailOrPhone", async (req, res) => {
      const { emailOrPhone } = req.params;

      let user;
      if (emailOrPhone.includes("@")) {
        user = await usersCollection.findOne({ Email: emailOrPhone });
      } else {
        user = await usersCollection.findOne({ Phone: emailOrPhone });
      }
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send(user);
    });

    //Transaction History
    app.get("/Transaction", async (req, res) => {
      const result = await transactionCollection.find().toArray();
      res.send(result);
    });

    // ========================= All Post Request =============================
    //send money
    app.post("/send-money", async (req, res) => {
      const info = req.body;

      // Validate amount
      const amount = parseFloat(info?.amount);
      if (amount < 50) {
        return res
          .status(400)
          .send({ message: "Minimum transaction amount is 50 Taka" });
      }

      // Find sender and receiver
      const sender = await usersCollection.findOne({
        Email: info?.user?.Email,
      });

      let receiver;
      if (info?.receiver.includes("@")) {
        receiver = await usersCollection.findOne({
          Email: info?.receiver,
        });
      } else {
        receiver = await usersCollection.findOne({
          Phone: info?.receiver,
        });
      }

      if (!sender || !receiver) {
        return res
          .status(404)
          .send({ message: "Sender or receiver not found" });
      }

      // Verify PIN
      const isPinMatch = await bcrypt.compare(info?.pin, sender?.Pin);
      if (!isPinMatch) {
        return res.status(400).send({ message: "Invalid PIN" });
      }
      // Calculate fee and total deduction

      let fee = 0;
      if (amount > 100) {
        fee = 5;
      }
      const totalDeduction = amount + fee;

      // Check sender's balance

      if (sender.Balance < totalDeduction) {
        return res.status(400).send({ message: "Insufficient balance" });
      }

      // Update balances
      await usersCollection.updateOne(
        { _id: new ObjectId(sender?._id) },
        { $inc: { Balance: -totalDeduction } }
      );
      await usersCollection.updateOne(
        { _id: new ObjectId(receiver?._id) },
        { $inc: { Balance: +amount } }
      );

      //set transaction history
      const doc = {
        Sender: {
          Name: sender.Name,
          Email: sender.Email,
          Phone: sender.Phone,
          Sended_Amount: amount,
          Fee: totalDeduction - amount,
          time: new Date(),
        },
        Receiver: {
          Name: receiver.Name,
          Email: receiver.Email,
          Phone: receiver.Phone,
          Received_Amount: amount,
          time: new Date(),
        },
      };
      await transactionCollection.insertOne(doc);
      res.send({ message: "Transaction successful" });
    });

    // Register User
    app.post("/register", async (req, res) => {
      const userInfo = req.body;
      // Hash the PIN
      const salt = await bcrypt.genSalt(10);
      const hashedPin = await bcrypt.hash(userInfo.pin, salt);
      const newUser = {
        Name: userInfo.name,
        Email: userInfo.email,
        Phone: userInfo.phone,
        Pin: hashedPin,
        Status: userInfo.status,
        Role: userInfo.role,
        Balance: userInfo.balance,
      };
      await usersCollection.insertOne(newUser);
      res.send({ message: "User registered successfully" });
    });

    // Login User
    app.post("/login", async (req, res) => {
      const info = req.body;
      let user;
      if (info?.emailOrPhone.includes("@")) {
        user = await usersCollection.findOne({ Email: info?.emailOrPhone });
      } else {
        user = await usersCollection.findOne({ Phone: info?.emailOrPhone });
      }

      if (!user) {
        return res.status(400).send({ message: "Invalid credentials" });
      }

      const isMatch = await bcrypt.compare(info.pin, user.Pin);
      if (!isMatch) {
        return res.status(400).send({ message: "Invalid credentials" });
      }

      const token = jwt.sign(info, process.env.ACCESS_TOKEN, {
        expiresIn: "1h",
      });

      res.send({ user, token });
    });

    app.get("/", (req, res) => {
      res.send("ShareWithTheir server is running");
    });
    app.listen(port, () => {
      console.log("ShareWithTheir Connect With:", port);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
