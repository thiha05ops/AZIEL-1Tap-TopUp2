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
async function wonddCatalog() {
    const response = await fetch("https://www.wondd.com/member/bot-game-packlist.php", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: clean(process.env.WONDD_USERNAME), password: clean(process.env.WONDD_PASSWORD) }).toString() });
    if (!response.ok) throw new Error(`WonDD catalog HTTP ${response.status}`);
    const rows = await response.json(); if (!Array.isArray(rows)) throw new Error("WonDD catalog shape invalid"); return rows;
}
async function main() {
    const scope = parseScopeArgs(process.argv.slice(2));
    if (["mlbb", "freefire"].some(product => wondd.isAutoFulfillmentEnabled(product))) throw new Error("WonDD gates must be OFF during cost refresh.");
    if (["pubg", "mlbb", "freefire", "hok", "valorant"].some(product => fazer.isAutoFulfillmentEnabled(product))) throw new Error("FazerCards gates must be OFF during cost refresh.");
    await mongoose.connect(process.env.MONGO_URI);
    const mappings = await Mapping.find(buildScopedMappingQuery(scope)).lean();
    if (scope.requested && !mappings.length) throw new Error(`No active mappings found for requested scope: ${scope.supplier || "ALL"}/${scope.product || "ALL"}`);
    const selectedSuppliers = new Set(mappings.map(mapping => mapping.supplierCode));
    const [wb, fb, wr] = await Promise.all([
        selectedSuppliers.has("WONDD") ? wondd.getBalance() : null,
        selectedSuppliers.has("FAZERCARDS") ? fazer.getBalance() : null,
        selectedSuppliers.has("WONDD") ? wonddCatalog() : []
    ]);
    const categories = [...new Set(mappings.filter(x => x.supplierCode === "FAZERCARDS").map(x => x.supplierProductCode))];
    const fazerOffers = new Map();
    for (const category of categories) {
        const payload = await fazer.getTopupOffers(category); fazerOffers.set(category, new Map((payload.offers || []).map(x => [clean(x.offer_id), x])));
    }
    const wonddOffers = new Map(wr.map(row => [`${row.serviceid}:${clean(row.packcode)}`, row]));
    const updates = [];
    for (const mapping of mappings) {
        let raw; let currency; let source; let evidence;
        if (mapping.supplierCode === "FAZERCARDS") {
            const offer = fazerOffers.get(mapping.supplierProductCode)?.get(mapping.supplierPackageCode);
            if (!offer) throw new Error(`Current FazerCards offer missing: ${mapping.supplierProductCode}/${mapping.supplierPackageCode}`);
            raw = Number(offer.price_usd); currency = "USD"; source = "FAZERCARDS_LIVE_API"; evidence = { category: mapping.supplierProductCode, offer: mapping.supplierPackageCode, price_usd: offer.price_usd };
        } else {
            const { serviceId, family } = resolveWonddFamilyForMapping(mapping);
            const offer = findWonddCatalogOffer(wonddOffers, serviceId, mapping.supplierPackageCode);
            if (!offer) throw new Error(`Current WonDD pack missing: ${serviceId}/${mapping.supplierPackageCode}`);
            raw = Number(offer.netpricedealer); currency = "THB"; source = "WONDD_LIVE_PACKLIST"; evidence = { serviceid: serviceId, servicecode: family.serviceCode, packcode: mapping.supplierPackageCode, netpricedealer: offer.netpricedealer };
        }
        if (!Number.isFinite(raw) || raw < 0) throw new Error(`Invalid provider cost: ${mapping.supplierCode}/${mapping.supplierPackageCode}`);
        const storedRaw = Number(mapping.supplierCostAuthority?.rawSupplierCost);
        updates.push({ mapping, raw, currency, source, evidenceHash: sha(evidence), storedRaw: Number.isFinite(storedRaw) ? storedRaw : null, drift: !Number.isFinite(storedRaw) || Math.abs(storedRaw - raw) > 0.000001 });
    }
    const capturedAt = new Date();
    if (APPLY) {
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            await applyCostAuthorityUpdates({ updates, session, scope, capturedAt });
        }); await session.endSession();
    }
    await mongoose.disconnect();
    const [wa, fa] = await Promise.all([selectedSuppliers.has("WONDD") ? wondd.getBalance() : null, selectedSuppliers.has("FAZERCARDS") ? fazer.getBalance() : null]);
    console.log(JSON.stringify({ result: "PASS", apply: APPLY, scope: { supplier: scope.supplier || "ALL", product: scope.product || "ALL" }, selectedMappings: mappings.length, refreshed: updates.length, costMatches: updates.filter(x=>!x.drift).length, costDrift: updates.filter(x=>x.drift).map(x=>({ supplier:x.mapping.supplierCode, product:x.mapping.productCode, packageCode:x.mapping.packageCode, providerOffer:x.mapping.supplierPackageCode, stored:x.storedRaw, current:x.raw })), bySupplier: { WONDD: updates.filter(x=>x.mapping.supplierCode==="WONDD").length, FAZERCARDS: updates.filter(x=>x.mapping.supplierCode==="FAZERCARDS").length }, capturedAt: APPLY ? capturedAt : null, balances: { wonddBefore: wb?.rawMetadata?.balance ?? null, wonddAfter: wa?.rawMetadata?.balance ?? null, fazerBefore: fb?.rawMetadata?.balance ?? null, fazerAfter: fa?.rawMetadata?.balance ?? null }, providerSpend: { WONDD: wb && wa ? Number(wb.rawMetadata.balance)-Number(wa.rawMetadata.balance) : null, FAZERCARDS: fb && fa ? Number(fb.rawMetadata.balance)-Number(fa.rawMetadata.balance) : null }, orderCalls: 0, validationCalls: 0 }, null, 2));
}
if (require.main === module) {
    main().catch(async error => { await mongoose.disconnect().catch(()=>null); console.error(JSON.stringify({ result: "FAIL", message: error.message })); process.exitCode=1; });
}

module.exports = { parseScopeArgs, buildScopedMappingQuery, assertMappingInScope, mappingMutationFilter, applyCostAuthorityUpdates, resolveWonddFamilyForMapping, findWonddCatalogOffer };
