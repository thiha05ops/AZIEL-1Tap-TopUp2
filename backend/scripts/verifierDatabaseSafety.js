"use strict";

const SAFE_DATABASE_NAME = /(?:test|e2e|local|dev|verifier|sandbox)/i;
const REQUIRED_MUTATION_FLAG = "AZIEL_ALLOW_MUTATING_VERIFIER";
const VERIFIER_MONGO_URI_ENV = "AZIEL_VERIFIER_MONGO_URI";

function extractDatabaseName(mongoUri = "") {
    const uri = String(mongoUri || "").trim();
    if (!uri) return "";

    try {
        const parsed = new URL(uri);
        return decodeURIComponent(String(parsed.pathname || "").replace(/^\//, "").split("/")[0] || "");
    } catch (_error) {
        const pathStart = uri.indexOf("/", uri.indexOf("://") + 3);
        if (pathStart === -1) return "";
        return uri.slice(pathStart + 1).split(/[/?#]/)[0] || "";
    }
}

function assertSafeMutatingVerifierDatabase(label = "mutating verifier") {
    const mongoUri = String(process.env[VERIFIER_MONGO_URI_ENV] || "").trim();
    const databaseName = extractDatabaseName(mongoUri);
    const explicitOptIn = process.env[REQUIRED_MUTATION_FLAG] === "true";
    const hostedEnvironment = Boolean(
        process.env.RENDER ||
        process.env.RENDER_SERVICE_ID ||
        process.env.VERCEL ||
        process.env.RAILWAY_ENVIRONMENT ||
        process.env.FLY_APP_NAME
    );
    const productionEnvironment = String(process.env.NODE_ENV || "").toLowerCase() === "production";

    if (hostedEnvironment || productionEnvironment) {
        throw new Error(`${label} refused: mutating verifiers may not run in hosted or production environments.`);
    }

    if (!explicitOptIn) {
        throw new Error(`${label} refused: set ${REQUIRED_MUTATION_FLAG}=true for an explicit test-database run.`);
    }

    if (!mongoUri) {
        throw new Error(`${label} refused: ${VERIFIER_MONGO_URI_ENV} is required; normal MONGO_URI fallback is forbidden.`);
    }

    if (!databaseName || databaseName.toLowerCase() === "azielshop" || !SAFE_DATABASE_NAME.test(databaseName)) {
        throw new Error(`${label} refused: database name must clearly be test/e2e/local/dev/verifier/sandbox.`);
    }

    return { databaseName, mongoUri };
}

module.exports = {
    assertSafeMutatingVerifierDatabase,
    extractDatabaseName,
    VERIFIER_MONGO_URI_ENV
};
