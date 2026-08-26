"use strict";

const mongoose = require("mongoose");
const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const { CANONICAL_OPERATIONAL_PRODUCTS } = require("../../catalog/canonicalOperationalCatalog");
const PricingPolicy = require("../../models/PricingPolicy");
const ExchangeRateAuthority = require("../../models/ExchangeRateAuthority");
const PriceVersion = require("../../models/PriceVersion");
const { resolveSupplierCostSnapshot } = require("./supplierCostService");
const { STOREFRONT_CURRENCY, SUPPLIER_CURRENCY } = require("../../constants/commerce");
const {
    draftRowMap,
    listSupplierCostDraftRows,
    saveSupplierCostDraftRows
} = require("./pricingWorkspaceDraftService");

const BRANCH_KEY = "storefront";
const QUERY_MAX_TIME_MS = 5000;
const PRODUCT_LIMIT = 250;
const CANONICAL_PRICING_PRODUCT_CODES = Object.freeze(CANONICAL_OPERATIONAL_PRODUCTS.map(product => product.productCode));
const PRICING_BOOTSTRAP_DEADLINE_MS = 7500;
const CONFIG_KEYS = Object.freeze([
    { region: "TH", currency: "THB" },
    { region: "MM", currency: "MMK" }
]);

class AdminPricingEngineError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = "AdminPricingEngineError";
        this.code = code;
        this.statusCode = statusCode;
        this.stage = details.stage || "";
    }
}

function text(value) {
    return String(value || "").trim();
}

function upper(value) {
    return text(value).toUpperCase();
}

