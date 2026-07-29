const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, needle, message) {
    assert(read(file).includes(needle), message);
}

function matches(file, pattern, message) {
    assert(pattern.test(read(file)), message);
}

function routeSnippet(source, route) {
    const index = source.indexOf(route);
    assert(index >= 0, `${route} route must exist.`);
    return source.slice(index, index + 1400);
}

async function verifySupplierCostRuntime() {
    const { resolveSupplierCostSnapshot } = require("../services/commerce/supplierCostService");
    const { buildProductionPricingContext } = require("../services/commerce/productionPricingContextService");
    const { createPricingQuote, PricingQuoteRuntimeError } = require("../services/commerce/pricingQuoteRuntime");

    const configured = resolveSupplierCostSnapshot({
        pkg: {
            metadata: {},
            updatedAt: new Date("2026-01-01T00:00:00Z")
        },
        price: {
            amount: 1000,
            currency: "THB",
            supplierCost: 700,
            supplierCurrency: "THB",
            supplierName: "Supplier A",
            supplierVersion: "S1",
            supplierCostTimestamp: new Date("2026-01-02T00:00:00Z")
        },
        region: "TH",
        currency: "THB",
        now: new Date("2026-01-03T00:00:00Z")
    });

    assert.strictEqual(configured.amount, 700, "configured supplier cost must not use selling price");
    assert.strictEqual(configured.currency, "THB");
    assert.strictEqual(configured.configured, true);
    assert.strictEqual(configured.source, "catalog_package.prices.TH");

    const fallback = resolveSupplierCostSnapshot({
        pkg: {
            metadata: {},
            updatedAt: new Date("2026-01-01T00:00:00Z")
        },
        price: {
            amount: 1000,
            currency: "THB"
        },
        region: "TH",
        currency: "THB",
        now: new Date("2026-01-03T00:00:00Z")
    });

    assert.strictEqual(fallback.amount, 1000, "compatibility fallback must preserve existing package checkout continuity");
    assert.strictEqual(fallback.configured, false, "compatibility fallback must be explicit, not hidden");
    assert.strictEqual(fallback.warning, "SUPPLIER_COST_NOT_CONFIGURED");

    const PricingPolicy = require("../models/PricingPolicy");
    const PricingRule = require("../models/PricingRule");
    const PriceVersion = require("../models/PriceVersion");
    const originalPolicyFindOne = PricingPolicy.findOne;
    const originalRuleFind = PricingRule.find;
    const originalVersionFind = PriceVersion.find;
    const originalRate = process.env.COMMERCE_EXCHANGE_RATE_THB_MMK;
    process.env.COMMERCE_EXCHANGE_RATE_THB_MMK = "118";

    PricingPolicy.findOne = () => ({ sort: () => ({ lean: async () => null }) });
    PricingRule.find = () => ({ sort: () => ({ lean: async () => [] }) });
    PriceVersion.find = () => ({
        sort: () => ({
            limit: () => ({ lean: async () => [] })
        })
    });

    try {
        const context = await buildProductionPricingContext({
            pkg: {
                _id: "pkg1",
                productCode: "mlbb",
                packageCode: "MLBB_1",
                name: "MLBB Pack",
                metadata: {}
            },
            price: {
                amount: 5000,
                currency: "MMK",
                supplierCost: 40,
                supplierCurrency: "THB",
                supplierName: "Thai Supplier",
                supplierVersion: "2026-07"
            },
            catalog: {},
            region: "MM",
            currency: "MMK",
            now: new Date("2026-07-29T00:00:00Z")
        });

        assert.strictEqual(context.pricing.pricingInput.supplierCost, 40);
        assert.strictEqual(context.pricing.pricingInput.supplierCurrency, "THB");
        assert.strictEqual(context.pricing.pricingInput.targetCurrency, "MMK");
        assert.strictEqual(context.pricing.pricingInput.exchangeRate.rate, 118);
        assert.strictEqual(context.pricing.pricingInput.context.supplierCostSnapshot.supplierName, "Thai Supplier");
    } finally {
        PricingPolicy.findOne = originalPolicyFindOne;
        PricingRule.find = originalRuleFind;
        PriceVersion.find = originalVersionFind;
        if (originalRate === undefined) delete process.env.COMMERCE_EXCHANGE_RATE_THB_MMK;
        else process.env.COMMERCE_EXCHANGE_RATE_THB_MMK = originalRate;
    }

    assert.throws(() => createPricingQuote({
        quoteId: "AZQ-margin-block-1",
        owner: { userId: "user-1" },
        request: {
            region: "TH",
            currency: "THB",
            package: {
                packageId: "pkg1",
                packageCode: "PKG1",
                packageName: "Package",
                gameId: "game",
                gameCode: "game",
                gameName: "Game",
                quantity: 1
            }
        },
        issuedAt: new Date("2026-07-29T00:00:00Z"),
        validitySeconds: 900,
        pricingInput: {
            supplierCost: 100,
            supplierCurrency: "THB",
            targetCurrency: "THB",
            policy: {
                supplierFee: { enabled: false, type: "FIXED", value: 0 },
                businessCost: { enabled: false, type: "FIXED", value: 0 },
                profitRule: { enabled: true, type: "FIXED", value: 10 },
                gatewayFee: { enabled: false, type: "FIXED", value: 0 },
                platformCost: { enabled: false, type: "FIXED", value: 0 },
                tax: { enabled: false, type: "FIXED", value: 0 },
                roundingRule: { enabled: false, mode: "NONE" }
            },
            appliedPricingRules: [{
                id: "override-1",
                code: "UNDER_COST",
                ruleType: "PRICE_OVERRIDE",
                value: 80,
                priority: 100,
                scopeType: "PACKAGE",
                scopeReference: "PKG1"
            }],
            context: {
                supplierCostSnapshot: { configured: true, source: "catalog_package.prices.TH" },
                packageCode: "PKG1"
            }
        }
    }), PricingQuoteRuntimeError, "Price-below-cost quotes must be blocked.");

    const compatibilityQuote = createPricingQuote({
        quoteId: "AZQ-margin-compat-1",
        owner: { userId: "user-1" },
        request: {
            region: "TH",
            currency: "THB",
            couponCode: "SAVE10",
            package: {
                packageId: "pkg1",
                packageCode: "PKG1",
                packageName: "Package",
                gameId: "game",
                gameCode: "game",
                gameName: "Game",
                quantity: 1
            }
        },
        issuedAt: new Date("2026-07-29T00:00:00Z"),
        validitySeconds: 900,
        pricingInput: {
            supplierCost: 100,
            supplierCurrency: "THB",
            targetCurrency: "THB",
            policy: {
                supplierFee: { enabled: false, type: "FIXED", value: 0 },
                businessCost: { enabled: false, type: "FIXED", value: 0 },
                profitRule: { enabled: true, type: "FIXED", value: 0 },
                gatewayFee: { enabled: false, type: "FIXED", value: 0 },
                platformCost: { enabled: false, type: "FIXED", value: 0 },
                tax: { enabled: false, type: "FIXED", value: 0 },
                roundingRule: { enabled: false, mode: "NONE" }
            },
            appliedPricingRules: [],
            context: {
                supplierCostSnapshot: {
                    configured: false,
                    source: "catalog_price_compatibility",
                    warning: "SUPPLIER_COST_NOT_CONFIGURED"
                },
                packageCode: "PKG1"
            }
        },
        promotionInput: {
            promotions: [{
                id: "promo-1",
                code: "SAVE10",
                name: "Save 10",
                promotionType: "FIXED_DISCOUNT",
                status: "ACTIVE",
                discountValue: 10,
                region: "TH",
                currency: "THB",
                priority: 10,
                requiresCoupon: true,
                couponCode: "SAVE10",
                scopes: [{ scopeType: "GLOBAL" }],
                createdAt: "2026-01-01T00:00:00.000Z"
            }],
            campaigns: [],
            strategy: { couponCode: "SAVE10" },
            context: {
                evaluationTime: "2026-07-29T00:00:00.000Z",
                region: "TH",
                currency: "THB",
                packageCode: "PKG1",
                gameId: "game",
                categoryId: "game",
                userId: "user-1",
                couponCode: "SAVE10",
                orderSubtotal: 100,
                usage: {
                    promotionUsageTotal: {},
                    userPromotionUsage: {}
                }
            }
        }
    });

    assert.strictEqual(compatibilityQuote.pricingSnapshot.businessRuntime.supplierCostConfigured, false, "Missing supplier cost must be marked unconfigured.");
    assert.strictEqual(compatibilityQuote.pricingSnapshot.businessRuntime.profitabilityStatus, "UNKNOWN_SUPPLIER_COST", "Compatibility cost must not claim confirmed profitability.");
    assert.strictEqual(compatibilityQuote.pricingSnapshot.businessRuntime.marginEnforcementApplied, false, "Compatibility cost must not enforce margin as authoritative.");
    assert.strictEqual(compatibilityQuote.pricingSnapshot.businessRuntime.grossProfit, null, "Compatibility cost must not claim confirmed gross profit.");
    assert.strictEqual(compatibilityQuote.commercialSnapshot.quotedTotalAmount, 90, "Coupon must still apply to customer amount with compatibility supplier cost.");
}

