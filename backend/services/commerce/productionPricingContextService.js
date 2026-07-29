"use strict";

const PricingPolicy = require("../../models/PricingPolicy");
const PricingRule = require("../../models/PricingRule");
const PriceVersion = require("../../models/PriceVersion");
const { resolveExchangeRate } = require("./exchangeRateService");
const { resolveSupplierCostSnapshot } = require("./supplierCostService");

const DEFAULT_BRANCH = "storefront";

function text(value) {
    return String(value || "").trim();
}

function upper(value) {
    return text(value).toUpperCase();
}

function amount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function plain(value) {
    if (!value) return null;
    return typeof value.toObject === "function"
        ? value.toObject({ depopulate: true, flattenMaps: true, versionKey: false })
        : structuredClone(value);
}

function activeWindowQuery(now = new Date()) {
    return {
        $and: [
            { $or: [{ effectiveFrom: null }, { effectiveFrom: { $exists: false } }, { effectiveFrom: { $lte: now } }] },
            { $or: [{ effectiveUntil: null }, { effectiveUntil: { $exists: false } }, { effectiveUntil: { $gte: now } }] }
        ]
    };
}

function neutralPolicy() {
    return {
        supplierFee: { enabled: false, type: "FIXED", value: 0 },
        businessCost: { enabled: false, type: "FIXED", value: 0 },
        profitRule: { enabled: true, type: "FIXED", value: 0 },
        gatewayFee: { enabled: false, type: "FIXED", value: 0 },
        platformCost: { enabled: false, type: "FIXED", value: 0 },
        tax: { enabled: false, type: "FIXED", value: 0 },
        roundingRule: { enabled: false, mode: "NONE", increment: 0, psychologicalEnding: 0 }
    };
}

function policyFromRecord(policy) {
    if (!policy) return neutralPolicy();
    return {
        supplierFee: policy.defaultSupplierFee || { enabled: false, type: "FIXED", value: 0 },
        businessCost: policy.defaultBusinessCost || { enabled: false, type: "FIXED", value: 0 },
        profitRule: policy.defaultProfitRule || { enabled: true, type: "FIXED", value: 0 },
        gatewayFee: policy.defaultGatewayFee || { enabled: false, type: "FIXED", value: 0 },
        platformCost: policy.defaultPlatformCost || { enabled: false, type: "FIXED", value: 0 },
        tax: policy.defaultTax || { enabled: false, type: "FIXED", value: 0 },
        roundingRule: policy.defaultRoundingRule || { enabled: false, mode: "NONE", increment: 0, psychologicalEnding: 0 }
    };
}

function ruleSnapshot(rule) {
    return {
        id: text(rule._id || rule.id),
        code: upper(rule.code),
        ruleType: upper(rule.ruleType),
        value: amount(rule.value),
        priority: Number(rule.priority || 0),
        scopeType: upper(rule.scopeType || "GLOBAL"),
        scopeReference: text(rule.scopeReference),
        stopFurtherProcessing: rule.stopFurtherProcessing === true,
        effectiveFrom: rule.effectiveFrom || null,
        effectiveUntil: rule.effectiveUntil || null,
        configuration: rule.configuration && typeof rule.configuration === "object" ? structuredClone(rule.configuration) : {}
    };
}

function packageContextFromCatalog(pkg = {}, catalog = {}) {
    const packageId = text(pkg._id || catalog.packageId);
    const productCode = text(catalog.productCode || pkg.productCode).toLowerCase();
    return {
        packageId,
        packageRef: packageId,
        packageCode: upper(catalog.packageCode || pkg.packageCode),
        packageName: text(pkg.name || catalog.packageName),
        gameId: productCode,
        gameCode: productCode,
        gameName: text(pkg.metadata?.gameName || catalog.productName || catalog.game || productCode),
        categoryId: text(pkg.metadata?.categoryId || "game"),
        categoryCode: text(pkg.metadata?.categoryCode || "game")
    };
}

async function loadActivePolicy({ region, currency, now = new Date() } = {}) {
    return plain(await PricingPolicy.findOne({
        status: "ACTIVE",
        region: upper(region),
        currency: upper(currency),
        ...activeWindowQuery(now)
    }).sort({ effectiveFrom: -1, updatedAt: -1, _id: -1 }).lean());
}