function number(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function bool(value) {
    return value === true;
}

function moneyRule(input = {}, fallback = {}) {
    const type = upper(input.type || fallback.type || "FIXED");
    return {
        enabled: input.enabled !== undefined ? bool(input.enabled) : bool(fallback.enabled),
        type: type === "PERCENT" ? "PERCENT" : "FIXED",
        value: number(input.value, number(fallback.value))
    };
}

function profitRule(input = {}, fallback = {}) {
    const type = upper(input.type || fallback.type || "PERCENT");
    return {
        type: type === "FIXED" ? "FIXED" : "PERCENT",
        value: number(input.value, number(fallback.value))
    };
}

function roundingRule(input = {}, fallback = {}) {
    const mode = upper(input.mode || fallback.mode || "NONE");
    return {
        enabled: input.enabled !== undefined ? bool(input.enabled) : bool(fallback.enabled),
        mode: ["NONE", "NEAREST", "UP", "DOWN", "PSYCHOLOGICAL"].includes(mode) ? mode : "NONE",
        increment: number(input.increment, number(fallback.increment)),
        psychologicalEnding: number(input.psychologicalEnding, number(fallback.psychologicalEnding))
    };
}

function neutralPolicyConfig() {
    return {
        minimumProfitAmount: 0,
        maximumProfitAmount: null,
        supplierFee: { enabled: false, type: "PERCENT", value: 0 },
        businessCost: { enabled: false, type: "FIXED", value: 0 },
        gatewayFee: { enabled: false, type: "PERCENT", value: 0 },
        platformCost: { enabled: false, type: "FIXED", value: 0 },
        tax: { enabled: false, type: "PERCENT", value: 0 },
        profitRule: { type: "PERCENT", value: 0 },
        roundingRule: { enabled: false, mode: "NONE", increment: 0, psychologicalEnding: 0 }
    };
}

function configFromPolicy(policy = null) {
    return {
        minimumProfitAmount: number(policy?.minimumProfitAmount, 0),
        maximumProfitAmount: policy?.maximumProfitAmount == null ? null : number(policy.maximumProfitAmount),
        supplierFee: moneyRule(policy?.defaultSupplierFee),
        businessCost: moneyRule(policy?.defaultBusinessCost),
        gatewayFee: moneyRule(policy?.defaultGatewayFee),
        platformCost: moneyRule(policy?.defaultPlatformCost),
        tax: moneyRule(policy?.defaultTax),
        profitRule: profitRule(policy?.defaultProfitRule),
        roundingRule: roundingRule(policy?.defaultRoundingRule)
    };
}

function policyFieldsFromConfig(config = {}, fallback = neutralPolicyConfig()) {
    const maximumProfitInput = Object.prototype.hasOwnProperty.call(config, "maximumProfitAmount")
        ? config.maximumProfitAmount
        : fallback.maximumProfitAmount;
    const normalized = {
        minimumProfitAmount: number(config.minimumProfitAmount, number(fallback.minimumProfitAmount, 0)),
        maximumProfitAmount: maximumProfitInput == null || maximumProfitInput === "" ? null : number(maximumProfitInput),
        supplierFee: moneyRule(config.supplierFee, fallback.supplierFee),
        businessCost: moneyRule(config.businessCost, fallback.businessCost),
        gatewayFee: moneyRule(config.gatewayFee, fallback.gatewayFee),
        platformCost: moneyRule(config.platformCost, fallback.platformCost),
        tax: moneyRule(config.tax, fallback.tax),
        profitRule: profitRule(config.profitRule, fallback.profitRule),
        roundingRule: roundingRule(config.roundingRule, fallback.roundingRule)
    };
    if (normalized.maximumProfitAmount != null && normalized.maximumProfitAmount < normalized.minimumProfitAmount) {
        throw new AdminPricingEngineError("PRICING_PROFIT_GUARDRAILS_INVALID", "Maximum profit must be greater than or equal to minimum profit.");
    }

    return {
        config: normalized,
        fields: {
            defaultSupplierFee: normalized.supplierFee,
            defaultBusinessCost: normalized.businessCost,
            defaultGatewayFee: normalized.gatewayFee,
            defaultPlatformCost: normalized.platformCost,
            defaultTax: normalized.tax,
            defaultProfitRule: normalized.profitRule,
            defaultRoundingRule: normalized.roundingRule,
            minimumProfitAmount: normalized.minimumProfitAmount,
            maximumProfitAmount: normalized.maximumProfitAmount,
            metadata: { pricingConsole: true, authorityModel: "REGION_BUSINESS_POLICY" }
        }
    };
}

function publicFxAuthority(row) {
    return {
        id: row?._id ? String(row._id) : "",
        fromCurrency: upper(row?.fromCurrency),
        toCurrency: upper(row?.toCurrency),
        rate: Number(row?.rate),
        source: text(row?.source),
        capturedAt: row?.capturedAt || null,
        maximumAgeSeconds: Number(row?.maximumAgeSeconds || 0),
        status: upper(row?.status),
        enabled: row?.enabled === true,
        authoritative: row?.authoritative === true,
        updatedAt: row?.updatedAt || null
    };
}

async function listFxAuthorities() {
    const rows = await ExchangeRateAuthority.find({ status: "ACTIVE" })
        .sort({ fromCurrency: 1, toCurrency: 1, effectiveFrom: -1, updatedAt: -1 })
        .lean();
    const seen = new Set();
    return rows.filter(row => {
        const key = `${row.fromCurrency}_${row.toCurrency}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).map(publicFxAuthority);
}

async function saveFxAuthorities(entries = [], admin = {}) {
    if (!Array.isArray(entries) || !entries.length) return listFxAuthorities();
    const actor = text(admin.username || admin.email || admin.id || "admin");
    const now = new Date();
    for (const entry of entries) {
        const fromCurrency = upper(entry.fromCurrency);
        const toCurrency = upper(entry.toCurrency);
        if (!SUPPLIER_CURRENCY.includes(fromCurrency) || !STOREFRONT_CURRENCY.includes(toCurrency) || fromCurrency === toCurrency) {
            throw new AdminPricingEngineError("FX_PAIR_UNSUPPORTED", `Unsupported FX authority pair ${fromCurrency}_${toCurrency}.`);
        }
        const rate = Number(entry.rate);
        const capturedAt = new Date(entry.capturedAt || "");
        const maximumAgeSeconds = Number(entry.maximumAgeSeconds);
        if (!Number.isFinite(rate) || rate <= 0 || !text(entry.source) || !Number.isFinite(capturedAt.getTime()) || !Number.isFinite(maximumAgeSeconds) || maximumAgeSeconds < 60) {
            throw new AdminPricingEngineError("FX_AUTHORITY_INVALID", `${fromCurrency}_${toCurrency} requires a positive rate, source, captured-at timestamp, and maximum age of at least 60 seconds.`);
        }
        await ExchangeRateAuthority.updateMany({ fromCurrency, toCurrency, status: "ACTIVE" }, {
            $set: { status: "INACTIVE", effectiveUntil: now, updatedBy: actor }
        });
        await ExchangeRateAuthority.create({
            code: `AZIEL_FX_${fromCurrency}_${toCurrency}_${now.getTime()}`,
            fromCurrency,
            toCurrency,
            rate,
            source: text(entry.source),
            capturedAt,
            maximumAgeSeconds,
            status: "ACTIVE",
            authoritative: true,
            enabled: true,
            effectiveFrom: now,
            metadata: { authorityModel: "CURRENCY_PAIR", adminManaged: true },
            createdBy: actor,
            updatedBy: actor
        });
    }
    return listFxAuthorities();
}

function draftCode(region, currency) {
    return `AZIEL_PRICING_DRAFT_${upper(region)}_${upper(currency)}`;
}

function activeCode(region, currency, versionNumber) {
    return `AZIEL_PRICING_${upper(region)}_${upper(currency)}_V${versionNumber}`;
}

function policyName(region, currency, status = "Draft") {
    return `AZIEL ${region}/${currency} ${status} Pricing`;
}

function boundedQuery(query) {
    return typeof query?.maxTimeMS === "function" ? query.maxTimeMS(QUERY_MAX_TIME_MS) : query;
}

function serviceTrace(trace, checkpoint, metadata = {}) {
    if (trace && typeof trace.log === "function") trace.log(checkpoint, metadata);
}

function plainJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function withBootstrapDeadline(promise, trace = null, timeoutMs = PRICING_BOOTSTRAP_DEADLINE_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const stage = trace?.lastCheckpoint || "unknown";
            const error = new AdminPricingEngineError(
                "PRICING_WORKSPACE_BOOTSTRAP_TIMEOUT",
                "Pricing workspace data could not be loaded in time.",
                503,
                { stage }
            );
            reject(error);
        }, timeoutMs);

        Promise.resolve(promise)
            .then(value => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch(error => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

async function latestVersion(trace = null) {
    serviceTrace(trace, "VERSION_QUERY_STARTED", {
        modelConnection: PriceVersion.db?.name || ""
    });
    const query = PriceVersion.findOne({ branchKey: BRANCH_KEY })
        .select("versionId versionNumber status publishedAt publishedBy createdAt metadata")
        .sort({ versionNumber: -1, createdAt: -1 });
    const version = await boundedQuery(query).lean();
    serviceTrace(trace, "VERSION_QUERY_COMPLETED", {
        count: version ? 1 : 0
    });
    return version;
}

async function activePolicy(region, currency) {
    const query = PricingPolicy.findOne({
        status: "ACTIVE",
        region,
        currency,
        $and: [
            { $or: [{ effectiveFrom: null }, { effectiveFrom: { $exists: false } }, { effectiveFrom: { $lte: new Date() } }] },
            { $or: [{ effectiveUntil: null }, { effectiveUntil: { $exists: false } }, { effectiveUntil: { $gte: new Date() } }] }
        ]
    }).sort({ effectiveFrom: -1, updatedAt: -1, _id: -1 });
    return boundedQuery(query).lean();
}

async function draftPolicy(region, currency) {
    const query = PricingPolicy.findOne({ code: draftCode(region, currency), status: "DRAFT" });
    return boundedQuery(query).lean();
}

function publicPolicy(policy, source, fallbackConfig = null) {
    const config = policy ? configFromPolicy(policy) : (fallbackConfig || neutralPolicyConfig());
    const inheritedSource = policy ? "Region" : "Global";
    return {
        id: policy?._id ? String(policy._id) : "",
        source,
        region: policy?.region || "",
        currency: policy?.currency || "",
        status: policy?.status || "",
        code: policy?.code || "",
        updatedAt: policy?.updatedAt || null,
        createdAt: policy?.createdAt || null,
        updatedBy: policy?.updatedBy || "",
        scope: policy ? "REGION" : "GLOBAL",
        hierarchy: ["Global", "Region", "Product", "Package"],
        valueSources: Object.fromEntries(Object.keys(config).map(key => [key, inheritedSource])),
        config
    };
}

function affectedSummaryFromPackages(packages = []) {
    const products = new Set();
    const currencies = new Set();
    let packageCount = 0;
    packages.forEach(pkg => {
        products.add(pkg.productCode);
        packageCount += 1;
        Object.values(pkg.prices || {}).forEach(price => {
            if (price?.enabled !== false && price?.currency) currencies.add(upper(price.currency));
        });
    });
    return {
        productsAffected: products.size,
        packagesAffected: packageCount,
        currenciesAffected: [...currencies].sort(),
        futureQuotesAffected: packageCount
    };
}

function productsFromPackages(packages = [], productMap = new Map(), supplierCostDraftRows = []) {
    const products = new Map();
    const savedDraftMap = draftRowMap(supplierCostDraftRows);
    CANONICAL_OPERATIONAL_PRODUCTS.forEach(canonical => {
        const productId = canonical.productCode;
        const product = productMap.get(productId) || {};
        products.set(productId, {
            productId,
            productCode: productId,
            productName: canonical.name,
            family: canonical.family || "",
            category: canonical.adminCategory || canonical.catalogCategory || canonical.category || "",
            enabled: true,
            catalogEnabled: product.productCode ? product.enabled !== false : null,
            supportedRegions: Array.isArray(product.supportedRegions) && product.supportedRegions.length
                ? product.supportedRegions.map(upper)
                : canonical.supportedRegions.map(upper),
            packages: []
        });
    });
    packages.forEach(pkg => {
        const productId = text(pkg.productCode).toLowerCase();
        if (!products.has(productId)) return;
        const product = productMap.get(productId) || productMap.get(text(pkg.productCode));
        const productName = text(product?.name || product?.displayName || pkg.metadata?.gameName || pkg.metadata?.productName || pkg.productCode);
        Object.entries(pkg.prices || {}).forEach(([region, price]) => {
            if (!price) return null;
            const normalizedRegion = upper(region);
            const supplierCost = resolveSupplierCostSnapshot({
                pkg,
                price,
                region,
                currency: price.currency,
                now: new Date()
            });
            const supplierCostConfigured = supplierCost.configured === true;
            const canonicalSupplierCost = pkg.canonicalSupplierCost || {};
            const canonicalSupplierCostConfigured = canonicalSupplierCost.amount != null && SUPPLIER_CURRENCY.includes(upper(canonicalSupplierCost.currency));
            const savedDraft = savedDraftMap.get(`${productId}:${upper(pkg.packageCode)}`) || null;
            const savedDraftConfigured = savedDraft?.stagedSupplierCost != null;
            const effectiveSupplierCostConfigured = savedDraftConfigured || canonicalSupplierCostConfigured || supplierCostConfigured;
            const effectiveSupplierPrice = savedDraftConfigured
                ? number(savedDraft.stagedSupplierCost)
                : canonicalSupplierCostConfigured ? number(canonicalSupplierCost.amount) : supplierCostConfigured ? number(supplierCost.amount) : null;
            const effectiveSupplierCurrency = savedDraftConfigured
                ? upper(savedDraft.supplierCurrency)
                : canonicalSupplierCostConfigured ? upper(canonicalSupplierCost.currency) : supplierCostConfigured ? upper(supplierCost.currency) : upper(price.supplierCurrency || price.currency);
            const effectiveSupplierName = savedDraftConfigured
                ? text(savedDraft.supplierName || supplierCost.supplierName)
                : canonicalSupplierCostConfigured ? text(canonicalSupplierCost.supplierName) : supplierCost.supplierName;
            const effectiveSupplierVersion = savedDraftConfigured
                ? text(savedDraft.supplierVersion || supplierCost.supplierVersion)
                : supplierCost.supplierVersion;
            products.get(productId).packages.push({
                productCode: pkg.productCode,
                productName,
                packageId: String(pkg._id),
                packageCode: pkg.packageCode,
                packageName: pkg.name,
                packageEnabled: pkg.enabled !== false,
                priceEnabled: price.enabled !== false,
                region: normalizedRegion,
                currency: upper(price.currency),
                supplierCurrency: effectiveSupplierCurrency,
                supplierPrice: effectiveSupplierPrice,
                supplierName: effectiveSupplierName,
                supplierId: savedDraftConfigured ? text(savedDraft.supplierId) : text(price.supplierId),
                supplierCode: savedDraftConfigured ? text(savedDraft.supplierCode) : text(price.supplierCode),
                supplierVersion: effectiveSupplierVersion,
                supplierCostTimestamp: savedDraftConfigured ? savedDraft.updatedAt : supplierCost.costTimestamp,
                supplierCostConfigured: effectiveSupplierCostConfigured,
                supplierCostSource: savedDraftConfigured ? "saved_draft" : (canonicalSupplierCostConfigured || supplierCostConfigured) ? "published" : "legacy_compatibility",
                supplierCostSources: {
                    effective: savedDraftConfigured ? "saved_draft" : (canonicalSupplierCostConfigured || supplierCostConfigured) ? "published" : "legacy_compatibility",
                    published: (canonicalSupplierCostConfigured || supplierCostConfigured) ? "published" : "legacy_compatibility",
                    savedDraft: savedDraftConfigured ? "saved_draft" : "",
                    unsavedStage: "unsaved_stage"
                },
                publishedSupplierPrice: canonicalSupplierCostConfigured ? number(canonicalSupplierCost.amount) : supplierCostConfigured ? number(supplierCost.amount) : null,
                publishedSupplierCurrency: canonicalSupplierCostConfigured ? upper(canonicalSupplierCost.currency) : supplierCostConfigured ? upper(supplierCost.currency) : upper(price.supplierCurrency || price.currency),
                publishedSupplierName: canonicalSupplierCostConfigured ? text(canonicalSupplierCost.supplierName) : supplierCost.supplierName,
                publishedSupplierId: canonicalSupplierCostConfigured ? text(canonicalSupplierCost.supplierId) : text(price.supplierId),
                publishedSupplierCode: canonicalSupplierCostConfigured ? text(canonicalSupplierCost.supplierCode) : text(price.supplierCode),
                publishedSupplierVersion: supplierCost.supplierVersion,
                publishedSupplierCostTimestamp: canonicalSupplierCostConfigured ? canonicalSupplierCost.capturedAt : supplierCost.costTimestamp,
                publishedSupplierCostConfigured: canonicalSupplierCostConfigured || supplierCostConfigured,
                publishedSupplierCostSource: (canonicalSupplierCostConfigured || supplierCostConfigured) ? "published" : "legacy_compatibility",
                savedDraftSupplierCost: savedDraftConfigured ? number(savedDraft.stagedSupplierCost) : null,
                savedDraftSupplierId: savedDraftConfigured ? text(savedDraft.supplierId) : "",
                savedDraftSupplierCode: savedDraftConfigured ? text(savedDraft.supplierCode) : "",
                savedDraftSupplierCurrency: savedDraftConfigured ? upper(savedDraft.supplierCurrency) : "",
                savedDraftSupplierName: savedDraftConfigured ? text(savedDraft.supplierName) : "",
                savedDraftSupplierVersion: savedDraftConfigured ? text(savedDraft.supplierVersion) : "",
                savedDraftSupplierCostConfigured: savedDraftConfigured,
                savedDraftSupplierCostTimestamp: savedDraft?.updatedAt || null,
                savedDraftId: savedDraft?.draftId || "",
                savedDraftVersion: savedDraft?.version || null,
                publishedPrice: number(price.amount),
                publishedPriceMode: upper(price.publishedPriceMode || "LEGACY_COMPATIBILITY_PRICE"),
                manualOverrideReason: text(price.manualOverrideReason),
                updatedAt: pkg.updatedAt || null,
                exchangeRate: 1
            });
            return null;
        });
    });

    return [...products.values()].map(product => ({
        ...product,
        packageCount: new Set(product.packages.map(pkg => upper(pkg.packageCode))).size
    }));
}

async function readCatalogPackages(trace = null) {
    serviceTrace(trace, "CATALOG_QUERY_STARTED", {
        modelConnection: CatalogPackage.db?.name || "",
        limit: PRODUCT_LIMIT
    });
    const query = CatalogPackage.find({ productCode: { $in: CANONICAL_PRICING_PRODUCT_CODES }, deletedAt: null })
        .select("_id productCode packageCode name prices canonicalSupplierCost sortOrder metadata updatedAt")
        .sort({ productCode: 1, sortOrder: 1, packageCode: 1 })
        .limit(PRODUCT_LIMIT);
    const packages = await boundedQuery(query).lean();
    serviceTrace(trace, "CATALOG_QUERY_COMPLETED", {
        count: packages.length
    });
    return packages;
}

async function readCatalogProducts(trace = null) {
    serviceTrace(trace, "CATALOG_PRODUCT_QUERY_STARTED", {
        modelConnection: CatalogProduct.db?.name || "",
        limit: PRODUCT_LIMIT
    });
    const products = await boundedQuery(
        CatalogProduct.find({ productCode: { $in: CANONICAL_PRICING_PRODUCT_CODES }, deletedAt: null })
            .select("productCode name displayName supportedRegions enabled")
            .sort({ productCode: 1 })
            .limit(PRODUCT_LIMIT)
    ).lean();
    serviceTrace(trace, "CATALOG_PRODUCT_QUERY_COMPLETED", {
        count: products.length
    });
    return products;
}

async function readConsolePolicies(now = new Date(), trace = null) {
    const draftCodes = CONFIG_KEYS.map(item => draftCode(item.region, item.currency));
    serviceTrace(trace, "ACTIVE_POLICY_QUERY_STARTED", {
        modelConnection: PricingPolicy.db?.name || ""
    });
    serviceTrace(trace, "DRAFT_POLICY_QUERY_STARTED", {
        modelConnection: PricingPolicy.db?.name || ""
    });
    const query = PricingPolicy.find({
        $or: [
            {
                status: "ACTIVE",
                region: { $in: CONFIG_KEYS.map(item => item.region) },
                currency: { $in: CONFIG_KEYS.map(item => item.currency) },
                $and: [
                    { $or: [{ effectiveFrom: null }, { effectiveFrom: { $exists: false } }, { effectiveFrom: { $lte: now } }] },
                    { $or: [{ effectiveUntil: null }, { effectiveUntil: { $exists: false } }, { effectiveUntil: { $gte: now } }] }
                ]
            },
            {
                status: "DRAFT",
                code: { $in: draftCodes }
            }
        ]
    })
        .select("name code status region currency defaultSupplierFee defaultBusinessCost defaultPlatformCost defaultGatewayFee defaultTax defaultProfitRule defaultRoundingRule minimumProfitAmount maximumProfitAmount minimumProfitMarginPercent allowBelowMarginOverride metadata createdAt updatedAt updatedBy effectiveFrom effectiveUntil")
        .sort({ status: 1, effectiveFrom: -1, updatedAt: -1, _id: -1 });
    const policies = await boundedQuery(query).lean();
    serviceTrace(trace, "ACTIVE_POLICY_QUERY_COMPLETED", {
        count: policies.filter(policy => policy.status === "ACTIVE").length
    });
    serviceTrace(trace, "DRAFT_POLICY_QUERY_COMPLETED", {
        count: policies.filter(policy => policy.status === "DRAFT").length
    });
    return policies;
}

function latestPolicyForKey(policies = [], status, region, currency) {
    return policies.find(policy => policy.status === status && policy.region === region && policy.currency === currency) || null;
}
function visibleDraftPolicy(policies = [], region, currency) {
    return policies.find(policy => policy.status === "DRAFT" && policy.code === draftCode(region, currency) && policy.metadata?.pendingOwnerReview === true) || null;
}

async function getPricingConsoleState(options = {}) {
    const trace = options.trace || null;
    const startedAt = Date.now();
    serviceTrace(trace, "STATE_SERVICE_STARTED");
    const [version, catalogPackages, catalogProducts, policyRecords, supplierCostDraftRows, fxAuthorities] = await Promise.all([
        latestVersion(trace),
        readCatalogPackages(trace),
        readCatalogProducts(trace),
        readConsolePolicies(new Date(), trace),
        listSupplierCostDraftRows(),
        listFxAuthorities()
    ]);
    serviceTrace(trace, "PRODUCT_GROUPING_STARTED");
    const affected = affectedSummaryFromPackages(catalogPackages);
    const productMap = new Map(catalogProducts.map(product => [text(product.productCode).toLowerCase(), product]));
    const products = productsFromPackages(catalogPackages, productMap, supplierCostDraftRows);
    serviceTrace(trace, "PRODUCT_GROUPING_COMPLETED", {
            products: products.length,
            packages: catalogPackages.length,
            supplierCostDraftRows: supplierCostDraftRows.length
    });
    serviceTrace(trace, "RESPONSE_MAPPING_STARTED");
    const policies = [];
    for (const item of CONFIG_KEYS) {
        const active = latestPolicyForKey(policyRecords, "ACTIVE", item.region, item.currency);
        const draft = visibleDraftPolicy(policyRecords, item.region, item.currency);
        policies.push({
            region: item.region,
            currency: item.currency,
            active: publicPolicy(active, active ? "active" : "neutral", neutralPolicyConfig()),
            draft: publicPolicy(draft, draft ? "draft" : "active-copy", active ? configFromPolicy(active) : neutralPolicyConfig())
        });
    }
    serviceTrace(trace, "RESPONSE_MAPPING_COMPLETED", {
        policies: policies.length
    });
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > 2000 || process.env.AZIEL_PRICING_ENGINE_TIMING === "true") {
        console.log("[PRICING_ENGINE] console state loaded", {
            elapsedMs,
            products: products.length,
            packages: catalogPackages.length,
            policies: policyRecords.length,
            version: version?.versionNumber || null
        });
    }

    return plainJson({
        branchKey: BRANCH_KEY,
        status: version ? "Production Active" : "Production Ready",
        version: version ? {
            versionId: version.versionId,
            versionNumber: version.versionNumber,
            status: version.status,
            publishedAt: version.publishedAt,
            publishedBy: version.publishedBy,
            createdAt: version.createdAt,
            draftId: version.metadata?.draftId || ""
        } : null,
        affected,
        products,
        policies,
        fxAuthorities
    });
}

async function runPricingEngineDiagnostics(trace = null) {
    const startedAt = Date.now();
    const step = async (name, fn) => {
        const stepStartedAt = Date.now();
        try {
            const result = await fn();
            return {
                name,
                ok: true,
                elapsedMs: Date.now() - stepStartedAt,
                ...result
            };
        } catch (error) {
            serviceTrace(trace, "REQUEST_ERROR", {
                diagnostic: name,
                errorName: error?.name || "Error",
                errorCode: error?.code || "",
                errorMessage: error?.message || ""
            });
            return {
                name,
                ok: false,
                elapsedMs: Date.now() - stepStartedAt,
                errorName: error?.name || "Error",
                errorCode: error?.code || "",
                errorMessage: error?.message || ""
            };
        }
    };

    const checks = [];
    checks.push(await step("mongoReadyState", async () => ({
        readyState: mongoose.connection.readyState,
        connectionName: mongoose.connection.name || "",
        modelConnections: {
            PricingPolicy: PricingPolicy.db?.name || "",
            PriceVersion: PriceVersion.db?.name || "",
            CatalogPackage: CatalogPackage.db?.name || ""
        }
    })));
    checks.push(await step("pricingPolicyQuery", async () => {
        const query = PricingPolicy.find({})
            .select("_id code status region currency")
            .limit(1);
        const rows = await boundedQuery(query).lean();
        return { count: rows.length };
    }));
    checks.push(await step("priceVersionQuery", async () => {
        const row = await latestVersion(trace);
        return { count: row ? 1 : 0 };
    }));
    checks.push(await step("catalogPackageQuery", async () => {
        const query = CatalogPackage.find({ productCode: { $in: CANONICAL_PRICING_PRODUCT_CODES }, enabled: true, deletedAt: null })
            .select("_id productCode packageCode prices")
            .limit(1);
        const rows = await boundedQuery(query).lean();
        return { count: rows.length };
    }));

    return {
        totalElapsedMs: Date.now() - startedAt,
        checks
    };
}

function normalizeDraftPayload(payload = {}) {
    const entries = Array.isArray(payload.policies) ? payload.policies : [];
    if (!entries.length) {
        throw new AdminPricingEngineError("PRICING_DRAFT_EMPTY", "At least one pricing policy draft is required.");
    }
    return entries.map(entry => {
        const region = upper(entry.region);
        const currency = upper(entry.currency);
        const supported = CONFIG_KEYS.some(item => item.region === region && item.currency === currency);
        if (!supported) {
            throw new AdminPricingEngineError("PRICING_CONTEXT_UNSUPPORTED", "Unsupported pricing region or currency.");
        }
        return { region, currency, config: entry.config && typeof entry.config === "object" ? entry.config : {} };
    });
}

async function saveDraftPricing(payload = {}, admin = {}) {
    const entries = normalizeDraftPayload(payload);
    const actor = text(admin.username || admin.email || admin.id || "admin");
    const saved = [];

    for (const entry of entries) {
        const currentActive = await activePolicy(entry.region, entry.currency);
        const fallback = currentActive ? configFromPolicy(currentActive) : neutralPolicyConfig();
        const { fields } = policyFieldsFromConfig(entry.config, fallback);
        fields.metadata = {
            ...(fields.metadata || {}),
            draftSavedAt: new Date().toISOString(),
            pendingOwnerReview: true
        };
        const draft = await PricingPolicy.findOneAndUpdate(
            { code: draftCode(entry.region, entry.currency) },
            {
                $set: {
                    name: policyName(entry.region, entry.currency, "Draft"),
                    description: "Draft pricing configuration managed from Admin Pricing Engine.",
                    status: "DRAFT",
                    region: entry.region,
                    currency: entry.currency,
                    effectiveFrom: null,
                    effectiveUntil: null,
                    ...fields,
                    updatedBy: actor
                },
                $setOnInsert: {
                    code: draftCode(entry.region, entry.currency),
                    createdBy: actor
                }
            },
            { returnDocument: "after", upsert: true, runValidators: true }
        ).lean();
        saved.push(publicPolicy(draft, "draft"));
    }

    const workspaceDraft = await saveSupplierCostDraftRows({
        rows: payload.workspaceRows || payload.supplierCostRows || [],
        region: "ALL",
        supplierId: payload.supplierId || "",
        admin
    });

    return {
        saved,
        workspaceDraft,
        state: await getPricingConsoleState()
    };
}

function compactValues(policy) {
    return configFromPolicy(policy);
}

async function publishPricing(admin = {}, options = {}) {
    const actor = text(admin.username || admin.email || admin.id || "admin");
    const drafts = [];

    const requestedRegions = new Set((Array.isArray(options.regions) ? options.regions : []).map(upper).filter(Boolean));
    for (const item of CONFIG_KEYS) {
        if (requestedRegions.size && !requestedRegions.has(item.region)) continue;
        const draft = await draftPolicy(item.region, item.currency);
        if (draft) drafts.push(draft);
    }

    if (!drafts.length) {
        throw new AdminPricingEngineError("PRICING_DRAFT_REQUIRED", "Save a draft before publishing.");
    }

    const previousVersion = await latestVersion();
    const versionNumber = Number(previousVersion?.versionNumber || 0) + 1;
    const now = new Date();
    const oldValues = [];
    const newValues = [];
    const policyIds = [];

    for (const draft of drafts) {
        const oldActive = await activePolicy(draft.region, draft.currency);
        if (oldActive) {
            oldValues.push({ region: draft.region, currency: draft.currency, config: compactValues(oldActive) });
            await PricingPolicy.updateOne({ _id: oldActive._id }, {
                $set: {
                    status: "INACTIVE",
                    effectiveUntil: now,
                    updatedBy: actor
                }
            });
        }

        const active = await PricingPolicy.create({
            name: policyName(draft.region, draft.currency, `v${versionNumber}`),
            code: activeCode(draft.region, draft.currency, versionNumber),
            description: "Published production pricing configuration.",
            status: "ACTIVE",
            region: draft.region,
            currency: draft.currency,
            effectiveFrom: now,
            effectiveUntil: null,
            defaultSupplierFee: draft.defaultSupplierFee,
            defaultBusinessCost: draft.defaultBusinessCost,
            defaultGatewayFee: draft.defaultGatewayFee,
            defaultPlatformCost: draft.defaultPlatformCost,
            defaultTax: draft.defaultTax,
            defaultProfitRule: draft.defaultProfitRule,
            defaultRoundingRule: draft.defaultRoundingRule,
            minimumProfitAmount: draft.minimumProfitAmount,
            maximumProfitAmount: draft.maximumProfitAmount == null ? null : draft.maximumProfitAmount,
            minimumProfitMarginPercent: draft.minimumProfitMarginPercent,
            metadata: {
                ...(draft.metadata || {}),
                pricingConsole: true,
                publishedFromDraftId: String(draft._id),
                pricingVersionNumber: versionNumber
            },
            createdBy: actor,
            updatedBy: actor
        });
        policyIds.push(active._id);
        newValues.push({ region: draft.region, currency: draft.currency, config: compactValues(active) });
        await PricingPolicy.updateOne({ _id: draft._id }, {
            $set: {
                status: "INACTIVE",
                "metadata.pendingOwnerReview": false,
                "metadata.publishedAt": now.toISOString(),
                updatedBy: actor
            }
        });
    }

    if (requestedRegions.size) {
        for (const item of CONFIG_KEYS) {
            if (requestedRegions.has(item.region)) continue;
            const unchangedActive = await activePolicy(item.region, item.currency);
            if (unchangedActive?._id && !policyIds.some(id => String(id) === String(unchangedActive._id))) policyIds.push(unchangedActive._id);
        }
    }

    if (previousVersion?._id && previousVersion.status === "PUBLISHED") {
        await PriceVersion.updateOne({ _id: previousVersion._id }, { $set: { status: "SUPERSEDED", supersededAt: now, updatedBy: actor } });
    }

    const packages = await readCatalogPackages();
    const affected = affectedSummaryFromPackages(packages);
    const version = await PriceVersion.create({
        versionNumber,
        branchKey: BRANCH_KEY,
        name: `Production Pricing v${versionNumber}`,
        description: "Published from Admin Pricing Engine.",
        status: "PUBLISHED",
        pricingPolicyId: policyIds[0] || null,
        parentVersionId: previousVersion?._id || null,
        changeSummary: "Production pricing configuration published.",
        affectedPackages: packages.map(pkg => ({
            packageId: text(pkg.packageCode || pkg._id).toUpperCase(),
            packageCode: text(pkg.packageCode).toUpperCase(),
            packageRef: pkg._id
        })),
        validationSummary: {
            valid: true,
            errorCount: 0,
            warningCount: 0,
            checkedAt: now
        },
        approvedBy: actor,
        approvedAt: now,
        publishedBy: actor,
        publishedAt: now,
        metadata: {
            pricingConsole: true,
            draftId: drafts.map(draft => String(draft._id)).join(","),
            policyIds: policyIds.map(id => String(id)),
            affected
        },
        createdBy: actor,
        updatedBy: actor
    });

    return {
        version,
        oldValues,
        newValues,
        state: await getPricingConsoleState()
    };
}

module.exports = {
    AdminPricingEngineError,
    BRANCH_KEY,
    PRICING_BOOTSTRAP_DEADLINE_MS,
    QUERY_MAX_TIME_MS,
    getPricingConsoleState,
    neutralPolicyConfig,
    publishPricing,
    runPricingEngineDiagnostics,
    saveFxAuthorities,
    saveDraftPricing,
    withBootstrapDeadline
    ,_pricingPolicyPersistenceContract: Object.freeze({ configFromPolicy, policyFieldsFromConfig, visibleDraftPolicy })
};
