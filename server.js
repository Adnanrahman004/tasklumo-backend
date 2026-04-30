const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

// ================= FIREBASE CONNECT =================
try {
  const serviceAccount = require("./firebaseKey.json");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  console.log("Firebase connected 🔥");

} catch (error) {
  console.log("Firebase error ❌", error);
}

const db = admin.firestore();

// ================= TOKEN VERIFY =================
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized ❌" });
    }

    const token = authHeader.split("Bearer ")[1];

    const decodedToken = await admin.auth().verifyIdToken(token);

    req.user = decodedToken;
    next();

  } catch (error) {
    console.log("Token error:", error);
    return res.status(401).json({ error: "Invalid token ❌" });
  }
};

// ================= TEST ROUTE =================
app.get("/", (req, res) => {
  res.send("Server chal raha hai 🚀");
});

// ================= ADD COINS =================
app.post("/add-coins", verifyToken, async (req, res) => {
  try {
    const { coins } = req.body;
    const email = req.user.email;

    const snapshot = await db.collection("users")
      .where("email", "==", email)
      .get();

    snapshot.forEach(async (docSnap) => {
      const currentCoins = docSnap.data().coins || 0;

      await db.collection("users").doc(docSnap.id).update({
        coins: currentCoins + coins
      });
    });

    return res.json({ success: true });

  } catch (error) {
    return res.status(500).json({ error: "Error ❌" });
  }
});

// ================= WITHDRAW REQUEST =================
app.post("/withdraw-request", verifyToken, async (req, res) => {
  try {
    const { coins, method, details } = req.body;
    const email = req.user.email;

    const snapshot = await db.collection("users")
      .where("email", "==", email)
      .get();

    let userDocId = "";
    let currentCoins = 0;
    let userName = "";

    snapshot.forEach((docSnap) => {
      userDocId = docSnap.id;
      currentCoins = docSnap.data().coins;
      userName = docSnap.data().name;
    });

    await db.collection("withdrawRequests").add({
      userId: userDocId,
      userName,
      email,
      coins,
      amount: coins / 10,
      method,
      details,
      status: "pending",
      date: new Date().toLocaleString()
    });

    await db.collection("users").doc(userDocId).update({
      coins: currentCoins - coins
    });

    return res.json({ success: true });

  } catch (error) {
    return res.status(500).json({ error: "Error ❌" });
  }
});

// ================= APPROVE WITHDRAW =================
app.post("/approve-withdraw", async (req, res) => {
  try {
    const { requestId } = req.body;

    const requestRef = db.collection("withdrawRequests").doc(requestId);
    const requestDoc = await requestRef.get();

    const data = requestDoc.data();

    await requestRef.update({
      status: "approved"
    });

    return res.json({ success: true });

  } catch (error) {
    return res.status(500).json({ error: "Error ❌" });
  }
});

// ================= REJECT WITHDRAW =================
app.post("/reject-withdraw", async (req, res) => {
  try {
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({ error: "Request ID required ❌" });
    }

    const ref = db.collection("withdrawRequests").doc(requestId);
    const docSnap = await ref.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: "Request not found ❌" });
    }

    const data = docSnap.data();

    if (data.status === "rejected") {
      return res.json({ message: "Already rejected ⚠️" });
    }

    // 🔥 USER KO COINS WAPAS DO
    const userRef = db.collection("users").doc(data.userId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      const currentCoins = userDoc.data().coins || 0;

      await userRef.update({
        coins: currentCoins + data.coins
      });
    }

    // 🔥 STATUS UPDATE
    await ref.update({
      status: "rejected"
    });

    return res.json({
      success: true,
      message: "Withdraw rejected & coins returned 💸"
    });

  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "Server error ❌" });
  }
});

