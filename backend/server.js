const path = require("path");
const dotenv = require("dotenv");
const paymentRoutes = require("./routes/payment");

dotenv.config({ path: path.join(__dirname, "../.env") });

const express = require("express");
const cors = require("cors");
const session = require("express-session");

const connectDB = require("./config/db");
const passport = require("./config/passport");

const authRoutes = require("./routes/auth");
const orderRoutes = require("./routes/order");
const profileRoutes = require("./routes/profile");
const socialAuthRoutes = require("./routes/socialAuth");
const passwordRoutes = require("./routes/password");

const app = express();

// DB connect
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

app.use(
    session({
        secret: process.env.SESSION_SECRET || "aziel_session_secret",
        resave: false,
        saveUninitialized: false,
    })
);

app.use(passport.initialize());
app.use(passport.session());

// Static files
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api", authRoutes);
app.use("/api", orderRoutes);
app.use("/api", paymentRoutes);
app.use("/api", profileRoutes);
app.use("/api", socialAuthRoutes);
app.use("/api", passwordRoutes);


// Home page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/home.html"));
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});