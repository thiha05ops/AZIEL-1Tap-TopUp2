const { performance } = require("perf_hooks");

const processStartedAt = performance.now();
const path = require("path");
const helmet = require("helmet");
const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const http = require("http");
const multer = require("multer");
const { Server } = require("socket.io");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

dotenv.config({ path: path.join(__dirname, "../.env") });
const configurationLoadedAt = performance.now();

const connectDB = require("./config/db");
const {
    corsOptions, formBodyLimit, isProduction, jsonBodyLimit, adminProductionOrigin,
    getCspConnectSources, isAdminHost, socketCorsOptions, isPublicProductionHost,
    validateProductionReadiness
} = require("./config/security");

const app = express();
const expressConstructedAt = performance.now();
const server = http.createServer(app);
const io = new Server(server, { cors: socketCorsOptions });
const PORT = process.env.PORT || 3000;
const RETRY_AFTER_SECONDS = Math.max(1, Number(process.env.READINESS_RETRY_AFTER_SECONDS || 3));
const MONGO_RETRY_BASE_MS = Math.max(1000, Number(process.env.MONGO_RETRY_BASE_MS || 5000));
const MONGO_RETRY_MAX_MS = Math.max(MONGO_RETRY_BASE_MS, Number(process.env.MONGO_RETRY_MAX_MS || 30000));

const startup = {
    phase: "starting", configReady: false, staticReady: false, listenerReady: false,
    databaseReady: false, applicationReady: false, attempts: 0, milestones: {}
};
let baseConfigured = false;
let databaseApplicationConfigured = false;
let socketConfigured = false;
let mongoLifecycleInstalled = false;
let shuttingDown = false;
let mongoRetryTimer = null;
let mongoConnectInFlight = null;
let backgroundWorkersStarted = false;
let supplierCatalogSchedulerStarted = false;
const backgroundTimers = new Set();

function recordStartupMilestone(milestone, startedAt = processStartedAt, extra = {}) {
    const now = performance.now();
    const measurement = {
        milestone,
        elapsedMs: Number((now - processStartedAt).toFixed(1)),
        durationMs: Number((now - startedAt).toFixed(1)),
        ...extra
    };
    startup.milestones[milestone] = measurement;
    console.log(`[startup] ${JSON.stringify(measurement)}`);
    return measurement;
}

function readinessSnapshot() {
    const ready = startup.configReady && startup.staticReady && startup.listenerReady &&
        startup.databaseReady && startup.applicationReady && !shuttingDown;
    return {
        status: ready ? "ready" : "not_ready",
        phase: startup.phase,
        components: {
            configuration: startup.configReady ? "ready" : "not_ready",
            static: startup.staticReady ? "ready" : "not_ready",
            listener: startup.listenerReady ? "ready" : "not_ready",
            mongo: startup.databaseReady ? "ready" : "not_ready",
            application: startup.applicationReady ? "ready" : "not_ready"
        }
    };
}

function isReady() {
    return readinessSnapshot().status === "ready";
}

function databaseReadinessGate(req, res, next) {
    if (isReady()) return next();
    res.setHeader("Retry-After", String(RETRY_AFTER_SECONDS));
    return res.status(503).json({
        success: false,
        code: "SERVICE_TEMPORARILY_UNAVAILABLE",
        message: "Service is starting. Please try again shortly."
    });
}

function shouldCompress(req, res) {
    if (req.headers.range) return false;
    return compression.filter(req, res);
}

function setFrontendCacheHeaders(res, filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const requestPath = String(res.req?.path || "");
    const versioned = Boolean(res.req?.query?.v || res.req?.query?.version || res.req?.query?.build);
    if (extension === ".html" || requestPath === "/sw.js") {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
        return;
    }
    if (versioned) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return;
    }
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
}

