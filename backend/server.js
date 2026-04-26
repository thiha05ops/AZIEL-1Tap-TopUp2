const session = require("express-session");
const passport = require("./config/passport");
const socialAuthRoutes = require("./routes/socialAuth");
const passwordRoutes = require("./routes/password");
const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");

const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const orderRoutes = require("./routes/order");
const profileRoutes = require("./routes/profile");

dotenv.config();
connectDB();

const app = express();

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
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api", authRoutes);
app.use("/api", orderRoutes);
app.use("/api", profileRoutes);
app.use("/api", socialAuthRoutes);
app.use("/api", passwordRoutes);

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/home.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
