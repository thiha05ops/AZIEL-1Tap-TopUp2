const path = require("path");
const helmet = require("helmet");
const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const http = require("http");
const multer = require("multer");
const { Server } = require("socket.io");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

dotenv.config({
    path: path.join(__dirname, "../.env")
});

const connectDB = require("./config/db");
const passport = require("./config/passport");
const { createSessionMiddleware } = require("./config/session");
const {
    corsOptions,
    formBodyLimit,
    isProduction,
    jsonBodyLimit,
    buildProductionReadiness,
    adminProductionOrigin,
    getCspConnectSources,
    isAdminHost,
    socketCorsOptions,
    isPublicProductionHost,
    validateProductionReadiness
} = require("./config/security");

// ROUTES
const authRoutes = require("./routes/auth");
const adminAuthRoutes = require("./routes/adminAuth");
const adminUsersRoutes = require("./routes/adminUsers");
const adminStatsRoutes = require("./routes/adminStats");
const orderRoutes = require("./routes/order");
const paymentRoutes = require("./routes/payment");
const notificationRoutes = require("./routes/notification");
const profileRoutes = require("./routes/profile");
const securityRoutes = require("./routes/security");
const socialAuthRoutes = require("./routes/socialAuth");
const passwordRoutes = require("./routes/password");
const supplierRoutes = require("./routes/supplier");
const walletRoutes = require("./routes/wallet");
const supportRoutes = require("./routes/support");
const settingsRoutes = require("./routes/settings");
const paymentMethodsRoutes = require("./routes/paymentMethods");
const liveChatRoutes = require("./routes/liveChat");
const catalogRoutes = require("./routes/catalog");
const homeBannerRoutes = require("./routes/homeBanners");
const campaignRoutes = require("./routes/campaigns");
const promoRoutes = require("./routes/promos");
const sitePlacementRoutes = require("./routes/sitePlacements");
const websiteRuntimeRoutes = require("./routes/websiteRuntime");
const configurationRegistryRoutes = require("./routes/configurationRegistry");
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

// PORT
const PORT = process.env.PORT || 3000;

let configured = false;
let shuttingDown = false;

function configureApplication(mongoConnection) {
    if (configured) return;

    if (isProduction) {
        app.set("trust proxy", 1);
    }

    app.use(helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                "default-src": helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
                "connect-src": getCspConnectSources()
            }
        },
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

    app.use(createSessionMiddleware({
        mongoClient: mongoConnection.getClient(),
        isProduction
    }));

    app.use(passport.initialize());
    app.use(passport.session());

    app.get("/", (req, res, next) => {
        if (!isProduction || !isAdminHost(req)) return next();
        return res.redirect(302, "/admin-login.html");
    });

    app.get(["/admin-login.html", "/admin.html", "/admin-design-studio.html"], (req, res, next) => {
        if (!isProduction || !isPublicProductionHost(req)) return next();

        const safePath = ["/admin.html", "/admin-design-studio.html"].includes(req.path)
            ? req.path
            : "/admin-login.html";

        return res.redirect(302, `${adminProductionOrigin}${safePath}`);
    });

    app.use(express.static(path.join(__dirname, "../frontend")));

    app.use(
        "/uploads",
        express.static(path.join(__dirname, "uploads"))
    );

    app.get("/health", (req, res) => {
        res.json({
            status: "ok",
            uptimeSeconds: Math.floor(process.uptime())
        });
    });

    app.get("/ready", (req, res) => {
        const readiness = buildProductionReadiness(process.env);
        const mongoReady = mongoose.connection.readyState === 1;
        const ready = readiness.ready && mongoReady;

        res.status(ready ? 200 : 503).json({
            status: ready ? "ready" : "not_ready",
            components: {
                configuration: readiness.ready ? "ready" : "blocked",
                mongo: mongoReady ? "ready" : "not_ready",
                payment: readiness.features.payment || "unknown",
                email: readiness.features.email || "unknown",
                storage: readiness.features.storage || "unknown",
                cors: readiness.features.cors || "unknown"
            },
            blockers: readiness.errors.map(error => error.code),
            warnings: readiness.warnings.map(warning => warning.code)
        });
    });

    app.use("/api", authRoutes);
    app.use("/api", adminAuthRoutes);
    app.use("/api", adminUsersRoutes);
    app.use("/api", adminStatsRoutes);
    app.use("/api", orderRoutes);
    app.use("/api", paymentRoutes);
    app.use("/api", notificationRoutes);
    app.use("/api", profileRoutes);
    app.use("/api/security", securityRoutes);
    app.use("/api", socialAuthRoutes);
    app.use("/api/password", passwordRoutes);
    app.use("/api", supplierRoutes);
    app.use("/api", walletRoutes);
    app.use("/api", supportRoutes);
    app.use("/api", settingsRoutes);
    app.use("/api", paymentMethodsRoutes);
    app.use("/api/live-chat", liveChatRoutes);
    app.use("/api", catalogRoutes);
    app.use("/api", homeBannerRoutes);
    app.use("/api", campaignRoutes);
    app.use("/api", promoRoutes);
    app.use("/api", sitePlacementRoutes);
    app.use("/api", configurationRegistryRoutes);
    app.use("/api", websiteRuntimeRoutes);

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

    app.get("/", (req, res) => {
        res.sendFile(
            path.join(__dirname, "../frontend/home.html")
        );
    });

    app.use("/api", (req, res) => {
        res.status(404).json({
            success: false,
            message: `API route not found: ${req.method} ${req.originalUrl}`
        });
    });

    configured = true;
}

async function startServer() {
    validateProductionReadiness();
    const mongoConnection = await connectDB();
    configureApplication(mongoConnection);

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(PORT, () => {
            server.off("error", reject);
            console.log(`🔥 Server running on port ${PORT}`);
            resolve();
        });
    });

    return server;
}

async function shutdown(signal = "shutdown") {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`Received ${signal}. Shutting down...`);

    const timeout = setTimeout(() => {
        console.error("Shutdown timed out.");
        process.exit(1);
    }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000));

    try {
        io.close();
        await new Promise(resolve => {
            if (!server.listening) return resolve();
            server.close(() => resolve());
        });
        await mongoose.connection.close(false);
        clearTimeout(timeout);
        process.exit(0);
    } catch (error) {
        clearTimeout(timeout);
        console.error("Shutdown failed:", error?.code || error?.name || "SHUTDOWN_FAILED");
        process.exit(1);
    }
}

process.once("SIGTERM", () => {
    shutdown("SIGTERM");
});

process.once("SIGINT", () => {
    shutdown("SIGINT");
});

if (require.main === module) {
    startServer().catch(error => {
        console.error("Startup failed:", error?.message || error?.code || "STARTUP_FAILED");
        process.exit(1);
    });
}

module.exports = {
    app,
    configureApplication,
    io,
    server,
    shutdown,
    startServer
};
