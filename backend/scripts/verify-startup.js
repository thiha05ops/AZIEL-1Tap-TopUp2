const assert = require("assert");
const { spawn } = require("child_process");
const dotenv = require("dotenv");
const fs = require("fs");
const http = require("http");
const os = require("os");
const net = require("net");
const path = require("path");

dotenv.config();

const { createSessionMiddleware } = require("../config/session");

const ROOT = path.join(__dirname, "../..");
const PRELOAD_PATH = path.join(os.tmpdir(), "aziel-verify-startup-preload.js");

function ensureStartupPreload() {
    fs.writeFileSync(PRELOAD_PATH, `
const Module = require("module");
const path = require("path");
const originalLoad = Module._load;
const dbPathSuffix = path.join("backend", "config", "db.js");
const sessionPathSuffix = path.join("backend", "config", "session.js");

Module._load = function patchedStartupLoad(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);

    if (resolved.endsWith(dbPathSuffix)) {
        const verifyConnectDB = async function verifyConnectDB() {
            console.log("VERIFY_MONGO_CONNECT_START");
            if (process.env.AZIEL_VERIFY_MONGO_MODE === "fail") {
                console.error("DB connection failed: VERIFY_MONGO_FAILURE");
                throw new Error("VERIFY_MONGO_FAILURE");
            }
            await new Promise(resolve => setTimeout(resolve, Number(process.env.AZIEL_VERIFY_MONGO_DELAY_MS || 25)));
            console.log("MongoDB Connected");
            return {
                getClient() {
                    return {};
                }
            };
        };
        verifyConnectDB.resolveMongoUri = () => process.env.MONGO_URI;
        return verifyConnectDB;
    }

    if (resolved.endsWith(sessionPathSuffix)) {
        return {
            SESSION_MAX_AGE_MS: 604800000,
            createSessionMiddleware() {
                return function verifySessionMiddleware(req, res, next) {
                    next();
                };
            }
        };
    }

    return originalLoad.apply(this, arguments);
};
`, "utf8");
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function canConnect(port) {
    return new Promise(resolve => {
        const socket = net.createConnection({ port, host: "127.0.0.1" });
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", () => resolve(false));
        socket.setTimeout(500, () => {
            socket.destroy();
            resolve(false);
        });
    });
}

function request(port, requestPath) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, path: requestPath }, res => {
            let body = "";
            res.on("data", chunk => { body += chunk; });
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.once("error", reject);
        req.setTimeout(2000, () => req.destroy(new Error("request timeout")));
    });
}

function spawnServer(env, options = {}) {
    const args = [];
    if (options.preload) {
        ensureStartupPreload();
        args.push("-r", PRELOAD_PATH);
    }
    args.push("backend/server.js");

    const child = spawn(process.execPath, args, {
        cwd: ROOT,
        env: {
            ...process.env,
            ...env
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";

    child.stdout.on("data", chunk => {
        output += chunk.toString();
    });
    child.stderr.on("data", chunk => {
        output += chunk.toString();
    });

    return { child, getOutput: () => output };
}

async function stopChild(child) {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
        new Promise(resolve => child.once("exit", resolve)),
        wait(5000).then(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
        })
    ]);
}

async function verifyBadMongoKeepsLiveness() {
    const port = 3041;
    const { child, getOutput } = spawnServer({
        NODE_ENV: "development",
        PORT: String(port),
        MONGO_URI: "mongodb://127.0.0.1:1/aziel-startup-test",
        MONGO_SERVER_SELECTION_TIMEOUT_MS: "750",
        AZIEL_VERIFY_MONGO_MODE: "fail"
    }, { preload: true });

    try {
        for (let index = 0; index < 20 && !getOutput().includes("Server running"); index++) await wait(100);
        assert(getOutput().includes("Server running"), "HTTP must listen despite transient Mongo failure");
        assert.strictEqual((await request(port, "/health")).status, 200, "liveness must stay available");
        const ready = await request(port, "/ready");
        assert.strictEqual(ready.status, 503, "readiness must remain unavailable");
        const api = await request(port, "/api/catalog");
        assert.strictEqual(api.status, 503, "database APIs must be centrally gated");
        assert(api.headers["retry-after"], "gated API response must include Retry-After");
        assert.strictEqual(child.exitCode, null, "transient Mongo failure must not terminate the process");
    } finally {
        await stopChild(child);
    }
}

