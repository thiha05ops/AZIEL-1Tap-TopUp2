#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const { assertIsolatedMongoUri } = require("../lib/assertIsolatedMongoUri");
const Supplier = require("../../models/Supplier");
const Product = require("../../models/SupplierCatalogProduct");
const Offer = require("../../models/SupplierCatalogOffer");
const Availability = require("../../models/SupplierOfferAvailability");
const Run = require("../../models/SupplierCatalogIngestionRun");
const Observation = require("../../models/SupplierCatalogCostObservation");
const fazer = require("../../services/supplierCatalog/providers/fazerCardsCatalogIngestionService");
const { readSupplierCostEvidencePolicy } = require("../../config/supplierCostEvidencePolicy");
const { createSupplierCatalogMongoRepositories } = require("../../services/supplierCatalog/supplierCatalogMongoRepositories");
const { createRepositories: createWeeklyRepositories } = require("../../services/supplierCatalog/weeklySupplierCostSyncService");

const uri = process.env.AZIEL_ISOLATED_MONGO_URI;
const phase = process.env.AZIEL_RESTART_PHASE;
assertIsolatedMongoUri(uri, "aziel_fazercards_restart_");
if (!['ON', 'OFF'].includes(phase)) throw new Error("ISOLATED_RESTART_PHASE_REJECTED");

const reader = single => ({
    listCategories: async () => ({ items: [{ category_id: "game-a", name: "Synthetic Game", note: "Region: GLOBAL" }], meta: { next_cursor: "" } }),
    listOffers: async () => ({ offers: single ? [{ offer_id: "offer-a", name: "100 Diamonds", price_usd: 1 }] : [{ offer_id: "offer-a", name: "100 Diamonds", price_usd: 1 }, { offer_id: "offer-b", name: "200 Diamonds", price_usd: 2 }], fields: [{ key: "player_id", required: true }], meta: { revision: `restart-${phase}` } })
});

async function apply(supplierId, observedAt, single, optimized, runKey) {
    const stage = await fazer.stageCatalog({ reader: reader(single), supplierId, mappings: [], observedAt });
    const plan = fazer.planMutations(stage, { products: await Product.find({ supplierId }).lean(), offers: await Offer.find({ supplierId }).lean() });
    const repositories = createSupplierCatalogMongoRepositories({ Product, Offer, Availability, Run, Observation }, { evidencePolicy: readSupplierCostEvidencePolicy(optimized ? { SUPPLIER_COST_OBSERVATION_CURRENT_RUN_ONLY_ENABLED: "true" } : {}) });
    const events = [];
    const run = await fazer.applyCatalogOnlyPlan(plan, repositories, { runKey, onProgress: event => events.push(event) });
    return { run, telemetry: events.find(event => event.phase === "APPLY_OBSERVATION_TELEMETRY") };
}

async function main() {
    await mongoose.connect(uri, { autoIndex: false });
    if (phase === "ON") {
        await Promise.all([Supplier, Product, Offer, Availability, Run, Observation].map(model => model.syncIndexes()));
        const supplier = await Supplier.findOneAndUpdate({ supplierCode: "FAZERCARDS" }, { $setOnInsert: { supplierCode: "FAZERCARDS", name: "Synthetic FazerCards", mode: "API", enabled: true, supplierCurrency: "USD" } }, { upsert: true, new: true });
        await apply(supplier._id, new Date("2026-10-20T04:00:00.000Z"), false, true, "restart-on-seed");
        const exact = await apply(supplier._id, new Date("2026-10-20T04:01:00.000Z"), true, true, "restart-on-current-only");
        process.send?.({ phase, pid: process.pid, exactRunId: String(exact.run._id), exactRows: await Observation.countDocuments({ ingestionRunId: exact.run._id }), totalRows: await Observation.countDocuments({}), telemetry: exact.telemetry });
    } else {
        const supplier = await Supplier.findOne({ supplierCode: "FAZERCARDS" });
        const prior = await Run.findOne({ runKey: "restart-on-current-only" }).lean();
        const weekly = createWeeklyRepositories({}, { evidencePolicy: readSupplierCostEvidencePolicy({}) });
        const ids = await Offer.find({ supplierId: supplier._id }).distinct("_id");
        const before = await weekly.observations(ids, prior._id);
        const off = await apply(supplier._id, new Date("2026-10-20T04:02:00.000Z"), true, false, "restart-off-legacy");
        const after = await weekly.observations(ids, prior._id);
        process.send?.({ phase, pid: process.pid, exactRunId: String(prior._id), beforeExactRows: before.length, afterExactRows: after.length, totalRows: await Observation.countDocuments({}), telemetry: off.telemetry });
    }
    await mongoose.disconnect();
}

main().catch(async error => { process.send?.({ phase, pid: process.pid, error: error.message }); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });
