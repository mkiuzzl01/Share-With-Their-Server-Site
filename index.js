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

//local database
// const uri = "mongodb://localhost:27017/";

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

    const database = client.db("ShareWithTheir");
    const usersCollection = database.collection("users");
    const transactionCollection = database.collection("Total-Transaction");
    const requestCollection = database.collection("RequestWithAgent");
    const sendMoneyCollection = database.collection("Send_Money");
    const cashInCollection = database.collection("Cash_In");
    const cashOutCollection = database.collection("Cash_Out");

    // ========================= All Get Request =======================================

    //On Auth Observer Set
    app.get("/user/:emailOrPhone", verifyToken, async (req, res) => {
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

    //All Users
    app.get("/users", verifyToken, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // All Transaction History
    app.get("/Transaction-History", verifyToken, async (req, res) => {
      const search = req.query.search;

      let query = {};
      if (search) {
        query = {
          Email: { $regex: search, $options: "i" },
        };
      }

      const send_Money = await sendMoneyCollection
        .find(query)
        .sort({ time: -1 })
        .toArray();
      const cash_In = await cashInCollection
        .find(query)
        .sort({ time: -1 })
        .toArray();
      const cash_Out = await cashOutCollection
        .find(query)
        .sort({ time: -1 })
        .toArray();
      const result = send_Money.concat(cash_In, cash_Out);
      res.send(result);
    });

    // Transaction History by Email
    app.get("/transaction/:email", verifyToken, async (req, res) => {
      const { email } = req.params;
      try {
        const find = await usersCollection.findOne({ Email: email });

        let limit = 0;
        if (find.Role === "User") {
          limit = 10;
        }
        if (find.Role === "Agent") {
          limit = 20;
        }

        const send_Money = await sendMoneyCollection
          .find({ Sender: email })
          .sort({ time: -1 })
          .toArray();
        const cash_In = await cashInCollection
          .find({ Receiver: email })
          .sort({ time: -1 })
          .toArray();

        const cash_out = await cashOutCollection
          .find({ Sender: email })
          .sort({ time: -1 })
          .toArray();

        const result = [...send_Money, ...cash_In, ...cash_out].splice(
          0,
          limit
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    //Transaction Management
    app.get("/Transaction-Management/:email", verifyToken, async (req, res) => {
      const { email } = req.params;
      const query = { Agent: email };
      const result = await requestCollection
        .find(query)
        .sort({ time: -1 })
        .toArray();
      res.send(result);
    });
    // ========================= All Patch Request ============================

    //status Approve
    app.patch("/user-Approve", verifyToken, async (req, res) => {
      const { id } = req.body;
      try {
        const find = await usersCollection.findOne({ _id: new ObjectId(id) });

        let setBalance = 0;
        if (find.Role === "User") {
          setBalance = 50;
        }
        if (find.Role === "Agent") {
          setBalance = 10000;
        }

        const query = { _id: new ObjectId(id) };
        const options = { upsert: true };
        const doc = { $set: { Status: "Approved", Balance: setBalance } };

        await usersCollection.updateOne(query, doc, options);
        res.send({ message: "User Approve Successfully" });
      } catch (error) {
        res.status(404).send({ message: "Something Wrong" });
      }
    });

    //status Block
    app.patch("/user-block", verifyToken, async (req, res) => {
      const { id } = req.body;
      try {
        const query = { _id: new ObjectId(id) };
        const options = { upsert: true };
        const doc = { $set: { Status: "Blocked" } };
        await usersCollection.updateOne(query, doc, options);
        res.send({ message: "User Blocked Successfully" });
      } catch (error) {
        res.status(404).send({ message: "Something Wrong" });
      }
    });

    // Cash Outed Request
    app.patch("/requested-cash-out", verifyToken, async (req, res) => {
      const info = req.body;
      const user = await usersCollection.findOne({ Email: info.Email });
      const agent = await usersCollection.findOne({ Email: info.Agent });

      if (!user || !agent) {
        return res.status(404).send({ message: "User or Agent Not Found" });
      }

      // Calculate fee and total deduction
      const fee = (info?.Cash_Outed_Amount * 1.5) / 100;
      const totalDeduction = info?.Cash_Outed_Amount + fee;

      //updated balance
      await usersCollection.updateOne(
        { _id: new ObjectId(user?._id) },
        { $inc: { Balance: -totalDeduction } }
      );
      await usersCollection.updateOne(
        { _id: new ObjectId(agent?._id) },
        { $inc: { Balance: +info?.Cash_Outed_Amount } }
      );

      //add to history
      const cash_Out = {
        Type: "Cash Out",
        Sender: user.Email,
        Name: agent.Name,
        Email: agent.Email,
        Phone: agent.Phone,
        Sended_Amount: info?.Cash_Outed_Amount,
        Fee: fee,
        time: new Date().toLocaleString(),
      };

      const cash_In = {
        Type: "Cash In",
        Receiver: agent.Email,
        Name: user.Name,
        Email: user.Email,
        Phone: user.Phone,
        Received_Amount: info?.Cash_Outed_Amount,
        time: new Date().toLocaleString(),
      };

      await cashInCollection.insertOne(cash_In);
      await cashOutCollection.insertOne(cash_Out);

      //delete in request history
      await requestCollection.deleteOne({ _id: new ObjectId(info._id) });
      res.send({ message: "Cash Out Approve Successfully" });
    });

    //Cash In
    app.patch("/requested-cash-in", verifyToken, async (req, res) => {
      const info = req.body;

      const user = await usersCollection.findOne({ Email: info.Email });
      const agent = await usersCollection.findOne({ Email: info.Agent });

      if (!user || !agent) {
        return res.status(404).send({ message: "User or Agent Not Found" });
      }

      if (info?.Requested_Amount > agent?.Balance) {
        return res.status(400).send({ message: "Insufficient balance" });
      }

      try {
        await usersCollection.updateOne(
          { Email: info.Email },
          { $inc: { Balance: +info?.Requested_Amount } }
        );
        await usersCollection.updateOne(
          { Email: info.Agent },
          { $inc: { Balance: -info?.Requested_Amount } }
        );

        //add to history
        const cashIn = {
          Type: "Cash In",
          Receiver: user?.Email,
          Name: agent.Name,
          Email: agent.Email,
          Phone: agent.Phone,
          Received_Amount: info?.Requested_Amount,
          time: new Date().toLocaleString(),
        };
        const cashOut = {
          Type: "Cash Out",
          Sender: agent.Email,
          Name: user.Name,
          Email: user.Email,
          Phone: user.Phone,
          Fee: 0,
          Sended_Amount: info?.Requested_Amount,
          time: new Date().toLocaleString(),
        };

        await cashInCollection.insertOne(cashIn);
        await cashOutCollection.insertOne(cashOut);

        //delete form history
        await requestCollection.deleteOne({ _id: new ObjectId(info?._id) });
        res.send({ message: "Cash In Request Approve Successfully" });
      } catch (error) {
        res.status(404).send({ message: error.message });
      }
    });
    // ========================= All Post Request =============================
    //send money
    app.post("/send-money", verifyToken, async (req, res) => {
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

      if (sender?.Email === receiver?.Email) {
        return res.status(404).send({ message: "Something Wrong" });
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
      const cash_In = {
        Type: "Cash In",
        Receiver: receiver.Email,
        Name: sender.Name,
        Email: sender.Email,
        Phone: sender.Phone,
        Received_Amount: amount,
        time: new Date().toLocaleString(),
      };

      const send_Money = {
        Type: "Send Money",
        Sender: sender.Email,
        Name: receiver.Name,
        Email: receiver.Email,
        Phone: receiver.Phone,
        Sended_Amount: amount,
        Fee: totalDeduction - amount,
        time: new Date().toLocaleString(),
      };

      await cashInCollection.insertOne(cash_In);
      await sendMoneyCollection.insertOne(send_Money);
      res.send({ message: "Transaction successful" });
    });

    //Cash Out
    app.post("/cash-out", verifyToken, async (req, res) => {
      const info = req.body;

      const amount = parseFloat(info?.amount);
      if (amount < 50) {
        return res
          .status(400)
          .send({ message: "Minimum transaction amount is 50 Taka" });
      }

      const user = await usersCollection.findOne({ Email: info.user?.Email });

      let agent;
      if (info?.agent.includes("@")) {
        agent = await usersCollection.findOne({ Email: info?.agent });
      } else {
        agent = await usersCollection.findOne({ Phone: info?.agent });
      }

      if (agent?.Role !== "Agent") {
        return res.status(404).send({ message: "This is not an agent" });
      }
      if (user?.Email === agent?.Email) {
        return res.status(404).send({ message: "Something Wrong" });
      }
      if (!user || !agent) {
        return res.status(404).send({ message: "User or agent not found" });
      }

      // Verify PIN
      const isPinMatch = await bcrypt.compare(info?.pin, user.Pin);
      if (!isPinMatch) {
        return res.status(400).send({ message: "Invalid PIN" });
      }

      // Check user's balance
      if (user.Balance < amount) {
        return res.status(400).send({ message: "Insufficient balance" });
      }

      // Set transaction history
      const doc = {
        Name: user?.Name,
        Email: user?.Email,
        Agent: agent?.Email,
        Phone: user?.Phone,
        Cash_Outed_Amount: amount,
        time: new Date().toLocaleString(),
      };

      await requestCollection.insertOne(doc);
      res.send({ message: "Cash out request successful" });
    });

    //Cash In
    app.post("/cash-in", verifyToken, async (req, res) => {
      const info = req.body;

      const user = await usersCollection.findOne({ Email: info.user?.Email });

      let agent;
      if (info?.agent.includes("@")) {
        agent = await usersCollection.findOne({ Email: info?.agent });
      } else {
        agent = await usersCollection.findOne({ Phone: info?.agent });
      }

      if (agent?.Role !== "Agent") {
        return res.status(404).send({ message: "This is not an agent" });
      }
      if (user?.Email === agent?.Email) {
        return res.status(404).send({ message: "Something Wrong" });
      }
      if (!user || !agent) {
        return res.status(404).send({ message: "User or agent not found" });
      }

      // Verify PIN
      const isPinMatch = await bcrypt.compare(info?.pin, user.Pin);
      if (!isPinMatch) {
        return res.status(400).send({ message: "Invalid PIN" });
      }
      const amount = parseFloat(info?.amount);
      const doc = {
        Name: info.user?.Name,
        Email: info.user?.Email,
        Phone: info.user?.Phone,
        Agent: agent?.Email,
        Requested_Amount: amount,
        time: new Date().toLocaleString(),
      };
      await requestCollection.insertOne(doc);
      res.send({ message: "Request send successful" });
    });

    // Register User
    app.post("/register", async (req, res) => {
      const userInfo = req.body;

      try {
        const existingPhone = await usersCollection.findOne({
          Phone: userInfo?.phone,
        });
        const existingEmail = await usersCollection.findOne({
          Email: userInfo?.email,
        });

        if (existingEmail || existingPhone) {
          return res
            .status(404)
            .send({ message: "Email or phone already exist" });
        }
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
      } catch (error) {
        res.status(404).send({ message: "Something Wrong" });
      }
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