function configureBaseApplication() {
    if (baseConfigured) return;
    const appStartedAt = performance.now();
    if (isProduction) app.set("trust proxy", 1);
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
    app.use(compression({ threshold: 1024, filter: shouldCompress }));

    app.get("/health", (req, res) => res.json({ status: "live" }));
    app.get("/ready", (req, res) => {
        const snapshot = readinessSnapshot();
        if (snapshot.status !== "ready") res.setHeader("Retry-After", String(RETRY_AFTER_SECONDS));
        res.status(snapshot.status === "ready" ? 200 : 503).json(snapshot);
    });
    app.get("/", (req, res, next) => {
        if (isProduction && isAdminHost(req)) return res.redirect(302, "/admin-login.html");
        return res.sendFile(path.join(__dirname, "../frontend/home.html"));
    });
    app.get(["/admin-login.html", "/admin.html", "/admin-design-studio.html"], (req, res, next) => {
        if (!isProduction || !isPublicProductionHost(req)) return next();
        const safePath = ["/admin.html", "/admin-design-studio.html"].includes(req.path) ? req.path : "/admin-login.html";
        return res.redirect(302, `${adminProductionOrigin}${safePath}`);
    });
    app.get("/admin.html", (req, res, next) => {
        if (req.query.shell === "1") return next();
        return res.sendFile(path.join(__dirname, "../frontend/admin-entry.html"));
    });

    const staticStartedAt = performance.now();
    app.use(express.static(path.join(__dirname, "../frontend"), {
        etag: true, lastModified: true, setHeaders: setFrontendCacheHeaders
    }));
    app.use("/uploads", express.static(path.join(__dirname, "uploads")));
    startup.staticReady = true;
    recordStartupMilestone("static_middleware_ready", staticStartedAt);

    const generalLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: Number(process.env.RATE_LIMIT_GENERAL || 600),
        standardHeaders: true,
        legacyHeaders: false
    });
    app.use("/api", generalLimiter);
    app.use("/api", databaseReadinessGate);

    io.use((socket, next) => {
        if (isReady()) return next();
        const error = new Error("Service temporarily unavailable");
        error.data = { code: "SERVICE_TEMPORARILY_UNAVAILABLE", retryAfter: RETRY_AFTER_SECONDS };
        return next(error);
    });
    baseConfigured = true;
    recordStartupMilestone("application_middleware_ready", appStartedAt);
}

