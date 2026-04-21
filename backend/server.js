const express = require("express");
const cors = require("cors");
const path = require("path");

const authRoutes = require("./routes/auth");
const orderRoutes = require("./routes/order");

const app = express();

app.use(cors());
app.use(express.json());

// API Routes
app.use("/api", authRoutes);
app.use("/api", orderRoutes);

// Frontend serve
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/login.html"));
});

app.listen(3000, () => {
    console.log("🔥 Server running on http://localhost:3000");
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server running...");
});