async function verifySlowMongoAllowsEarlyStaticAndThenReady() {
    const port = 3042;
    const { child, getOutput } = spawnServer({
        NODE_ENV: "development",
        PORT: String(port),
        MONGO_URI: "mongodb://127.0.0.1:27017/aziel-startup-test",
        MONGO_SERVER_SELECTION_TIMEOUT_MS: "5000",
        AZIEL_VERIFY_MONGO_MODE: "success",
        AZIEL_VERIFY_MONGO_DELAY_MS: "1200"
    }, { preload: true });

    try {
        for (let index = 0; index < 30; index++) {
            if (getOutput().includes("Server running")) break;
            await wait(50);
        }
        assert(getOutput().includes("Server running"), "listener should become available during slow Mongo");
        assert(!getOutput().includes("MongoDB Connected"), "slow Mongo should still be pending at T0");
        assert(!getOutput().includes('"milestone":"background_workers_ready"'), "DB workers must not start before Mongo");
        assert.strictEqual((await request(port, "/health")).status, 200, "health should be live at T0");
        for (const staticPath of [
            "/", "/home.html", "/css/core/main.css", "/js/locale-loader.js",
            "/assets/banners/hero-desktop-wide.webp", "/lang/runtime/en.js", "/manifest.json", "/sw.js"
        ]) {
            assert.strictEqual((await request(port, staticPath)).status, 200, `${staticPath} should be available at T0`);
        }
        assert.strictEqual((await request(port, "/ready")).status, 503, "readiness should be 503 while Mongo is pending");
        assert.strictEqual((await request(port, "/api/catalog")).status, 503, "API should be 503 while Mongo is pending");

        for (let index = 0; index < 40 && !getOutput().includes('"milestone":"total_ready"'); index++) await wait(100);
        assert(getOutput().includes("MongoDB Connected"), "Mongo should eventually connect");
        assert(
            getOutput().indexOf("Server running") < getOutput().indexOf("MongoDB Connected"),
            "listener must be available before slow Mongo completes"
        );
        assert.strictEqual((await request(port, "/ready")).status, 200, "readiness should become 200 after initialization");
        assert.strictEqual(
            (getOutput().match(/"milestone":"background_workers_ready"/g) || []).length,
            1,
            "background services must initialize exactly once"
        );
        child.kill("SIGTERM");
        await Promise.race([
            new Promise(resolve => child.once("exit", resolve)),
            wait(5000).then(() => assert.fail("graceful shutdown timed out"))
        ]);
    } finally {
        await stopChild(child);
    }
}

function verifySessionStoreContract() {
    const sessionSource = fs.readFileSync(path.join(ROOT, "backend/config/session.js"), "utf8");

    assert(sessionSource.includes("connect-mongo"), "production session storage must use connect-mongo");
    assert(sessionSource.includes("MongoStore.create"), "session middleware must create a MongoStore");
    assert(!sessionSource.includes("MemoryStore"), "production session middleware must not include a MemoryStore fallback");
    assert.throws(
        () => createSessionMiddleware({ isProduction: true }),
        /PROD_SESSION_STORE_UNAVAILABLE/,
        "production session middleware must not fall back to MemoryStore"
    );
}

function verifyServerStartupSourceContract() {
    const serverSource = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
    const startMatch = serverSource.match(/async function startServer\(options = \{\}\) \{([\s\S]*?)\n\}/);

    assert(startMatch, "server.js must expose startServer");

    const startBody = startMatch[1];
    const readinessIndex = startBody.indexOf("validateProductionReadiness()");
    const baseIndex = startBody.indexOf("configureBaseApplication()");
    const listenIndex = startBody.indexOf("server.listen");
    const connectIndex = startBody.indexOf("attemptMongoConnection");

    assert(readinessIndex >= 0, "startServer must validate production readiness");
    assert(baseIndex > readinessIndex, "base application must follow configuration validation");
    assert(listenIndex > baseIndex, "server.listen must follow base/static configuration");
    assert(connectIndex > listenIndex, "Mongo connection must begin after the listener is available");
    assert(serverSource.includes("databaseReadinessGate"), "database-dependent APIs must use a central readiness gate");
    assert(serverSource.includes('res.setHeader("Retry-After"'), "unready responses must advertise Retry-After");
    assert(serverSource.includes('io.use((socket, next)'), "Socket.IO must reject connections before readiness");
    assert(serverSource.includes("startServer().catch"), "startup failure must be caught at the entrypoint");
    assert(serverSource.includes("process.exit(1)"), "startup failure must exit non-zero");
    assert(serverSource.includes("process.once(\"SIGTERM\""), "SIGTERM graceful shutdown hook must exist");
    assert(serverSource.includes("process.once(\"SIGINT\""), "SIGINT graceful shutdown hook must exist");
    assert(serverSource.includes("setTimeout(() =>"), "shutdown must keep a bounded timeout");
    assert(serverSource.includes("io.close()"), "Socket.IO must close during shutdown");
    assert(serverSource.includes("server.close"), "HTTP server must close during shutdown");
    assert(serverSource.includes("mongoose.connection.close(false)"), "Mongo connection must close during shutdown");
    assert(serverSource.includes("app.set(\"trust proxy\", 1)"), "production trust proxy ownership must remain unchanged");
}

function verifyGoogleRouteOwnership() {
    const authSource = fs.readFileSync(path.join(ROOT, "backend/routes/auth.js"), "utf8");
    const socialSource = fs.readFileSync(path.join(ROOT, "backend/routes/socialAuth.js"), "utf8");

    assert(!authSource.includes('"/auth/google"'), "auth.js must not own Google start route");
    assert(!authSource.includes('"/auth/google/callback"'), "auth.js must not own Google callback route");
    assert(socialSource.includes('"/auth/google"'), "socialAuth.js should own Google start route");
    assert(socialSource.includes('"/auth/google/callback"'), "socialAuth.js should own Google callback route");
}

async function main() {
    verifySessionStoreContract();
    verifyServerStartupSourceContract();
    verifyGoogleRouteOwnership();
    await verifyBadMongoKeepsLiveness();
    await verifySlowMongoAllowsEarlyStaticAndThenReady();
    console.log("Startup verification checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