function configureDatabaseApplication(mongoConnection) {
    if (databaseApplicationConfigured) return;
    const routesStartedAt = performance.now();
    const passport = require("./config/passport");
    const { createSessionMiddleware } = require("./config/session");
    const realtime = require("./services/realtime");
    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: Number(process.env.RATE_LIMIT_AUTH || 60),
        standardHeaders: true,
        legacyHeaders: false
    });
    app.use("/api/login", authLimiter);
    app.use("/api/register", authLimiter);
    app.use("/api/verify-email", authLimiter);
    app.use("/api/password", authLimiter);
    // Must precede JSON parsing so FazerCards HMAC verifies the exact raw bytes.
    app.use("/api", require("./routes/fazercardsWebhook"));
    app.use(express.json({ limit: jsonBodyLimit }));
    app.use(express.urlencoded({ extended: true, limit: formBodyLimit }));
    app.use(createSessionMiddleware({ mongoClient: mongoConnection.getClient(), isProduction }));
    app.use(passport.initialize());
    app.use(passport.session());
    app.set("io", io);
    app.set("realtime", realtime);

    [
        "auth", "adminPricingEngine", "adminAuth", "adminUsers", "adminStats", "order",
        "payment", "notification", "profile"
    ].forEach(route => app.use("/api", require(`./routes/${route}`)));
    app.use("/api/security", require("./routes/security"));
    app.use("/api", require("./routes/socialAuth"));
    app.use("/api/password", require("./routes/password"));
    ["supplier", "wallet", "support", "settings", "paymentMethods"].forEach(route =>
        app.use("/api", require(`./routes/${route}`))
    );
    app.use("/api/live-chat", require("./routes/liveChat"));
    ["catalog", "homeBanners", "campaigns", "promos", "sitePlacements", "configurationRegistry", "websiteRuntime"].forEach(route =>
        app.use("/api", require(`./routes/${route}`))
    );
    app.use("/api", require("./routes/commerceManualPaymentRoutes")());

    app.use("/api", (err, req, res, next) => {
        if (!err) return next();
        if (err instanceof multer.MulterError || err.type === "entity.too.large" ||
            err.message?.includes("Origin not allowed") || err.message?.includes("Only JPG")) {
            return res.status(400).json({ success: false, message: err.message || "Invalid request" });
        }
        console.log("API error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    });
    app.use("/api", (req, res) => res.status(404).json({
        success: false, message: `API route not found: ${req.method} ${req.originalUrl}`
    }));
    if (!socketConfigured) {
        realtime.configureSocketServer(io);
        socketConfigured = true;
        recordStartupMilestone("socket_io_ready", routesStartedAt);
    }
    databaseApplicationConfigured = true;
    recordStartupMilestone("database_routes_ready", routesStartedAt);
}

function stopBackgroundWorkers() {
    if (supplierCatalogSchedulerStarted) {
        require("./services/supplierCatalog/supplierCatalogIngestionScheduler").scheduler.stop();
        supplierCatalogSchedulerStarted = false;
    }
    backgroundTimers.forEach(timer => clearInterval(timer));
    backgroundTimers.clear();
    backgroundWorkersStarted = false;
}

function startBackgroundWorkers() {
    if (backgroundWorkersStarted || !startup.databaseReady || shuttingDown) return;
    const workersStartedAt = performance.now();
    backgroundWorkersStarted = true;
    require("./services/supplierCatalog/supplierCatalogIngestionScheduler").scheduler.start();
    supplierCatalogSchedulerStarted = true;
    if (require("./services/suppliers/wonddAdapter").hasAnyAutoFulfillmentEnabled()) {
        const processor = require("./services/suppliers/wonddFulfillmentProcessor").processor;
        processor.recoverDue().catch(() => null);
        const timer = setInterval(() => processor.recoverDue().catch(() => null), 15 * 60 * 1000);
        timer.unref?.();
        backgroundTimers.add(timer);
    }
    const fazerEnabled = ["pubg", "mlbb", "freefire", "hok"].some(product =>
        require("./services/suppliers/fazercardsAdapter").isAutoFulfillmentEnabled(product)
    );
    if (fazerEnabled) {
        const processor = require("./services/suppliers/fazercardsFulfillmentProcessor").processor;
        processor.recoverDue().catch(() => null);
        const timer = setInterval(() => processor.recoverDue().catch(() => null), 15 * 60 * 1000);
        timer.unref?.();
        backgroundTimers.add(timer);
    }
    recordStartupMilestone("background_workers_ready", workersStartedAt, { timers: backgroundTimers.size });
}

function scheduleMongoRetry(connectDatabase = connectDB) {
    if (shuttingDown || mongoRetryTimer || startup.databaseReady) return;
    const exponent = Math.min(Math.max(startup.attempts - 1, 0), 4);
    const delayMs = Math.min(MONGO_RETRY_MAX_MS, MONGO_RETRY_BASE_MS * (2 ** exponent));
    mongoRetryTimer = setTimeout(() => {
        mongoRetryTimer = null;
        attemptMongoConnection(connectDatabase).catch(() => null);
    }, delayMs);
    mongoRetryTimer.unref?.();
    console.warn(`[startup] Mongo retry scheduled in ${delayMs}ms`);
}

async function attemptMongoConnection(connectDatabase = connectDB) {
    if (shuttingDown || mongoConnectInFlight || startup.databaseReady) return mongoConnectInFlight;
    startup.phase = "connecting_database";
    startup.attempts += 1;
    const mongoStartedAt = performance.now();
    recordStartupMilestone("mongo_connection_start", mongoStartedAt, { attempt: startup.attempts });
    mongoConnectInFlight = Promise.resolve().then(() => connectDatabase()).then(connection => {
        startup.databaseReady = true;
        recordStartupMilestone("mongo_connection_ready", mongoStartedAt, { attempt: startup.attempts });
        configureDatabaseApplication(connection);
        startup.applicationReady = true;
        startup.phase = "ready";
        startBackgroundWorkers();
        recordStartupMilestone("total_ready", processStartedAt);
        return connection;
    }).catch(error => {
        startup.databaseReady = false;
        startup.applicationReady = false;
        startup.phase = "degraded";
        recordStartupMilestone("mongo_connection_failed", mongoStartedAt, { attempt: startup.attempts });
        console.error("DB connection unavailable; HTTP remains live:", error?.code || error?.name || "MONGO_CONNECTION_FAILED");
        scheduleMongoRetry(connectDatabase);
        return null;
    }).finally(() => { mongoConnectInFlight = null; });
    return mongoConnectInFlight;
}

function installMongoLifecycleHandlers() {
    if (mongoLifecycleInstalled) return;
    mongoLifecycleInstalled = true;
    mongoose.connection.on("disconnected", () => {
        if (shuttingDown) return;
        startup.databaseReady = false;
        startup.applicationReady = false;
        startup.phase = "degraded";
        stopBackgroundWorkers();
    });
    mongoose.connection.on("error", () => {
        if (shuttingDown) return;
        startup.databaseReady = false;
        startup.applicationReady = false;
        startup.phase = "degraded";
    });
    mongoose.connection.on("connected", () => {
        if (shuttingDown || !databaseApplicationConfigured) return;
        startup.databaseReady = true;
        startup.applicationReady = true;
        startup.phase = "ready";
        startBackgroundWorkers();
    });
}

async function startServer(options = {}) {
    const configStartedAt = performance.now();
    validateProductionReadiness();
    if (typeof connectDB.resolveMongoUri === "function") connectDB.resolveMongoUri(process.env);
    startup.configReady = true;
    recordStartupMilestone("configuration_validated", configStartedAt, {
        loadMs: Number((configurationLoadedAt - processStartedAt).toFixed(1))
    });
    recordStartupMilestone("express_app_constructed", processStartedAt, {
        constructedAtMs: Number((expressConstructedAt - processStartedAt).toFixed(1))
    });
    configureBaseApplication();
    installMongoLifecycleHandlers();
    const listenerStartedAt = performance.now();
    recordStartupMilestone("listener_start", listenerStartedAt);
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port || PORT, options.host, () => {
            server.off("error", reject);
            startup.listenerReady = true;
            startup.phase = "listening";
            recordStartupMilestone("listener_ready", listenerStartedAt);
            console.log(`🔥 Server running on port ${options.port || PORT}`);
            resolve();
        });
    });
    // Liveness and static delivery intentionally do not await Mongo.
    attemptMongoConnection(options.connectDatabase || connectDB).catch(() => null);
    return server;
}

