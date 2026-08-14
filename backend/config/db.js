const mongoose = require("mongoose");
const { assertE2EMode, assertE2EMongoUri } = require("../e2e/e2eSafety");

function hasE2EIntent(env = process.env) {
    return [
        "AZIEL_E2E_TEST_MODE",
        "AZIEL_E2E_TEST_SCOPE",
        "AZIEL_E2E_TEST_CONFIRM",
        "AZIEL_E2E_MONGO_URI"
    ].some(key => String(env[key] || "").trim());
}

function resolveMongoUri(env = process.env) {
    if (hasE2EIntent(env)) {
        assertE2EMode(env);
        return assertE2EMongoUri(env).mongoUri;
    }

    const mongoUri = String(env.MONGO_URI || "").trim();
    if (!mongoUri) throw new Error("MONGO_URI is required.");
    return mongoUri;
}

const connectDB = async () => {
    try {
        await mongoose.connect(resolveMongoUri(process.env), {
            serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
        });
        console.log("MongoDB Connected");
        return mongoose.connection;
    } catch (error) {
        const code = error?.code || error?.name || "MONGO_CONNECTION_FAILED";
        console.error("DB connection failed:", code);
        throw error;
    }
};

module.exports = connectDB;
module.exports.hasE2EIntent = hasE2EIntent;
module.exports.resolveMongoUri = resolveMongoUri;