function verifyStaticAuthorityBoundaries() {
    includes("backend/models/CatalogPackage.js", "supplierCost", "CatalogPackage must support supplier cost.");
    includes("backend/models/CatalogPackage.js", "supplierCurrency", "CatalogPackage must support supplier currency.");
    includes("backend/models/CatalogPackage.js", "supplierName", "CatalogPackage must support supplier name.");
    includes("backend/models/CatalogPackage.js", "supplierVersion", "CatalogPackage must support supplier version.");
    includes("backend/models/CatalogPackage.js", "supplierCostTimestamp", "CatalogPackage must support supplier cost timestamp.");

    includes("backend/services/commerce/productionPricingContextService.js", "resolveSupplierCostSnapshot", "Production pricing context must use supplier cost service.");
    includes("backend/services/commerce/productionPricingContextService.js", "resolveExchangeRate", "Production pricing context must use exchange rate service.");
    matches(
        "backend/services/commerce/productionPricingContextService.js",
        /supplierCost:\s*amount\(supplierCost\.amount\)/,
        "Production pricing input must use resolved supplier cost."
    );
    assert(!/supplierCost:\s*amount\(price\?\.amount\)/.test(read("backend/services/commerce/productionPricingContextService.js")), "Production context must not directly treat catalog selling price as supplier cost.");

    includes("backend/services/commerce/pricingQuoteRuntime.js", "supplierCostSnapshot", "Pricing quote snapshot must preserve supplier cost snapshot.");
    includes("backend/services/commerce/pricingQuoteRuntime.js", "businessRuntime", "Pricing quote snapshot must expose business runtime metrics.");
    includes("backend/services/commerce/pricingQuoteRuntime.js", "healthyMargin", "Pricing snapshot must expose margin health.");
    includes("backend/services/commerce/pricingQuoteRuntime.js", "UNKNOWN_SUPPLIER_COST", "Compatibility supplier cost must expose unknown profitability.");
    includes("backend/services/commerce/pricingQuoteRuntime.js", "marginEnforcementApplied", "Pricing snapshot must expose whether margin enforcement was authoritative.");

    includes("backend/routes/payment.js", "LEGACY_PAYABLE_CREATION_DISABLED", "Legacy payable creation routes must be disabled by default.");
    includes("backend/routes/payment.js", "AZIEL_ALLOW_LEGACY_PAYABLE_CREATION", "Legacy creation override must be explicit.");
    includes("backend/routes/order.js", "LEGACY_PAYABLE_CREATION_DISABLED", "Legacy /orders creation route must be disabled by default.");
    includes("backend/routes/order.js", "AZIEL_ALLOW_LEGACY_PAYABLE_CREATION", "Legacy /orders creation override must be explicit.");
    const paymentRoutes = read("backend/routes/payment.js");
    ["manual/attempt", "create"].forEach(route => {
        const snippet = routeSnippet(paymentRoutes, `router.post("/payment/${route}"`);
        assert(snippet.includes("AZIEL_ALLOW_LEGACY_PAYABLE_CREATION"), `Legacy ${route} route must check the explicit override env.`);
        assert(snippet.includes("commerceCoreDisabledLegacyPayableResponse"), `Legacy ${route} route must return the Commerce Core disabled response.`);
    });
    const slipSnippet = routeSnippet(paymentRoutes, 'router.post("/payment/manual/attempt/:attemptId/slip"');
    assert(!slipSnippet.includes("AZIEL_ALLOW_LEGACY_PAYABLE_CREATION"), "Existing legacy attempt slip completion must remain available.");
    assert(slipSnippet.includes("username: req.user.username"), "Legacy slip completion must validate authenticated ownership.");
    assert(paymentRoutes.includes("attempt.status === \"consumed\""), "Legacy slip completion must preserve duplicate/terminal handling.");
    assert(paymentRoutes.includes("attempt.status !== \"active\" || attempt.expiresAt <= new Date()"), "Legacy slip completion must reject non-active or expired attempts.");
    const orderRoutes = read("backend/routes/order.js");
    const orderSnippet = routeSnippet(orderRoutes, 'router.post("/orders"');
    assert(orderSnippet.includes("AZIEL_ALLOW_LEGACY_PAYABLE_CREATION"), "Legacy /orders route must check the explicit override env.");
    assert(orderSnippet.includes("commerceCoreDisabledLegacyPayableResponse"), "Legacy /orders route must return the Commerce Core disabled response.");
}

(async () => {
    verifyStaticAuthorityBoundaries();
    await verifySupplierCostRuntime();
    console.log("Commerce Core Mega Sprint Phase 1 verifier passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
