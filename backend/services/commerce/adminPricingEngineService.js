"use strict";

const mongoose = require("mongoose");
const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const PricingPolicy = require("../../models/PricingPolicy");
const PriceVersion = require("../../models/PriceVersion");
const { resolveSupplierCostSnapshot } = require("./supplierCostService");

const BRANCH_KEY = "storefront";
const QUERY_MAX_TIME_MS = 5000;
const PRODUCT_LIMIT = 250;
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
        exchangeRate: 1,
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
    const metadata = policy?.metadata || {};
    return {
        exchangeRate: number(metadata.exchangeRate, 1),
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
    const normalized = {
        exchangeRate: number(config.exchangeRate, number(fallback.exchangeRate, 1)),
        supplierFee: moneyRule(config.supplierFee, fallback.supplierFee),
        businessCost: moneyRule(config.businessCost, fallback.businessCost),
        gatewayFee: moneyRule(config.gatewayFee, fallback.gatewayFee),
        platformCost: moneyRule(config.platformCost, fallback.platformCost),
        tax: moneyRule(config.tax, fallback.tax),
        profitRule: profitRule(config.profitRule, fallback.profitRule),
        roundingRule: roundingRule(config.roundingRule, fallback.roundingRule)
    };

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
            metadata: {
                pricingConsole: true,
                exchangeRate: normalized.exchangeRate
            }
        }
    };
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

function productsFromPackages(packages = [], productMap = new Map()) {
    const products = new Map();
    productMap.forEach((product, key) => {
        const productId = text(product.productCode || key).toLowerCase();
        if (!productId) return;
        products.set(productId, {
            productId,
            productCode: productId,
            productName: text(product.name || product.displayName || product.productCode),
            enabled: product.enabled !== false,
            supportedRegions: Array.isArray(product.supportedRegions) ? product.supportedRegions.map(upper) : [],
            packages: []
        });
    });
    packages.forEach(pkg => {
        const productId = text(pkg.productCode).toLowerCase();
        if (!productId) return;
        const product = productMap.get(productId) || productMap.get(text(pkg.productCode));
        const productName = text(product?.name || product?.displayName || pkg.metadata?.gameName || pkg.metadata?.productName || pkg.productCode);
        if (!products.has(productId)) {
            products.set(productId, {
                productId,
                productCode: productId,
                productName,
                enabled: product?.enabled !== false,
                supportedRegions: Array.isArray(product?.supportedRegions) ? product.supportedRegions.map(upper) : [],
                packages: []
            });
        }
        Object.entries(pkg.prices || {}).forEach(([region, price]) => {
            if (!price) return null;
            const supplierCost = resolveSupplierCostSnapshot({
                pkg,
                price,
                region,
                currency: price.currency,
                now: new Date()
            });
            products.get(productId).packages.push({
                productCode: pkg.productCode,
                productName,
                packageId: String(pkg._id),
                packageCode: pkg.packageCode,
                packageName: pkg.name,
                packageEnabled: pkg.enabled !== false,
                priceEnabled: price.enabled !== false,
                region: upper(region),
                currency: upper(price.currency),
                supplierCurrency: upper(supplierCost.currency),
                supplierPrice: number(supplierCost.amount),
                supplierName: supplierCost.supplierName,
                supplierVersion: supplierCost.supplierVersion,
                supplierCostTimestamp: supplierCost.costTimestamp,
                supplierCostConfigured: supplierCost.configured === true,
                supplierCostSource: supplierCost.source,
                publishedPrice: number(price.amount),
                publishedPriceMode: upper(price.publishedPriceMode || "LEGACY_COMPATIBILITY_PRICE"),
                manualOverrideReason: text(price.manualOverrideReason),
                updatedAt: pkg.updatedAt || null,
                exchangeRate: 1
            });
            return null;
        });
    });

    return [...products.values()];
}

async function readCatalogPackages(trace = null) {
    serviceTrace(trace, "CATALOG_QUERY_STARTED", {
        modelConnection: CatalogPackage.db?.name || "",
        limit: PRODUCT_LIMIT
    });
    const query = CatalogPackage.find({ deletedAt: null })
        .select("_id productCode packageCode name prices sortOrder metadata updatedAt")
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
        CatalogProduct.find({ deletedAt: null })
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
        .select("name code status region currency defaultSupplierFee defaultBusinessCost defaultPlatformCost defaultGatewayFee defaultTax defaultProfitRule defaultRoundingRule metadata createdAt updatedAt updatedBy effectiveFrom effectiveUntil")
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

async function getPricingConsoleState(options = {}) {
    const trace = options.trace || null;
    const startedAt = Date.now();
    serviceTrace(trace, "STATE_SERVICE_STARTED");
    const [version, catalogPackages, catalogProducts, policyRecords] = await Promise.all([
        latestVersion(trace),
        readCatalogPackages(trace),
        readCatalogProducts(trace),
        readConsolePolicies(new Date(), trace)
    ]);
    serviceTrace(trace, "PRODUCT_GROUPING_STARTED");
    const affected = affectedSummaryFromPackages(catalogPackages);
    const productMap = new Map(catalogProducts.map(product => [text(product.productCode).toLowerCase(), product]));
    const products = productsFromPackages(catalogPackages, productMap);
    serviceTrace(trace, "PRODUCT_GROUPING_COMPLETED", {
        products: products.length,
        packages: catalogPackages.length
    });
    serviceTrace(trace, "RESPONSE_MAPPING_STARTED");
    const policies = [];
    for (const item of CONFIG_KEYS) {
        const active = latestPolicyForKey(policyRecords, "ACTIVE", item.region, item.currency);
        const draft = policyRecords.find(policy => policy.status === "DRAFT" && policy.code === draftCode(item.region, item.currency)) || null;
        policies.push({
            region: item.region,
            currency: item.currency,
            active: publicPolicy(active, active ? "active" : "neutral", { ...neutralPolicyConfig(), exchangeRate: item.region === "MM" ? 118 : 1 }),
            draft: publicPolicy(draft, draft ? "draft" : "active-copy", active ? configFromPolicy(active) : { ...neutralPolicyConfig(), exchangeRate: item.region === "MM" ? 118 : 1 })
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
        policies
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
        const query = CatalogPackage.find({ enabled: true, deletedAt: null })
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
        return { region, currency, config: policyFieldsFromConfig(entry.config || {}).config };
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
                    "metadata.draftSavedAt": new Date().toISOString(),
                    updatedBy: actor
                },
                $setOnInsert: {
                    code: draftCode(entry.region, entry.currency),
                    createdBy: actor
                }
            },
            { new: true, upsert: true, runValidators: true }
        ).lean();
        saved.push(publicPolicy(draft, "draft"));
    }

    return {
        saved,
        state: await getPricingConsoleState()
    };
}

function compactValues(policy) {
    return configFromPolicy(policy);
}

async function publishPricing(admin = {}) {
    const actor = text(admin.username || admin.email || admin.id || "admin");
    const drafts = [];

    for (const item of CONFIG_KEYS) {
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
    saveDraftPricing,
    withBootstrapDeadline
};
