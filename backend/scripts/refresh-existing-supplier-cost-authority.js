#!/usr/bin/env node
"use strict";
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const crypto = require("crypto");
const fetch = require("node-fetch");
const mongoose = require("mongoose");
const Mapping = require("../models/SupplierProductMapping");
const fazer = require("../services/suppliers/fazercardsAdapter");
const wondd = require("../services/suppliers/wonddAdapter");
const { WONDD_FAMILIES, resolveFamilyForServiceCode } = require("../services/suppliers/wonddCatalogConfig");
const { providerGameCodeForProduct } = require("../services/commerce/canonicalGameInputContract");
const { isCanonicalProductCode } = require("../catalog/canonicalOperationalCatalog");
const APPLY = process.argv.includes("--apply");
const SUPPORTED_SUPPLIERS = Object.freeze(["WONDD", "FAZERCARDS"]);
const clean = value => String(value == null ? "" : value).trim();
const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function parseScopeArgs(argv = []) {
    const readFlag = name => {
        const values = argv.filter(arg => arg.startsWith(`--${name}=`)).map(arg => clean(arg.slice(name.length + 3)));
        if (values.length > 1 && new Set(values.map(value => value.toLowerCase())).size > 1) throw new Error(`Conflicting --${name} scope values.`);
        if (values.length && !values[0]) throw new Error(`--${name} scope cannot be empty.`);
        return values[0] || "";
    };
    const supplierInput = readFlag("supplier");
    const productInput = readFlag("product");
    const supplier = supplierInput.toUpperCase();
    const product = productInput.toLowerCase();
    if (supplier && !SUPPORTED_SUPPLIERS.includes(supplier)) throw new Error(`Unknown supplier scope: ${supplierInput}`);
    if (product && !isCanonicalProductCode(product)) throw new Error(`Unknown product scope: ${productInput}`);
    return Object.freeze({ supplier: supplier || null, product: product || null, requested: Boolean(supplier || product) });
}
function buildScopedMappingQuery(scope = {}) {
    const query = { supplierCode: { $in: SUPPORTED_SUPPLIERS }, archivedAt: null };
    if (scope.requested) query.enabled = true;
    if (scope.supplier) query.supplierCode = scope.supplier;
    if (scope.product) query.productCode = scope.product;
    return query;
}
function assertMappingInScope(mapping, scope = {}) {
    if (!scope.requested) return;
    if (mapping?.archivedAt || mapping?.enabled !== true || (scope.supplier && mapping?.supplierCode !== scope.supplier) || (scope.product && mapping?.productCode !== scope.product)) {
        throw new Error(`Mapping escaped requested scope: ${mapping?.supplierCode || "<missing>"}/${mapping?.productCode || "<missing>"}/${mapping?.packageCode || "<missing>"}`);
    }
}
function mappingMutationFilter(mapping, scope = {}) {
    assertMappingInScope(mapping, scope);
    const filter = { _id: mapping._id, archivedAt: null, supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode };
    if (scope.requested) {
        filter.enabled = true;
        filter.supplierCode = scope.supplier || mapping.supplierCode;
        filter.productCode = scope.product || mapping.productCode;
    }
    return filter;
}
async function applyCostAuthorityUpdates({ updates, MappingModel = Mapping, session, scope, capturedAt }) {
    updates.forEach(item => assertMappingInScope(item.mapping, scope));
    for (const item of updates) {
        await MappingModel.updateOne(mappingMutationFilter(item.mapping, scope), { $set: { supplierCostAuthority: { rawSupplierCost: item.raw, supplierCurrency: item.currency, capturedAt, source: item.source, providerProductCode: item.mapping.supplierProductCode, providerOfferCode: item.mapping.supplierPackageCode, fundingCost: Number(item.mapping.supplierCostAuthority?.fundingCost || 0), otherAcquisitionCost: Number(item.mapping.supplierCostAuthority?.otherAcquisitionCost || 0) }, "mappingMetadata.costAuthorityEvidence": { source: item.source, capturedAt, evidenceHash: item.evidenceHash, responseBodyPersisted: false } } }, { session });
    }
}
function resolveWonddFamilyForMapping(mapping, families = WONDD_FAMILIES) {
    const resolved = resolveFamilyForServiceCode(mapping?.supplierProductCode, families);
    const canonicalProductCode = clean(mapping?.productCode).toLowerCase();
    const canonicalSupplierFamily = providerGameCodeForProduct(canonicalProductCode);
    const familyProductCode = clean(resolved.family.productCode).toLowerCase();
    if (!canonicalProductCode || (canonicalProductCode !== familyProductCode && canonicalSupplierFamily !== familyProductCode)) {
        const error = new Error(`WonDD canonical/supplier family mismatch: ${mapping?.productCode || "<missing>"}/${mapping?.supplierProductCode || "<missing>"}`);
        error.code = "WONDD_CANONICAL_SUPPLIER_FAMILY_MISMATCH";
        throw error;
    }
    return resolved;
}
function findWonddCatalogOffer(offers, serviceId, supplierPackageCode) {
    const packCode = clean(supplierPackageCode);
    if (!packCode) throw new Error(`WonDD supplier packcode is required for service ${serviceId}.`);
    return offers.get(`${serviceId}:${packCode}`) || null;
}
function reconcileWonddMapping(mapping, rows, now = new Date()) {
    const current = mapping?.supplierCostAuthority || {};
    const ttlSeconds = Number(mapping?.mappingMetadata?.costAuthorityMaximumAgeSeconds || 86400);
    const capturedAt = new Date(current.capturedAt || 0);
    const currentCost = Number(current.rawSupplierCost);
    const base = {
        mappingId: clean(mapping?._id),
        productCode: clean(mapping?.productCode).toLowerCase(),
        packageCode: clean(mapping?.packageCode).toUpperCase(),
        providerProductId: clean(mapping?.supplierProductCode),
        providerPackcode: clean(mapping?.supplierPackageCode),
        currentSupplierCost: Number.isFinite(currentCost) ? currentCost : null,
        currentSupplierCurrency: clean(current.supplierCurrency),
        currentSource: clean(current.source),
        currentCapturedAt: Number.isFinite(capturedAt.getTime()) ? capturedAt.toISOString() : null,
        currentAgeSeconds: Number.isFinite(capturedAt.getTime()) ? Math.max(0, (now.getTime() - capturedAt.getTime()) / 1000) : null,
        ttlSeconds: Number.isFinite(ttlSeconds) ? ttlSeconds : null,
        proposedCapturedAt: now.toISOString()
    };
    try {
        if (!base.mappingId || !base.productCode || !base.packageCode || !base.providerProductId || !base.providerPackcode || !Number.isFinite(currentCost) || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
            return { ...base, classification: "INVALID_MAPPING", livePacklistMatchStatus: "INVALID_MAPPING", exactIdentityMatch: false, liveSupplierCost: null, liveSupplierCurrency: null, costDifference: null, proposedCostAuthority: null };
        }
        const { serviceId, family } = resolveWonddFamilyForMapping(mapping);
        const candidates = rows.filter(row => String(row.serviceid) === String(serviceId) && clean(row.packcode) === base.providerPackcode);
        if (candidates.length === 0) return { ...base, providerServiceId: String(serviceId), classification: "MISSING_PROVIDER_OFFER", livePacklistMatchStatus: "MISSING", exactIdentityMatch: false, liveSupplierCost: null, liveSupplierCurrency: null, costDifference: null, proposedCostAuthority: null };
        if (candidates.length > 1) return { ...base, providerServiceId: String(serviceId), classification: "AMBIGUOUS_PROVIDER_OFFER", livePacklistMatchStatus: "AMBIGUOUS", exactIdentityMatch: false, liveSupplierCost: null, liveSupplierCurrency: null, costDifference: null, proposedCostAuthority: null };
        const offer = candidates[0];
        const liveCost = Number(offer.netpricedealer);
        if (!Number.isFinite(liveCost) || liveCost < 0) return { ...base, providerServiceId: String(serviceId), classification: "INVALID_MAPPING", livePacklistMatchStatus: "INVALID_PROVIDER_COST", exactIdentityMatch: false, liveSupplierCost: null, liveSupplierCurrency: "THB", costDifference: null, proposedCostAuthority: null };
        const evidence = { serviceid: serviceId, servicecode: family.serviceCode, packcode: base.providerPackcode, netpricedealer: offer.netpricedealer };
        const sameCost = Math.abs(currentCost - liveCost) <= 0.000001;
        return {
            ...base,
            providerServiceId: String(serviceId),
            classification: sameCost ? "EXACT_MATCH_SAME_COST" : "EXACT_MATCH_COST_CHANGED",
            livePacklistMatchStatus: "EXACT_MATCH",
            exactIdentityMatch: true,
            liveSupplierCost: liveCost,
            liveSupplierCurrency: "THB",
            costDifference: liveCost - currentCost,
            proposedCostAuthority: {
                rawSupplierCost: liveCost,
                supplierCurrency: "THB",
                capturedAt: now.toISOString(),
                source: "WONDD_LIVE_PACKLIST",
                providerProductCode: base.providerProductId,
                providerOfferCode: base.providerPackcode,
                fundingCost: Number(current.fundingCost || 0),
                otherAcquisitionCost: Number(current.otherAcquisitionCost || 0),
                evidenceHash: sha(evidence)
            }
        };
    } catch (error) {
        return { ...base, classification: "INVALID_MAPPING", livePacklistMatchStatus: "INVALID_MAPPING", exactIdentityMatch: false, liveSupplierCost: null, liveSupplierCurrency: null, costDifference: null, proposedCostAuthority: null, error: error.message };
    }
}
async function wonddCatalog() {
    const response = await fetch("https://www.wondd.com/member/bot-game-packlist.php", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: clean(process.env.WONDD_USERNAME), password: clean(process.env.WONDD_PASSWORD) }).toString() });
    if (!response.ok) throw new Error(`WonDD catalog HTTP ${response.status}`);
    const rows = await response.json(); if (!Array.isArray(rows)) throw new Error("WonDD catalog shape invalid"); return rows;
}
async function main() {
    const scope = parseScopeArgs(process.argv.slice(2));
    if (APPLY && ["mlbb", "freefire"].some(product => wondd.isAutoFulfillmentEnabled(product))) throw new Error("WonDD gates must be OFF during cost refresh apply.");
    if (APPLY && ["pubg", "mlbb", "freefire", "hok", "valorant"].some(product => fazer.isAutoFulfillmentEnabled(product))) throw new Error("FazerCards gates must be OFF during cost refresh apply.");
    await mongoose.connect(process.env.MONGO_URI);
    const mappings = await Mapping.find(buildScopedMappingQuery(scope)).lean();
    if (scope.requested && !mappings.length) throw new Error(`No active mappings found for requested scope: ${scope.supplier || "ALL"}/${scope.product || "ALL"}`);
    const selectedSuppliers = new Set(mappings.map(mapping => mapping.supplierCode));
    const wr = selectedSuppliers.has("WONDD") ? await wonddCatalog() : [];
    const categories = [...new Set(mappings.filter(x => x.supplierCode === "FAZERCARDS").map(x => x.supplierProductCode))];
    const fazerOffers = new Map();
    for (const category of categories) {
        const payload = await fazer.getTopupOffers(category); fazerOffers.set(category, new Map((payload.offers || []).map(x => [clean(x.offer_id), x])));
    }
    const updates = [];
    const reconciliation = [];
    const capturedAt = new Date();
    for (const mapping of mappings) {
        let raw; let currency; let source; let evidence;
        if (mapping.supplierCode === "FAZERCARDS") {
            const offer = fazerOffers.get(mapping.supplierProductCode)?.get(mapping.supplierPackageCode);
            if (!offer) throw new Error(`Current FazerCards offer missing: ${mapping.supplierProductCode}/${mapping.supplierPackageCode}`);
            raw = Number(offer.price_usd); currency = "USD"; source = "FAZERCARDS_LIVE_API"; evidence = { category: mapping.supplierProductCode, offer: mapping.supplierPackageCode, price_usd: offer.price_usd };
        } else {
            const result = reconcileWonddMapping(mapping, wr, capturedAt);
            reconciliation.push(result);
            if (!result.exactIdentityMatch) continue;
            raw = result.liveSupplierCost; currency = result.liveSupplierCurrency; source = "WONDD_LIVE_PACKLIST";
            evidence = { serviceid: result.providerServiceId, servicecode: resolveWonddFamilyForMapping(mapping).family.serviceCode, packcode: mapping.supplierPackageCode, netpricedealer: raw };
        }
        if (!Number.isFinite(raw) || raw < 0) throw new Error(`Invalid provider cost: ${mapping.supplierCode}/${mapping.supplierPackageCode}`);
        const storedRaw = Number(mapping.supplierCostAuthority?.rawSupplierCost);
        updates.push({ mapping, raw, currency, source, evidenceHash: sha(evidence), storedRaw: Number.isFinite(storedRaw) ? storedRaw : null, drift: !Number.isFinite(storedRaw) || Math.abs(storedRaw - raw) > 0.000001 });
    }
    if (APPLY) {
        const unresolved = reconciliation.filter(item => !item.exactIdentityMatch);
        if (unresolved.length) throw new Error(`WonDD reconciliation failed closed for ${unresolved.length} mapping(s).`);
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            await applyCostAuthorityUpdates({ updates, session, scope, capturedAt });
        }); await session.endSession();
    }
    await mongoose.disconnect();
    const classificationCounts = Object.fromEntries(["EXACT_MATCH_SAME_COST", "EXACT_MATCH_COST_CHANGED", "MISSING_PROVIDER_OFFER", "AMBIGUOUS_PROVIDER_OFFER", "INVALID_MAPPING"].map(name => [name, reconciliation.filter(item => item.classification === name).length]));
    console.log(JSON.stringify({ result: "PASS", apply: APPLY, scope: { supplier: scope.supplier || "ALL", product: scope.product || "ALL" }, selectedMappings: mappings.length, reconciledMappings: reconciliation.length, refreshed: APPLY ? updates.length : 0, proposedRefreshes: updates.length, costMatches: updates.filter(x=>!x.drift).length, costDrift: updates.filter(x=>x.drift).map(x=>({ supplier:x.mapping.supplierCode, product:x.mapping.productCode, packageCode:x.mapping.packageCode, providerOffer:x.mapping.supplierPackageCode, stored:x.storedRaw, current:x.raw })), classifications: classificationCounts, reconciliation, bySupplier: { WONDD: updates.filter(x=>x.mapping.supplierCode==="WONDD").length, FAZERCARDS: updates.filter(x=>x.mapping.supplierCode==="FAZERCARDS").length }, proposedCapturedAt: capturedAt.toISOString(), writes: APPLY ? updates.length : 0, supplierCalls: { wonddPacklist: selectedSuppliers.has("WONDD") ? 1 : 0, wonddBalance: 0, wonddTransactional: 0, fazerTransactional: 0 }, providerSpend: 0, orderCalls: 0, validationCalls: 0, paymentCalls: 0, orderCreations: 0, fulfillmentAttempts: 0, catalogSellingPriceMutations: 0, priceVersionMutations: 0 }, null, 2));
}
if (require.main === module) {
    main().catch(async error => { await mongoose.disconnect().catch(()=>null); console.error(JSON.stringify({ result: "FAIL", message: error.message })); process.exitCode=1; });
}

module.exports = { parseScopeArgs, buildScopedMappingQuery, assertMappingInScope, mappingMutationFilter, applyCostAuthorityUpdates, resolveWonddFamilyForMapping, findWonddCatalogOffer, reconcileWonddMapping };
