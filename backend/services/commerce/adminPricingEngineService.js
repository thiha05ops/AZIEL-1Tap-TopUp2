"use strict";

const CatalogPackage = require("../../models/CatalogPackage");
const PricingPolicy = require("../../models/PricingPolicy");
const PriceVersion = require("../../models/PriceVersion");

const BRANCH_KEY = "storefront";
const CONFIG_KEYS = Object.freeze([
    { region: "TH", currency: "THB" },
    { region: "MM", currency: "MMK" }
]);

class AdminPricingEngineError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "AdminPricingEngineError";
        this.code = code;
        this.statusCode = statusCode;
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

async function latestVersion() {
    return PriceVersion.findOne({ branchKey: BRANCH_KEY })
        .sort({ versionNumber: -1, createdAt: -1 })
        .lean();
}

async function activePolicy(region, currency) {
    return PricingPolicy.findOne({
        status: "ACTIVE",
        region,
        currency,
        $and: [
            { $or: [{ effectiveFrom: null }, { effectiveFrom: { $exists: false } }, { effectiveFrom: { $lte: new Date() } }] },
            { $or: [{ effectiveUntil: null }, { effectiveUntil: { $exists: false } }, { effectiveUntil: { $gte: new Date() } }] }
        ]
    }).sort({ effectiveFrom: -1, updatedAt: -1, _id: -1 }).lean();
}

async function draftPolicy(region, currency) {
    return PricingPolicy.findOne({ code: draftCode(region, currency), status: "DRAFT" }).lean();
}

function publicPolicy(policy, source, fallbackConfig = null) {
    const config = policy ? configFromPolicy(policy) : (fallbackConfig || neutralPolicyConfig());
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
        config
    };
}

async function affectedSummary() {
    const packages = await CatalogPackage.find({ enabled: true, deletedAt: null })
        .select("_id productCode packageCode prices")
        .lean();
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

async function listProductSamples() {
    const packages = await CatalogPackage.find({ enabled: true, deletedAt: null })
        .sort({ productCode: 1, sortOrder: 1, packageCode: 1 })
        .limit(250)
        .lean();

    const products = new Map();
    packages.forEach(pkg => {
        const productId = text(pkg.productCode).toLowerCase();
        if (!productId) return;
        if (!products.has(productId)) {
            products.set(productId, {
                productId,
                productCode: productId,
                productName: text(pkg.metadata?.gameName || pkg.metadata?.productName || pkg.productCode),
                packages: []
            });
        }
        Object.entries(pkg.prices || {}).forEach(([region, price]) => {
            if (!price || price.enabled === false) return null;
            products.get(productId).packages.push({
                productCode: pkg.productCode,
                productName: text(pkg.metadata?.gameName || pkg.metadata?.productName || pkg.productCode),
                packageId: String(pkg._id),
                packageCode: pkg.packageCode,
                packageName: pkg.name,
                region: upper(region),
                currency: upper(price.currency),
                supplierCurrency: upper(price.currency),
                supplierPrice: number(price.amount),
                exchangeRate: 1
            });
            return null;
        });
    });

    return [...products.values()].filter(product => product.packages.length);
}

async function getPricingConsoleState() {
    const version = await latestVersion();
    const affected = await affectedSummary();
    const products = await listProductSamples();
    const policies = [];

    for (const item of CONFIG_KEYS) {
        const active = await activePolicy(item.region, item.currency);
        const draft = await draftPolicy(item.region, item.currency);
        policies.push({
            region: item.region,
            currency: item.currency,
            active: publicPolicy(active, active ? "active" : "neutral", { ...neutralPolicyConfig(), exchangeRate: item.region === "MM" ? 118 : 1 }),
            draft: publicPolicy(draft, draft ? "draft" : "active-copy", active ? configFromPolicy(active) : { ...neutralPolicyConfig(), exchangeRate: item.region === "MM" ? 118 : 1 })
        });
    }

    return {
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

    const affected = await affectedSummary();
    const packages = await CatalogPackage.find({ enabled: true, deletedAt: null })
        .select("_id packageCode")
        .limit(250)
        .lean();
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
    getPricingConsoleState,
    neutralPolicyConfig,
    publishPricing,
    saveDraftPricing
};
