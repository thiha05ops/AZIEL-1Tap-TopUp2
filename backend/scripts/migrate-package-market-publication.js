#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const mongoose = require("mongoose");
require("dotenv").config();

const PackageMarketPublication = require("../models/PackageMarketPublication");
const { toPublicCatalog } = require("../services/catalogService");
const { normalizeCustomerMarket, publicationKey } = require("../services/packageMarketPublicationService");

function argsOf(argv = process.argv.slice(2)) {
    const args = {};
    for (const token of argv) {
        if (!token.startsWith("--")) continue;
        const [key, ...rest] = token.slice(2).split("=");
        args[key] = rest.length ? rest.join("=") : true;
    }
    return args;
}

function stablePlanHash(records) {
    return crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

function publicationBaselineEntry(record, keyParts = {}) {
    if (!record) return {
        productCode: keyParts.productCode,
        packageCode: keyParts.packageCode,
        customerMarket: keyParts.customerMarket,
        exists: false,
        published: false,
        decisionVersion: 0,
        updatedAt: "",
        provenanceSource: "",
        migrationId: "",
        provenancePlanHash: ""
    };
    return {
        productCode: String(record.productCode || "").toLowerCase(),
        packageCode: String(record.packageCode || "").toUpperCase(),
        customerMarket: String(record.customerMarket || "").toUpperCase(),
        exists: true,
        published: record.published === true,
        decisionVersion: Number(record.decisionVersion || 0),
        updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : "",
        provenanceSource: String(record.provenance?.source || ""),
        migrationId: String(record.provenance?.migrationId || ""),
        provenancePlanHash: String(record.provenance?.metadata?.planHash || "")
    };
}

function buildPublicationBaseline(existing = [], planRecords = [], customerMarket = "TH") {
    const market = normalizeCustomerMarket(customerMarket);
    const actual = new Map(existing.filter(item => String(item.customerMarket || "").toUpperCase() === market)
        .map(item => [publicationKey(item.productCode, item.packageCode, market), item]));
    const identities = new Map(planRecords.map(item => [publicationKey(item.productCode, item.packageCode, market), item]));
    for (const item of existing) {
        if (String(item.customerMarket || "").toUpperCase() === market) identities.set(publicationKey(item.productCode, item.packageCode, market), item);
    }
    return [...identities.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => publicationBaselineEntry(actual.get(publicationKey(item.productCode, item.packageCode, market)), {
        productCode: String(item.productCode || "").toLowerCase(), packageCode: String(item.packageCode || "").toUpperCase(), customerMarket: market
    }));
}

function publicationBaselineHash(baseline = []) {
    return crypto.createHash("sha256").update(JSON.stringify(baseline)).digest("hex");
}

function samePlanMigration(record, plan) {
    return record?.provenance?.source === "LEGACY_PUBLIC_CATALOG_MIGRATION" &&
        record?.provenance?.migrationId === plan.migrationId &&
        record?.provenance?.metadata?.planHash === plan.planHash;
}

function analyzePublicationState(plan, existing = []) {
    const market = plan.customerMarket;
    const planKeys = new Set(plan.records.map(item => publicationKey(item.productCode, item.packageCode, market)));
    const existingByKey = new Map(existing.map(item => [publicationKey(item.productCode, item.packageCode, market), item]));
    const expectedByKey = new Map((plan.publicationBaseline || []).map(item => [publicationKey(item.productCode, item.packageCode, market), item]));
    const result = { absentPlanKeys: [], insertedPlanKeys: [], samePlanExistingKeys: [], compatibleAdminPublishedKeys: [], conflictingAdminPrivateKeys: [], outOfPlanPublishedKeys: [], outOfPlanPrivateKeys: [], newerAdminDecisionKeys: [], duplicateKeys: [] };
    const seen = new Set();
    for (const item of existing) {
        const key = publicationKey(item.productCode, item.packageCode, market);
        if (seen.has(key)) result.duplicateKeys.push(key);
        seen.add(key);
        const inPlan = planKeys.has(key);
        if (samePlanMigration(item, plan)) {
            if (inPlan) result.samePlanExistingKeys.push(key);
            continue;
        }
        const currentEntry = publicationBaselineEntry(item);
        const expected = expectedByKey.get(key);
        if (!expected || JSON.stringify(currentEntry) !== JSON.stringify(expected)) result.newerAdminDecisionKeys.push(key);
        if (inPlan && item.published === true) result.compatibleAdminPublishedKeys.push(key);
        else if (inPlan) result.conflictingAdminPrivateKeys.push(key);
        else if (item.published === true) result.outOfPlanPublishedKeys.push(key);
        else result.outOfPlanPrivateKeys.push(key);
    }
    for (const key of planKeys) if (!existingByKey.has(key)) result.absentPlanKeys.push(key);
    for (const key of Object.keys(result)) result[key] = [...new Set(result[key])].sort();
    result.conflictKeys = [...new Set([
        ...result.conflictingAdminPrivateKeys,
        ...result.outOfPlanPublishedKeys,
        ...result.newerAdminDecisionKeys,
        ...result.duplicateKeys
    ])].sort();
    return result;
}

function assertPlan(plan, expectedCount = 57) {
    const records = Array.isArray(plan.records) ? plan.records : [];
    const keys = records.map(record => publicationKey(record.productCode, record.packageCode, record.customerMarket));
    const unique = new Set(keys);
    if (plan.legacyPublicCount !== expectedCount) throw new Error(`ABORT: legacy public count ${plan.legacyPublicCount} != ${expectedCount}`);
    if (records.length !== expectedCount) throw new Error(`ABORT: proposed publication count ${records.length} != ${expectedCount}`);
    if (unique.size !== records.length) throw new Error(`ABORT: duplicate publication keys ${records.length - unique.size}`);
    if ((plan.added || []).length) throw new Error(`ABORT: proposed model adds ${(plan.added || []).length} packages`);
    if ((plan.removed || []).length) throw new Error(`ABORT: proposed model removes ${(plan.removed || []).length} packages`);
    if (plan.planHash !== stablePlanHash(records)) throw new Error("ABORT: plan hash mismatch");
    if (!Array.isArray(plan.publicationBaseline)) throw new Error("ABORT: publication baseline is required");
    if (plan.publicationBaselineHash !== publicationBaselineHash(plan.publicationBaseline)) throw new Error("ABORT: publication baseline hash mismatch");
    const baselineKeys = plan.publicationBaseline.map(item => publicationKey(item.productCode, item.packageCode, item.customerMarket));
    if (new Set(baselineKeys).size !== baselineKeys.length) throw new Error("ABORT: duplicate publication baseline keys");
    for (const key of unique) if (!baselineKeys.includes(key)) throw new Error(`ABORT: publication baseline missing plan key ${key}`);
    const expectedByProduct = { mlbb: 18, "mlbb-twilight-weekly-pass": 2, pubg: 6, freefire: 9, "freefire-pass-membership": 10, hok: 12 };
    for (const [productCode, expected] of Object.entries(expectedByProduct)) {
        const actual = records.filter(record => record.productCode === productCode).length;
        if (actual !== expected) throw new Error(`ABORT: ${productCode} publication count ${actual} != ${expected}`);
    }
}

async function buildPlan(customerMarket = "TH") {
    const products = await toPublicCatalog({
        source: "database",
        includeDisabled: false,
        customerMarket,
        publicationProjectionMode: "LEGACY"
    });
    const snapshotAt = new Date();
    const records = products.flatMap(product => (product.packages || []).map(pkg => ({
        productCode: product.productCode,
        packageCode: pkg.packageCode,
        customerMarket,
        published: true
    }))).sort((a, b) => publicationKey(a.productCode, a.packageCode, customerMarket).localeCompare(publicationKey(b.productCode, b.packageCode, customerMarket)));
    const proposedKeys = new Set(records.map(record => publicationKey(record.productCode, record.packageCode, customerMarket)));
    const legacyKeys = new Set(records.map(record => publicationKey(record.productCode, record.packageCode, customerMarket)));
    const existingPublications = await PackageMarketPublication.find({ customerMarket }).lean();
    const publicationBaseline = buildPublicationBaseline(existingPublications, records, customerMarket);
    const plan = {
        schemaVersion: 1,
        migrationId: `package-market-publication-${customerMarket.toLowerCase()}-${snapshotAt.toISOString()}`,
        generatedAt: snapshotAt.toISOString(),
        source: "current-effective-public-catalog",
        customerMarket,
        legacyPublicCount: legacyKeys.size,
        proposedPublishedCount: proposedKeys.size,
        duplicatePublicationKeys: records.length - proposedKeys.size,
        added: [...proposedKeys].filter(key => !legacyKeys.has(key)),
        removed: [...legacyKeys].filter(key => !proposedKeys.has(key)),
        records,
        publicationBaseline,
        publicationBaselineHash: publicationBaselineHash(publicationBaseline)
    };
    plan.planHash = stablePlanHash(records);
    assertPlan(plan);
    return plan;
}

async function applyReviewedPlan(plan) {
    assertPlan(plan);
    const current = await buildPlan(plan.customerMarket);
    if (current.planHash !== plan.planHash) throw new Error("ABORT: reviewed plan no longer matches the current legacy public set");
    const session = await mongoose.startSession();
    let result = { upserted: 0, modified: 0, insertedPlanKeys: [] };
    try {
        await session.withTransaction(async () => {
            const existing = await PackageMarketPublication.find({ customerMarket: plan.customerMarket }).session(session).lean();
            const analysis = analyzePublicationState(plan, existing);
            result.before = analysis;
            if (analysis.conflictKeys.length) throw new Error(`ABORT: publication decision baseline conflict: ${analysis.conflictKeys.join(", ")}`);
            for (const record of plan.records) {
                const update = await PackageMarketPublication.updateOne(
                    { productCode: record.productCode, packageCode: record.packageCode, customerMarket: record.customerMarket },
                    {
                        $setOnInsert: {
                            ...record,
                            publishedAt: new Date(plan.generatedAt),
                            publishedBy: "phase1-reviewed-migration",
                            decisionVersion: 1,
                            decisionNote: "Backfilled from reviewed legacy public storefront parity snapshot.",
                            provenance: { source: "LEGACY_PUBLIC_CATALOG_MIGRATION", migrationId: plan.migrationId, legacySnapshotAt: new Date(plan.generatedAt), metadata: { planHash: plan.planHash } }
                        }
                    },
                    { upsert: true, runValidators: true, session }
                );
                result.upserted += update.upsertedCount || 0;
                result.modified += update.modifiedCount || 0;
                if (update.upsertedCount) result.insertedPlanKeys.push(publicationKey(record.productCode, record.packageCode, record.customerMarket));
            }
            const afterRecords = await PackageMarketPublication.find({ customerMarket: plan.customerMarket }).session(session).lean();
            const after = analyzePublicationState(plan, afterRecords);
            const planKeys = new Set(plan.records.map(item => publicationKey(item.productCode, item.packageCode, plan.customerMarket)));
            const publishedPlanKeys = afterRecords.filter(item => item.published === true && planKeys.has(publicationKey(item.productCode, item.packageCode, plan.customerMarket)));
            if (publishedPlanKeys.length !== 57 || after.conflictingAdminPrivateKeys.length || after.outOfPlanPublishedKeys.length) throw new Error("ABORT: final key-scoped publication parity failed");
            result.transactionAfter = after;
            result.publishedPlanKeyCount = publishedPlanKeys.length;
        });
    } finally {
        await session.endSession();
    }
    const postCommitRecords = await PackageMarketPublication.find({ customerMarket: plan.customerMarket }).lean();
    result.postCommit = analyzePublicationState(plan, postCommitRecords);
    result.insertedPlanKeys.sort();
    result.concurrentDecisionDetected = result.postCommit.conflictKeys.length > 0;
    return result;
}

async function main() {
    const args = argsOf();
    const customerMarket = normalizeCustomerMarket(args["customer-market"] || "TH");
    if ((args.source || "current-effective-public-catalog") !== "current-effective-public-catalog") throw new Error("Only current-effective-public-catalog is supported.");
    const apply = args.apply === true;
    if (apply && !args["reviewed-plan"]) throw new Error("--apply requires --reviewed-plan=<path>.");
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI, { autoIndex: false });
    const plan = apply
        ? JSON.parse(fs.readFileSync(String(args["reviewed-plan"]), "utf8"))
        : await buildPlan(customerMarket);
    const output = apply ? { mode: "APPLY", planHash: plan.planHash, result: await applyReviewedPlan(plan) } : { mode: "DRY_RUN", ...plan };
    if (apply && output.result.concurrentDecisionDetected) {
        output.mode = "APPLY_REVIEW_REQUIRED";
        process.exitCode = 2;
    }
    if (args.report) fs.writeFileSync(String(args.report), `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify(output, null, 2));
    await mongoose.disconnect();
}

if (require.main === module) main().catch(async error => {
    console.error(error.message);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});

module.exports = { analyzePublicationState, argsOf, assertPlan, buildPlan, buildPublicationBaseline, publicationBaselineEntry, publicationBaselineHash, stablePlanHash };
