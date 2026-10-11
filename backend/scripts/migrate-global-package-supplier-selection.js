#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const migration = require("../services/globalSupplierSelectionMigrationService");

const args = Object.fromEntries(process.argv.slice(2).filter(value => value.startsWith("--")).map(value => { const [key, ...rest] = value.slice(2).split("="); return [key, rest.length ? rest.join("=") : true]; }));
const mode = args.apply ? "apply" : args.rollback ? "rollback" : "dry-run";
const confirmText = "I_APPROVE_AZIEL_GLOBAL_SUPPLIER_SELECTION_MIGRATION";
const writeActions = new Set(["insert", "update", "remove", "createCollection", "createIndex", "dropCollection", "dropDatabase", "dropIndex", "dropIndexes", "renameCollectionSameDB", "renameCollectionAcrossDB", "bypassDocumentValidation", "collMod", "convertToCapped", "createUser", "dropUser", "grantRole", "revokeRole", "createRole", "dropRole", "compact", "reIndex"]);

function requiredUri() {
    const name = mode === "dry-run" ? "AZIEL_PRODUCTION_READONLY_MONGO_URI" : "AZIEL_GLOBAL_SUPPLIER_MIGRATION_MONGO_URI";
    const uri = String(process.env[name] || "").trim();
    if (!uri) throw new Error(`${name} is required; no fallback URI is permitted.`);
    return { name, uri };
}

function planPath() {
    if (!args.plan) throw new Error("--plan=/absolute/path/to/reviewed-plan.json is required.");
    const resolved = path.resolve(String(args.plan));
    if (!path.isAbsolute(resolved)) throw new Error("Plan path must be absolute.");
    return resolved;
}

async function assertNarrowWriter(db) {
    const status = await db.admin().command({ connectionStatus: 1, showPrivileges: true });
    const writePrivileges = [];
    for (const privilege of status.authInfo?.authenticatedUserPrivileges || []) {
        const actions = (privilege.actions || []).filter(action => writeActions.has(action));
        if (actions.length) writePrivileges.push({ resource: privilege.resource, actions });
    }
    const allowed = writePrivileges.every(privilege => privilege.resource?.db === "azielshop" && privilege.resource?.collection === "packagesupplierselections" && privilege.actions.every(action => ["insert", "remove"].includes(action)));
    const actionSet = new Set(writePrivileges.flatMap(privilege => privilege.actions));
    if (!allowed || !actionSet.has(mode === "apply" ? "insert" : "remove")) {
        throw new Error("Migration writer is missing the required action or has write privileges outside azielshop.packagesupplierselections.");
    }
    return { writeResources: writePrivileges.length, writeActions: [...actionSet].sort() };
}

function mongoStore(db, client) {
    const selections = db.collection("packagesupplierselections");
    const packages = db.collection("catalogpackages");
    const mappings = db.collection("supplierproductmappings");
    return {
        async loadState({ session } = {}) {
            const options = session ? { session } : {};
            // The MongoDB driver does not support parallel operations within one
            // transaction session. Keep these reads sequential so apply and
            // rollback work against a real replica set, not only mock stores.
            const packageRows = await packages.find({ deletedAt: null }, { ...options, projection: { productCode: 1, packageCode: 1, deletedAt: 1 } }).toArray();
            const selectionRows = await selections.find({ customerMarket: { $in: ["GLOBAL", "TH", "MM"] } }, { ...options, projection: { productCode: 1, packageCode: 1, customerMarket: 1, supplierMappingId: 1, decisionVersion: 1, selectedByUsernameSnapshot: 1, reason: 1 } }).toArray();
            const mappingRows = await mappings.find({}, { ...options, projection: { supplierId: 1, supplierCode: 1, productCode: 1, packageCode: 1, supplierProductCode: 1, supplierPackageCode: 1, enabled: 1, productionRole: 1, executionMode: 1, archivedAt: 1, fulfillmentEligibility: 1 } }).toArray();
            return { packages: packageRows, selections: selectionRows, mappings: mappingRows };
        },
        async insertGlobals(documents, { session }) {
            const materialized = documents.map(item => ({ ...item, supplierMappingId: new ObjectId(item.supplierMappingId) }));
            const result = await selections.insertMany(materialized, { ordered: true, session });
            return result.insertedCount;
        },
        async deleteMigrationGlobals(target, { session }) {
            let deletedCount = 0;
            for (const record of target.records) {
                const result = await selections.deleteOne({
                    productCode: record.productCode, packageCode: record.packageCode, customerMarket: "GLOBAL",
                    supplierMappingId: new ObjectId(record.supplierMappingId), decisionVersion: 1,
                    selectedByUsernameSnapshot: "GLOBAL_SUPPLIER_MIGRATION",
                    reason: `migration:${target.migrationId};plan:${target.planHash}`
                }, { session });
                deletedCount += result.deletedCount;
            }
            return deletedCount;
        },
        async withTransaction(callback) {
            const session = client.startSession();
            try { return await session.withTransaction(() => callback(session)); }
            finally { await session.endSession(); }
        }
    };
}

async function main() {
    if (mode !== "dry-run" && args.confirm !== confirmText) throw new Error(`--confirm=${confirmText} is required for ${mode}.`);
    const { name: uriEnvironment, uri } = requiredUri();
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    try {
        const db = client.db();
        if (db.databaseName !== "azielshop" && !String(db.databaseName).startsWith("aziel_global_supplier_migration_test")) throw new Error(`Refusing unexpected database ${db.databaseName}.`);
        if (mode !== "dry-run") await assertNarrowWriter(db);
        const store = mongoStore(db, client);
        if (mode === "dry-run") {
            const state = await store.loadState();
            const generatedAt = new Date().toISOString();
            const migrationId = String(args["migration-id"] || `global-supplier-selection-${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`);
            const plan = migration.buildPlan({ ...state, migrationId, generatedAt });
            const output = args.output ? path.resolve(String(args.output)) : "";
            if (output) fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: "wx" });
            console.log(JSON.stringify({ result: plan.conflicts.length ? "CONFLICTS_STOP" : "DRY_RUN_READY", mode, uriEnvironment, migrationId: plan.migrationId, planHash: plan.planHash, recordCount: plan.records.length, conflictCount: plan.conflicts.length, output: output || null, databaseWrites: 0 }, null, 2));
            if (plan.conflicts.length) process.exitCode = 2;
            return;
        }
        const plan = JSON.parse(fs.readFileSync(planPath(), "utf8"));
        const result = mode === "apply" ? await migration.applyPlan(store, plan) : await migration.rollbackPlan(store, plan);
        console.log(JSON.stringify({ result: "PASS", mode, uriEnvironment, migrationId: plan.migrationId, planHash: plan.planHash, ...result }, null, 2));
    } finally { await client.close(); }
}

if (require.main === module) {
    main().catch(error => { console.error(JSON.stringify({ result: "STOP", mode, code: error.code || error.name, message: error.message, details: error.details || {} }, null, 2)); process.exit(1); });
}

module.exports = { assertNarrowWriter, mongoStore };