async function shutdown(signal = "shutdown", options = {}) {
    if (shuttingDown) return;
    shuttingDown = true;
    startup.phase = "stopping";
    startup.applicationReady = false;
    startup.databaseReady = false;
    console.log(`Received ${signal}. Shutting down...`);
    if (mongoRetryTimer) clearTimeout(mongoRetryTimer);
    stopBackgroundWorkers();
    const timeout = setTimeout(() => {
        console.error("Shutdown timed out.");
        if (!options.suppressExit) process.exit(1);
    }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000));
    timeout.unref?.();
    try {
        io.close();
        await new Promise(resolve => {
            if (!server.listening) return resolve();
            server.close(() => resolve());
        });
        await mongoose.connection.close(false);
        clearTimeout(timeout);
        if (!options.suppressExit) process.exit(0);
    } catch (error) {
        clearTimeout(timeout);
        console.error("Shutdown failed:", error?.code || error?.name || "SHUTDOWN_FAILED");
        if (!options.suppressExit) process.exit(1);
    }
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
if (require.main === module) {
    startServer().catch(error => {
        console.error("Startup failed:", error?.message || error?.code || "STARTUP_FAILED");
        process.exit(1);
    });
}

module.exports = {
    app, attemptMongoConnection, configureApplication: configureDatabaseApplication,
    configureBaseApplication, configureDatabaseApplication, databaseReadinessGate, io,
    readinessSnapshot, server, shutdown, startBackgroundWorkers, startServer, startup,
    stopBackgroundWorkers
};
