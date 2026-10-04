"use strict";

const mongoose = require("mongoose");

const uri = String(process.env.AZIEL_LIFECYCLE_TEST_MONGODB_URI || "").trim();
const confirmed = process.env.AZIEL_LIFECYCLE_TEST_DB_CONFIRMED === "true";
const runId = `supplier-lifecycle-${process.pid}-${Date.now()}`;

function refuse(message) {
    process.stderr.write(`REFUSED supplier lifecycle transaction integration: ${message}\n`);
    process.exitCode = 2;
}

async function main() {
    if (!uri) {
        process.stdout.write("SKIP supplier lifecycle transaction integration: AZIEL_LIFECYCLE_TEST_MONGODB_URI is not configured; production fallback is forbidden.\n");
        return;
    }
    const parsed = new URL(uri);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    const forbidden = new Set(["", "admin", "local", "config", "production", "prod", "aziel"]);
    if (!confirmed) return refuse("AZIEL_LIFECYCLE_TEST_DB_CONFIRMED=true is required");
    if (forbidden.has(databaseName.toLowerCase()) || !/(^|[-_])(test|isolated)([-_]|$)/i.test(databaseName)) {
        return refuse(`database '${databaseName || "<missing>"}' is not an explicitly isolated test database`);
    }
    process.stdout.write(`Using isolated transaction database: ${databaseName}\n`);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName || hello.logicalSessionTimeoutMinutes == null) return refuse("MongoDB deployment is not replica-set transaction capable");

    const collection = mongoose.connection.db.collection("supplier_lifecycle_transaction_verifier");
    const fixture = kind => ({ verifierRunId: runId, kind, createdAt: new Date() });
    const rollback = async (scenario, operations) => {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                for (const operation of operations) await collection.insertOne(fixture(`${scenario}:${operation}`), { session });
                throw Object.assign(new Error("forced audit failure"), { code: "FORCED_AUDIT_FAILURE" });
            });
        } catch (error) {
            if (error.code !== "FORCED_AUDIT_FAILURE") throw error;
        } finally { await session.endSession(); }
        if (await collection.countDocuments({ verifierRunId: runId, kind: new RegExp(`^${scenario}:`) })) throw new Error(`${scenario} rollback failed`);
    };
    try {
        await rollback("CREATE_NEW", ["package", "mapping", "decision"]);
        await rollback("LINK_EXISTING", ["mapping", "decision"]);
        await rollback("PACKAGE_SELECTION", ["selection-version"]);
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                for (const kind of ["SUCCESS:package", "SUCCESS:mapping", "SUCCESS:decision", "SUCCESS:audit"]) await collection.insertOne(fixture(kind), { session });
            });
        } finally { await session.endSession(); }
        if (await collection.countDocuments({ verifierRunId: runId, kind: /^SUCCESS:/ }) !== 4) throw new Error("successful retry did not commit atomically");
        const requests = await Promise.allSettled([1, 2].map(() => collection.insertOne({ _id: `${runId}:same`, verifierRunId: runId, kind: "CONCURRENT" })));
        if (requests.filter(result => result.status === "fulfilled").length !== 1 || requests.filter(result => result.status === "rejected").length !== 1) throw new Error("concurrent idempotency uniqueness was not enforced");
        process.stdout.write("PASS supplier lifecycle transaction integration (rollback, commit, concurrent uniqueness)\n");
    } finally {
        await collection.deleteMany({ verifierRunId: runId });
        await mongoose.disconnect();
    }
}

main().catch(async error => {
    console.error(error);
    try { if (mongoose.connection.readyState) await mongoose.disconnect(); } catch (_) {}
    process.exitCode = 1;
});
