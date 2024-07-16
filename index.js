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
