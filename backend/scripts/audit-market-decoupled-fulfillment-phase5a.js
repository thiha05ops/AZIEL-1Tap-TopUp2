#!/usr/bin/env node
"use strict";

const path = require("path");
const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const { getSupplierAdapter } = require("../services/supplierAdapterRegistry");
const { validateFulfillmentEligibility } = require("../services/supplierFulfillmentEligibilityService");
const { costAuthorityFresh, evaluateFutureAuthority } = require("../services/futureSupplierAuthorityAuditService");

const countBy = (items, selector) => items.reduce((counts, item) => { const key = String(selector(item) || "UNKNOWN"); counts[key] = (counts[key] || 0) + 1; return counts; }, {});
const processorReady = mapping => {
    if (mapping.supplierCode === "WONDD") {
        const { CONFIRMED_SERVICE_CODES } = require("../services/suppliers/wonddCatalogConfig");
        const { hasWonddGameIdFormatter } = require("../services/suppliers/wonddGameIdFormatters");
        return Boolean(CONFIRMED_SERVICE_CODES[mapping.productCode]) && hasWonddGameIdFormatter(mapping.productCode);
    }
    if (mapping.supplierCode === "FAZERCARDS") return require("../services/suppliers/fazercardsFulfillmentProcessor").supportsFazerCardsMapping(mapping);
    return false;
};

async function buildAudit({ suppliers, mappings, now = new Date(), supplierLevelGates = {} }) {
    const supplierById = new Map(suppliers.map(item => [String(item._id), item]));
    const evaluations = mappings.map(mapping => {
        const supplier = supplierById.get(String(mapping.supplierId)) || {};
        const adapter = getSupplierAdapter(supplier);
        const currentProductGate = (() => { try { return adapter?.isAutoFulfillmentEnabled?.(mapping.productCode) === true; } catch { return false; } })();
        return { mapping, supplier, currentProductGate, evaluation: evaluateFutureAuthority({ mapping, supplier, currentProductGate, supplierLevelGate: supplierLevelGates[mapping.supplierCode] === true, adapterConfigured: adapter?.isConfigured?.() === true, processorReady: processorReady(mapping), now }) };
    });
    const supplierReports = suppliers.map(supplier => {
        const rows = evaluations.filter(row => String(row.mapping.supplierId) === String(supplier._id));
        const active = rows.filter(row => !row.mapping.archivedAt);
        return {
            supplierCode: supplier.supplierCode,
            enabled: supplier.enabled === true,
            mode: supplier.mode,
            capabilities: supplier.capabilities || [],
            configurationStatus: supplier.configurationStatus,
            supportedRegions: supplier.supportedRegions || [],
            totalActiveMappings: active.length,
            enabledMappings: active.filter(row => row.mapping.enabled === true).length,
            primaryMappings: active.filter(row => row.mapping.productionRole === "PRIMARY").length,
            apiMappings: active.filter(row => row.mapping.executionMode === "API").length,
            products: [...new Set(active.map(row => row.mapping.productCode))].sort(),
            legacyRegionDistribution: countBy(active, row => row.mapping.region),
            eligibilityModeDistribution: countBy(active, row => validateFulfillmentEligibility(row.mapping.fulfillmentEligibility).value.mode),
            evidenceCodeDistribution: countBy(active, row => validateFulfillmentEligibility(row.mapping.fulfillmentEligibility).value.evidenceCode || "NONE"),
            staleCostAuthorityCount: active.filter(row => !costAuthorityFresh(row.mapping, now)).length,
            missingSupplierProductIdentity: active.filter(row => !String(row.mapping.supplierProductCode || "").trim()).length,
            missingSupplierPackageIdentity: active.filter(row => !String(row.mapping.supplierPackageCode || "").trim()).length,
            currentlyBlockedByProductGate: active.filter(row => !row.currentProductGate).length,
            futureDbAuthorityCandidates: active.filter(row => row.evaluation.futureEnabled).length,
            byProduct: Object.fromEntries([...new Set(active.map(row => row.mapping.productCode))].sort().map(product => {
                const productRows = active.filter(row => row.mapping.productCode === product);
                return [product, { mappings: productRows.length, currentGateEnabled: productRows.some(row => row.currentProductGate), futureCandidates: productRows.filter(row => row.evaluation.futureEnabled).length, parity: countBy(productRows, row => row.evaluation.classification) }];
            }))
        };
    });
    return {
        result: "PASS",
        mode: "READ_ONLY_AUDIT",
        generatedAt: new Date(now).toISOString(),
        simulation: { supplierLevelGates, note: "Explicit simulation input; no supplier-level production env gate is read or created." },
        totals: { suppliers: suppliers.length, mappings: mappings.length, activeMappings: mappings.filter(mapping => !mapping.archivedAt).length },
        parity: countBy(evaluations, row => row.evaluation.classification),
        suppliers: supplierReports,
        safety: { databaseWrites: 0, providerOrderCalls: 0, providerTopupCalls: 0, productionRoutingChanges: 0, environmentChanges: 0 }
    };
}

async function main() {
    require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
    const uri = String(process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
    if (!uri) throw Object.assign(new Error("MONGO_URI is required."), { code: "MONGO_URI_REQUIRED" });
    await mongoose.connect(uri, { autoIndex: false });
    const [suppliers, mappings] = await Promise.all([Supplier.find({}).sort({ supplierCode: 1 }).lean(), Mapping.find({}).sort({ supplierCode: 1, productCode: 1, packageCode: 1 }).lean()]);
    console.log(JSON.stringify(await buildAudit({ suppliers, mappings, supplierLevelGates: Object.fromEntries(suppliers.map(supplier => [supplier.supplierCode, true])) }), null, 2));
    await mongoose.disconnect();
}

if (require.main === module) main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; });
module.exports = Object.freeze({ buildAudit, processorReady });
