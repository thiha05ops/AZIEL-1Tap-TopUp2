const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
    path: path.join(__dirname, "../.env")
});

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./config/db");
const passport = require("./config/passport");

// ROUTES
const notificationRoutes = require("./routes/notification");
const authRoutes = require("./routes/auth");
const orderRoutes = require("./routes/order");
const paymentRoutes = require("./routes/payment");
const profileRoutes = require("./routes/profile");
const socialAuthRoutes = require("./routes/socialAuth");
const passwordRoutes = require("./routes/password");
const supplierRoutes = require("./routes/supplier");
const walletRoutes = require("./routes/wallet");
const adminStatsRoutes = require("./routes/adminStats");

// EXPRESS APP
const app = express();

// SOCKET SERVER
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.set("io", io);

io.on("connection", (socket) => {

    console.log("Socket connected:", socket.id);

    socket.on("joinUserRoom", (username) => {

        socket.join(username);

        console.log("User joined room:", username);

    });

    socket.on("disconnect", () => {

        console.log("Socket disconnected:", socket.id);

    });

});

// CONNECT DB
connectDB();

// MIDDLEWARE
app.use(cors());

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

app.use(session({
    secret: process.env.SESSION_SECRET || "aziel_secret",
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());

app.use(passport.session());

// STATIC FILES
app.use(express.static(
    path.join(__dirname, "../frontend")
));

app.use(
    "/uploads",
    express.static(
        path.join(__dirname, "uploads")
    )
);

// ROUTES
app.use("/api", authRoutes);

app.use("/api", orderRoutes);

app.use("/api", paymentRoutes);

app.use("/api", notificationRoutes);

app.use("/api", profileRoutes);

app.use("/api", socialAuthRoutes);

app.use("/api", passwordRoutes);

app.use("/api", supplierRoutes);

app.use("/api", walletRoutes);

app.use("/api", adminStatsRoutes);

// HOME
app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "../frontend/home.html"
        )
    );

});

// PORT
const PORT = process.env.PORT || 3000;

// START SERVER
server.listen(PORT, () => {

    console.log(
        `🔥 Server running on port ${PORT}`
    );

});