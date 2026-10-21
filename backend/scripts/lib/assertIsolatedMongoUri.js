"use strict";

const ConnectionString = require("mongodb-connection-string-url").default;

function assertIsolatedMongoUri(uri, expectedDatabasePrefix = "aziel_") {
    if (typeof uri !== "string" || !uri.trim()) throw new Error("ISOLATED_MONGO_URI_REQUIRED");
    let parsed;
    try { parsed = new ConnectionString(uri); }
    catch { throw new Error("ISOLATED_MONGO_URI_INVALID"); }
    if (parsed.isSRV) throw new Error("ISOLATED_MONGO_URI_SRV_REJECTED");
    const hosts = parsed.hosts || [];
    if (!hosts.length || hosts.some(host => !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host))) throw new Error("ISOLATED_MONGO_URI_NONLOCAL_REJECTED");
    const database = String(parsed.pathname || "").replace(/^\//, "");
    if (!database || database.toLowerCase() === "azielshop" || !database.startsWith(expectedDatabasePrefix)) throw new Error("ISOLATED_MONGO_DATABASE_REJECTED");
    return Object.freeze({ database, hosts: hosts.length });
}

module.exports = Object.freeze({ assertIsolatedMongoUri });
