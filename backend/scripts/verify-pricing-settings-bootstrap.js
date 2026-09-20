#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const PricingPolicy = require("../models/PricingPolicy");
const ExchangeRateAuthority = require("../models/ExchangeRateAuthority");

function queryResult(rows, delayMs = 0) {
    const query = {
        select() { return query; },
        sort() { return query; },
        maxTimeMS() { return query; },
        async lean() {
            if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
            return rows;
        }
    };
    return query;
}

const now = new Date();
const policy = (region, currency, suffix, status = "ACTIVE", metadata = {}) => ({
    _id: `${region}-${status}`,
    name: `${region} policy`,
    code: status === "DRAFT" ? `AZIEL_PRICING_DRAFT_${region}_${currency}` : `AZIEL_PRICING_${region}_${currency}_${suffix}`,
    status,
    region,
    currency,
    defaultProfitRule: { type: "PERCENT", value: region === "TH" ? 5 : 6 },
    defaultGatewayFee: { enabled: true, type: "PERCENT", value: 1 },
    defaultPlatformCost: { enabled: false, type: "FIXED", value: 0 },
    defaultRoundingRule: { enabled: false, mode: "NONE", increment: 0 },
    minimumProfitAmount: region === "TH" ? 4 : 300,
    maximumProfitAmount: region === "TH" ? 70 : 5000,
    metadata,
    effectiveFrom: new Date(now.getTime() - 1000),
    effectiveUntil: null,
    updatedAt: now
});

const activePolicies = [policy("TH", "THB", "V1"), policy("MM", "MMK", "V1")];
const fxRows = [
    { _id: "fx1", fromCurrency: "USD", toCurrency: "THB", rate: 33.51, source: "manual_admin", capturedAt: now, maximumAgeSeconds: 86400, status: "ACTIVE", enabled: true, authoritative: true, updatedAt: now },
    { _id: "fx2", fromCurrency: "USD", toCurrency: "MMK", rate: 4380, source: "manual_admin", capturedAt: now, maximumAgeSeconds: 86400, status: "ACTIVE", enabled: true, authoritative: true, updatedAt: now },
    { _id: "fx3", fromCurrency: "THB", toCurrency: "MMK", rate: 129, source: "manual_admin", capturedAt: now, maximumAgeSeconds: 86400, status: "ACTIVE", enabled: true, authoritative: true, updatedAt: now }
];

const originals = {
    productFind: CatalogProduct.find,
    packageFind: CatalogPackage.find,
    policyFind: PricingPolicy.find,
    fxFind: ExchangeRateAuthority.find
};

async function run() {
    let catalogQueries = 0;
    CatalogProduct.find = () => { catalogQueries += 1; throw new Error("CatalogProduct must not be queried"); };
    CatalogPackage.find = () => { catalogQueries += 1; return queryResult([], 10000); };
    PricingPolicy.find = () => queryResult(activePolicies);
    ExchangeRateAuthority.find = () => queryResult(fxRows);
    const service = require("../services/commerce/adminPricingEngineService");
    const startedAt = Date.now();
    const state = await service.getPricingSettingsState();
    const elapsedMs = Date.now() - startedAt;
    assert(elapsedMs < 500, `Settings bootstrap must ignore stalled catalog queries; got ${elapsedMs}ms.`);
    assert.strictEqual(catalogQueries, 0);
    assert.deepStrictEqual(state.policies.map(item => `${item.region}_${item.currency}`), ["TH_THB", "MM_MMK"]);
    assert(state.policies.every(item => item.active.status === "ACTIVE"));
    assert.strictEqual(state.fxAuthorities.length, 3);
    assert(state.fxAuthorities.every(item => item.rate > 0 && item.enabled && item.authoritative && item.capturedAt && item.maximumAgeSeconds > 0));

    PricingPolicy.find = () => queryResult(activePolicies.filter(item => item.region === "TH"));
    await assert.rejects(
        service.getPricingSettingsState(),
        error => error.code === "PRICING_POLICY_CONFIGURATION_MISSING" && error.stage === "SETTINGS_POLICY_VALIDATION"
    );

    PricingPolicy.find = () => queryResult(activePolicies);
    ExchangeRateAuthority.find = () => ({ sort() { return this; }, maxTimeMS() { return this; }, async lean() { throw new Error("database unavailable"); } });
    await assert.rejects(service.getPricingSettingsState(), /database unavailable/);

    const route = fs.readFileSync(path.resolve(__dirname, "../routes/adminPricingEngine.js"), "utf8");
    const frontend = fs.readFileSync(path.resolve(__dirname, "../../frontend/js/admin-pricing-engine.js"), "utf8");
    const serviceSource = fs.readFileSync(path.resolve(__dirname, "../services/commerce/adminPricingEngineService.js"), "utf8");
    assert(route.includes('router.get("/admin/pricing-engine/settings"'));
    assert(route.includes("pricingLifecycle, ...pricingAuth(PERMISSIONS.CATALOG_READ)"));
    assert(route.includes('code: "PRICING_DATA_UNAVAILABLE"') && route.includes('stage: error?.stage || trace?.lastCheckpoint || "unknown"'));
    assert(frontend.includes('pricingFetch("/api/admin/pricing-engine/settings")'));
    assert(frontend.includes("error.stage = body.stage"));
    assert(frontend.includes("error.requestId = body.requestId"));
    const focused = serviceSource.slice(serviceSource.indexOf("async function getPricingSettingsState"), serviceSource.indexOf("async function runPricingEngineDiagnostics"));
    ["CatalogProduct", "CatalogPackage", "PricingWorkspaceDraft", "SupplierProductMapping", "PackageMarketPublication", "fetch("].forEach(dependency => {
        assert(!focused.includes(dependency), `Settings service must not depend on ${dependency}.`);
    });
    assert(serviceSource.includes("async function getPricingConsoleState"), "Legacy full console service must remain available.");
    console.log(JSON.stringify({ result: "PASS", elapsedMs, policies: state.policies.map(item => `${item.region}/${item.currency}`), fxPairs: state.fxAuthorities.map(item => `${item.fromCurrency}_${item.toCurrency}`), catalogQueries, externalFxCalls: 0, writes: 0 }, null, 2));
}

run().catch(error => {
    console.error("Pricing settings bootstrap verifier failed:", error.message);
    process.exitCode = 1;
}).finally(() => {
    CatalogProduct.find = originals.productFind;
    CatalogPackage.find = originals.packageFind;
    PricingPolicy.find = originals.policyFind;
    ExchangeRateAuthority.find = originals.fxFind;
});