// ================= TASK SUBMIT =================
app.post("/submit-task", async (req, res) => {
  try {
    const { email, taskName, coins } = req.body;

    const snapshot = await db.collection("users")
      .where("email", "==", email)
      .get();

    if(snapshot.empty){
      return res.status(404).json({ error: "User not found ❌" });
    }

    // 🔥 FIX: सही user pick करो (max coins वाला)
    let bestUserDoc = null;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      if(!bestUserDoc || (data.coins || 0) > (bestUserDoc.data().coins || 0)){
        bestUserDoc = docSnap;
      }
    });

    const userId = bestUserDoc.id;
    const userName = bestUserDoc.data().name;

    // ✅ TASK SAVE
    await db.collection("taskSubmissions").add({
      userId,
      email,
      userName,
      taskName,
      coins: Number(coins),
      status: "pending",
      date: new Date().toLocaleString()
    });

    // 🔥🔥🔥 IMPORTANT FIX (YAHI MISSING THA)
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if(userDoc.exists){
      const userData = userDoc.data();

      await userRef.update({
        tasksDone: (userData.tasksDone || 0) + 1,
        todayCoins: (userData.todayCoins || 0) + Number(coins)
      });
    }

    return res.json({ success: true });

  } catch (error) {
    console.log("Submit task error:", error);
    return res.status(500).json({ error: "Error ❌" });
  }
});

// ================= APPROVE TASK =================
app.post("/approve-task", async (req, res) => {
  try {
    const { taskId } = req.body;

    const taskRef = db.collection("taskSubmissions").doc(taskId);
    const taskDoc = await taskRef.get();
    const data = taskDoc.data();

    const userRef = db.collection("users").doc(data.userId);
    const userDoc = await userRef.get();

    const currentCoins = userDoc.data().coins || 0;

    await userRef.update({
      coins: currentCoins + data.coins
    });

    await taskRef.update({
      status: "approved"
    });

    return res.json({ success: true });

  } catch (error) {
    return res.status(500).json({ error: "Error ❌" });
  }
});

// ================= REJECT TASK =================
app.post("/reject-task", async (req, res) => {
  try {
    const { taskId } = req.body;

    if (!taskId) {
      return res.status(400).json({ error: "Task ID required ❌" });
    }

    const taskRef = db.collection("taskSubmissions").doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      return res.status(404).json({ error: "Task not found ❌" });
    }

    const data = taskDoc.data();

    if (data.status === "rejected") {
      return res.json({ message: "Already rejected ⚠️" });
    }

    await taskRef.update({
      status: "rejected"
    });

    return res.json({
      success: true,
      message: "Task rejected ❌"
    });

  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "Server error ❌" });
  }
});

// ================= 🔥 NEW APIs FOR ADMIN =================

// USERS
app.get("/get-users", async (req, res) => {
  try {
    const snapshot = await db.collection("users").get();
    let data = [];

    snapshot.forEach(doc => {
      data.push({ id: doc.id, ...doc.data() });
    });

    res.json(data);

  } catch (error) {
    res.status(500).json({ error: "Error ❌" });
  }
});

// ALL TASKS (ADMIN)
app.get("/get-all-tasks", async (req, res) => {
  try {
    const snapshot = await db.collection("taskSubmissions").get();
    let data = [];

    snapshot.forEach(doc => {
      data.push({ id: doc.id, ...doc.data() });
    });

    res.json(data);

  } catch (error) {
    res.status(500).json({ error: "Error ❌" });
  }
});

// ================= EXISTING =================

app.get("/get-withdraw-requests", async (req, res) => {
  try {
    const snapshot = await db.collection("withdrawRequests").get();
    let list = [];

    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });

    res.json(list);

  } catch (error) {
    res.status(500).json({ error: "Error ❌" });
  }
});



app.get("/get-task-history", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;

    const snapshot = await db.collection("taskSubmissions")
      .where("email", "==", email)
      .get();

    let data = [];

    snapshot.forEach(doc => {
      data.push({ id: doc.id, ...doc.data() });
    });

    res.json(data);

  } catch (error) {
    res.status(500).json({ error: "Error ❌" });
  }
});

app.get("/get-withdraw-history", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;

    const snapshot = await db.collection("withdrawRequests")
      .where("email", "==", email)
      .get();

    let data = [];
  


    snapshot.forEach(doc => {
      data.push({ id: doc.id, ...doc.data() });
    });

    res.json(data);

  } catch (error) {
    res.status(500).json({ error: "Error ❌" });
  }
});

// ================= SEND NOTIFICATION =================
app.post("/send-notification", async (req, res) => {

  try{

    const { userId, message } = req.body;

    if(!userId || !message){
      return res.status(400).json({ error: "Missing data ❌" });
    }

    await db.collection("notifications").add({
      userId: userId,
      message: message,
      read: false,
      date: new Date().toLocaleString()
    });

    res.json({ success: true, message: "Notification sent 🔔" });

  }catch(e){
    console.log(e);
    res.status(500).json({ error: "Server error ❌" });
  }

});

