const path = require("path");
const helmet = require("helmet");
const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const http = require("http");
const multer = require("multer");
const { Server } = require("socket.io");
const rateLimit = require("express-rate-limit");

dotenv.config({
    path: path.join(__dirname, "../.env")
});

const connectDB = require("./config/db");
const passport = require("./config/passport");
const {
    corsOptions,
    formBodyLimit,
    isProduction,
    jsonBodyLimit,
    socketCorsOptions,
    validateProductionSecurityConfig
} = require("./config/security");

validateProductionSecurityConfig();

// ROUTES
const authRoutes = require("./routes/auth");
const adminAuthRoutes = require("./routes/adminAuth");
const adminUsersRoutes = require("./routes/adminUsers");
const adminStatsRoutes = require("./routes/adminStats");
const orderRoutes = require("./routes/order");
const paymentRoutes = require("./routes/payment");
const notificationRoutes = require("./routes/notification");
const profileRoutes = require("./routes/profile");
const socialAuthRoutes = require("./routes/socialAuth");
const passwordRoutes = require("./routes/password");
const supplierRoutes = require("./routes/supplier");
const walletRoutes = require("./routes/wallet");
const supportRoutes = require("./routes/support");
const settingsRoutes = require("./routes/settings");
const paymentMethodsRoutes = require("./routes/paymentMethods");
const liveChatRoutes = require("./routes/liveChat");
const realtime = require("./services/realtime");

// EXPRESS APP
const app = express();

// SOCKET SERVER
const server = http.createServer(app);

const io = new Server(server, {
    cors: socketCorsOptions
});

app.set("io", io);
app.set("realtime", realtime);

// SOCKET EVENTS
realtime.configureSocketServer(io);

// CONNECT DB
connectDB();

// MIDDLEWARE
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors(corsOptions));

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_GENERAL || 600),
    standardHeaders: true,
    legacyHeaders: false
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_AUTH || 60),
    standardHeaders: true,
    legacyHeaders: false
});

app.use("/api", generalLimiter);
app.use("/api/login", authLimiter);
app.use("/api/register", authLimiter);
app.use("/api/verify-email", authLimiter);
app.use("/api/password", authLimiter);

app.use(express.json({ limit: jsonBodyLimit }));
app.use(express.urlencoded({
    extended: true,
    limit: formBodyLimit
}));

app.use(session({
    secret: process.env.SESSION_SECRET || "aziel_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: isProduction ? "none" : "lax",
        secure: isProduction
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// STATIC FILES
app.use(express.static(path.join(__dirname, "../frontend")));

app.use(
    "/uploads",
    express.static(path.join(__dirname, "uploads"))
);

// ROUTES
app.use("/api", authRoutes);
app.use("/api", adminAuthRoutes);
app.use("/api", adminUsersRoutes);
app.use("/api", adminStatsRoutes);
app.use("/api", orderRoutes);
app.use("/api", paymentRoutes);
app.use("/api", notificationRoutes);
app.use("/api", profileRoutes);
app.use("/api", socialAuthRoutes);
app.use("/api/password", passwordRoutes);
app.use("/api", supplierRoutes);
app.use("/api", walletRoutes);
app.use("/api", supportRoutes);
app.use("/api", settingsRoutes);
app.use("/api", paymentMethodsRoutes);
app.use("/api/live-chat", liveChatRoutes);

// API ERROR HANDLER
app.use("/api", (err, req, res, next) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: err.message || "Upload failed"
        });
    }

    if (
        err.type === "entity.too.large" ||
        err.message?.includes("Origin not allowed") ||
        err.message?.includes("Only JPG")
    ) {
        return res.status(400).json({
            success: false,
            message: err.message || "Invalid request"
        });
    }

    console.log("API error:", err);

    return res.status(500).json({
        success: false,
        message: "Server error"
    });
});

// HOME
app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "../frontend/home.html")
    );
});

// 404 API FALLBACK
app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: `API route not found: ${req.method} ${req.originalUrl}`
    });
});

// PORT
const PORT = process.env.PORT || 3000;

// START SERVER
server.listen(PORT, () => {
    console.log(`🔥 Server running on port ${PORT}`);
});