async function loadPublishedVersion({ policy, pkg, region, now = new Date() } = {}) {
    const packageId = text(pkg?._id);
    const packageCode = upper(pkg?.packageCode);
    const query = {
        status: "PUBLISHED",
        branchKey: DEFAULT_BRANCH
    };
    if (policy?._id) {
        query.$or = [
            { pricingPolicyId: policy._id },
            { pricingPolicyId: null },
            { "metadata.policyIds": String(policy._id) }
        ];
    }

    const candidates = await PriceVersion.find(query).sort({ publishedAt: -1, versionNumber: -1, updatedAt: -1 }).limit(20).lean();
    return plain(candidates.find(version => {
        const affected = Array.isArray(version.affectedPackages) ? version.affectedPackages : [];
        if (!affected.length) return true;
        return affected.some(item => (
            text(item.packageRef) === packageId ||
            upper(item.packageId) === packageCode ||
            upper(item.packageCode) === packageCode
        ));
    }) || candidates[0] || {
        versionId: `catalog:${text(pkg?.productCode).toLowerCase()}:${packageCode}:${upper(region)}`,
        versionNumber: 1,
        branchKey: DEFAULT_BRANCH
    });
}

async function loadActiveRules({ policy, packageContext, region, currency, now = new Date() } = {}) {
    if (!policy?._id) return [];
    const scopeRefs = [
        "",
        upper(region),
        packageContext.gameId,
        packageContext.gameCode,
        packageContext.categoryId,
        packageContext.categoryCode,
        packageContext.packageId,
        packageContext.packageRef,
        packageContext.packageCode
    ].filter(Boolean);

    const rules = await PricingRule.find({
        policyId: policy._id,
        status: "ACTIVE",
        $and: [
            { $or: [{ region: upper(region) }, { region: null }, { region: { $exists: false } }] },
            { $or: [{ currency: upper(currency) }, { currency: null }, { currency: { $exists: false } }] },
            {
                $or: [
                    { scopeType: "GLOBAL" },
                    { scopeReference: { $in: scopeRefs } },
                    { scopeReference: "" },
                    { scopeReference: { $exists: false } }
                ]
            },
            ...activeWindowQuery(now).$and
        ]
    }).sort({ priority: -1, updatedAt: -1, code: 1 }).lean();

    return rules.map(ruleSnapshot);
}

async function buildProductionPricingContext({ pkg, price, catalog = {}, region, currency, now = new Date() } = {}) {
    const normalizedRegion = upper(region);
    const normalizedCurrency = upper(currency);
    const packageContext = packageContextFromCatalog(pkg, catalog);
    const supplierCost = resolveSupplierCostSnapshot({
        pkg,
        price,
        region: normalizedRegion,
        currency: normalizedCurrency,
        now
    });
    const exchangeRate = resolveExchangeRate({
        sourceCurrency: supplierCost.currency,
        targetCurrency: normalizedCurrency,
        now
    });
    const policy = await loadActivePolicy({ region: normalizedRegion, currency: normalizedCurrency, now });
    const [version, rules] = await Promise.all([
        loadPublishedVersion({ policy, pkg, region: normalizedRegion, now }),
        loadActiveRules({ policy, packageContext, region: normalizedRegion, currency: normalizedCurrency, now })
    ]);

    return {
        packageContext,
        pricing: {
            pricingInput: {
                supplierCost: amount(supplierCost.amount),
                supplierCurrency: supplierCost.currency,
                targetCurrency: normalizedCurrency,
                exchangeRate: supplierCost.currency === normalizedCurrency ? null : exchangeRate,
                policy: policyFromRecord(policy),
                appliedPricingRules: rules,
                context: {
                    evaluationTime: now.toISOString(),
                    region: normalizedRegion,
                    currency: normalizedCurrency,
                    gameId: packageContext.gameId,
                    gameCode: packageContext.gameCode,
                    categoryId: packageContext.categoryId,
                    categoryCode: packageContext.categoryCode,
                    packageId: packageContext.packageId,
                    packageRef: packageContext.packageRef,
                    packageCode: packageContext.packageCode,
                    supplierCostSnapshot: supplierCost,
                    exchangeRateSnapshot: exchangeRate,
                    businessRuntime: {
                        supplierCostConfigured: supplierCost.configured === true,
                        supplierCostSource: supplierCost.source,
                        healthyMarginRequired: true
                    }
                }
            },
            versionContext: {
                priceVersionId: text(version?.versionId || version?._id),
                priceVersionNumber: Number(version?.versionNumber || 1),
                branchKey: text(version?.branchKey || DEFAULT_BRANCH),
                parentVersionId: text(version?.parentVersionId)
            }
        }
    };
}

module.exports = Object.freeze({
    buildProductionPricingContext,
    neutralPolicy
});