// ================= OTP SYSTEM =================

const axios = require("axios");

let otpStore = {};

// SEND OTP
app.post("/send-otp", async (req, res) => {

  let { phone } = req.body;

  if (!phone) {
    return res.json({ success: false, message: "Phone missing" });
  }

  // ✅ auto add country code
  if (!phone.startsWith("91")) {
    phone = "91" + phone;
  }

  const otp = Math.floor(100000 + Math.random() * 900000);

  try {

    const response = await axios.post(
      "https://www.fast2sms.com/dev/bulkV2",
      {
        route: "otp",
        variables_values: otp,
        numbers: phone,
      },
      {
        headers: {
          authorization: "9KSdw1IBCvWFal3ULRzo4eh5kYMOscQN2TjbHGgPymDuEfti0xxL4jkocFwVsXSBMGuDJbTti5hOeKNP"
        }
      }
    );

    console.log("Fast2SMS:", response.data);
    console.log("OTP:", otp);

    otpStore[phone] = {
      otp,
      time: Date.now()
    };

    res.json({ success: true });

  } catch (error) {
    console.log("ERROR:", error.response?.data || error.message);
    res.json({ success: false });
  }

});


// VERIFY OTP
app.post("/verify-otp", (req, res) => {

  let { phone, otp } = req.body;

  if (!phone.startsWith("91")) {
    phone = "91" + phone;
  }

  if (
    otpStore[phone] &&
    otpStore[phone].otp == otp &&
    Date.now() - otpStore[phone].time < 300000
  ) {
    delete otpStore[phone];
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }

});

// ================= ADD USER =================
app.post("/add-user", async (req, res) => {
  try {

    const { name, email, deviceId } = req.body;

    if(!email || !deviceId){
      return res.status(400).json({ error: "Missing data ❌" });
    }

    // 🔒 check user already exist
    const existingUserSnap = await db.collection("users")
      .where("email", "==", email)
      .get();

    if(!existingUserSnap.empty){
      return res.json({ message: "User already exists" });
    }

    // 🔥 DEVICE LIMIT CHECK (max 3)
    const deviceSnap = await db.collection("users")
      .where("deviceId", "==", deviceId)
      .get();

    if(deviceSnap.size >= 3){
      return res.status(400).json({ error: "Device limit reached ❌" });
    }

    // 🌐 SAFE IP GET (FIXED)
    let ip =
      req.headers["x-forwarded-for"] ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      "";

    if(!ip) ip = "unknown";

    // multiple IP fix
    if(ip.includes(",")){
      ip = ip.split(",")[0].trim();
    }

    // localhost fix
    if(ip === "::1"){
      ip = "127.0.0.1";
    }

    // 🔥 IP LIMIT CHECK (max 3)
const ipSnap = await db.collection("users")
  .where("ip", "==", ip)
  .get();

if(ipSnap.size >= 3){
  return res.status(400).json({ error: "IP limit reached ❌" });
}

    // ✅ SAVE USER
    await db.collection("users").add({
      name: name || "User",
      email,
      deviceId,
      ip,
      coins: 0,
      todayCoins: 0,
      createdAt: new Date()
    });

    res.json({ message: "User saved ✅" });

  } catch (err) {
    console.log("Add user error:", err);
    res.status(500).json({ error: "Server error ❌" });
  }
});

// ================= USER DATA =================
app.get("/user-data", async (req, res) => {
  try {

    const email = req.headers.email;

    if(!email){
      return res.json({ coins: 0, tasksDone: 0, todayCoins: 0 });
    }

    const snap = await db.collection("users")
      .where("email", "==", email)
      .get();

    if(snap.empty){
      return res.json({ coins: 0, tasksDone: 0, todayCoins: 0 });
    }

    // 🔥 FIX: sab me se max coins wala user lo
    let bestUser = null;

    snap.forEach(doc => {
      const data = doc.data();

      if(!bestUser || (data.coins || 0) > (bestUser.coins || 0)){
        bestUser = data;
      }
    });

    res.json({
      coins: bestUser.coins || 0,
      tasksDone: bestUser.tasksDone || 0,
      todayCoins: bestUser.todayCoins || 0
    });

  } catch (err) {
    console.log("user-data error:", err);
    res.status(500).json({ error: "error" });
  }
});
// ================= SERVER START =================
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Backend running 🚀");
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
