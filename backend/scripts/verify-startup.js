const assert = require("assert");
const { spawn } = require("child_process");
const dotenv = require("dotenv");
const fs = require("fs");
const net = require("net");
const path = require("path");

dotenv.config();

const { createSessionMiddleware } = require("../config/session");

const ROOT = path.join(__dirname, "../..");

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

function spawnServer(env) {
    const child = spawn(process.execPath, ["backend/server.js"], {
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

async function verifyBadMongoPreventsListen() {
    const port = 3041;
    const { child, getOutput } = spawnServer({
        NODE_ENV: "development",
        PORT: String(port),
        MONGO_URI: "mongodb://127.0.0.1:1/aziel-startup-test",
        MONGO_SERVER_SELECTION_TIMEOUT_MS: "750"
    });

    const exitCode = await Promise.race([
        new Promise(resolve => child.once("exit", resolve)),
        wait(5000).then(() => "timeout")
    ]);

    assert.notStrictEqual(exitCode, "timeout", "bad Mongo startup should exit");
    assert.notStrictEqual(exitCode, 0, "bad Mongo startup should fail");
    assert(!getOutput().includes("Server running"), "server must not listen before Mongo is ready");
    assert.strictEqual(await canConnect(port), false, "bad Mongo port should not accept connections");
}

async function verifyGoodMongoAllowsListen() {
    if (!process.env.MONGO_URI) {
        console.log("Skipping successful startup probe: MONGO_URI is not configured.");
        return;
    }

    const port = 3042;
    const { child, getOutput } = spawnServer({
        NODE_ENV: "development",
        PORT: String(port),
        MONGO_SERVER_SELECTION_TIMEOUT_MS: "5000"
    });

    try {
        for (let index = 0; index < 30; index++) {
            if (getOutput().includes("Server running")) break;
            await wait(500);
        }

        assert(getOutput().includes("MongoDB Connected"), "Mongo should connect before listen");
        assert(getOutput().includes("Server running"), "server should listen after Mongo is ready");
        assert.strictEqual(await canConnect(port), true, "successful startup port should accept connections");
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
    assert.throws(
        () => createSessionMiddleware({ isProduction: true }),
        /PROD_SESSION_STORE_UNAVAILABLE/,
        "production session middleware must not fall back to MemoryStore"
    );
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
    verifyGoogleRouteOwnership();
    await verifyBadMongoPreventsListen();
    await verifyGoodMongoAllowsListen();
    console.log("Startup verification checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
