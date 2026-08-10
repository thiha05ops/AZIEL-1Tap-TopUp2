"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { resolveCommercePricingPreview } = require("../services/commerce/commercePricingPreviewService");

const ROOT = path.resolve(__dirname, "../..");
const pkg = { _id: "mlbb-22", productCode: "mlbb", packageCode: "MLBB_22", name: "22 Diamonds" };

function pricingContext(region) {
    const isTh = region === "TH";
    return {
        packageContext: {
            packageId: "mlbb-22", packageRef: "mlbb-22", packageCode: "MLBB_22", packageName: "22 Diamonds",
            gameId: "mlbb", gameCode: "mlbb", gameName: "Mobile Legends", categoryId: "game", categoryCode: "game"
        },
        pricing: {
            pricingInput: {
                supplierCost: 13.1,
                supplierCurrency: "THB",
                targetCurrency: isTh ? "THB" : "MMK",
                exchangeRate: isTh ? null : { rate: 130, sourceCurrency: "THB", targetCurrency: "MMK", source: "fixture" },
                policy: {
                    supplierFee: { enabled: false, type: "FIXED", value: 0 },
                    businessCost: { enabled: false, type: "FIXED", value: 0 },
                    gatewayFee: { enabled: false, type: "FIXED", value: 0 },
                    platformCost: { enabled: false, type: "FIXED", value: 0 },
                    tax: { enabled: false, type: "FIXED", value: 0 },
                    profitRule: { enabled: true, type: "FIXED", value: isTh ? 1 : 0 },
                    roundingRule: { enabled: false, mode: "NONE", increment: 0 }
                },
                appliedPricingRules: [],
                context: {
                    evaluationTime: "2026-08-09T00:00:00.000Z",
                    region,
                    packageCode: "MLBB_22",
                    supplierCostSnapshot: { amount: 13.1, currency: "THB", configured: true, source: "fixture" },
                    businessRuntime: { supplierCostConfigured: true, publishedPriceMode: "POLICY_DERIVED" }
                }
            },
            versionContext: { priceVersionId: `fixture-${region}`, priceVersionNumber: 1, branchKey: "storefront" }
        }
    };
}

function promotionContext(region, currency) {
    return {
        promotions: [{
            id: "promo-10", code: "TEST10", name: "Test 10", enabled: true, status: "ACTIVE",
            promotionType: "PERCENTAGE_DISCOUNT", discountValue: 10, maximumDiscountAmount: 0,
            minimumOrderAmount: 0, priority: 0, stackable: false, exclusive: true,
            requiresCoupon: true, couponCode: "TEST10", targeting: { regions: [region], currencies: [currency], packages: [], gameIds: [] },
            scopes: [{ scopeType: "REGION", scopeReference: region }]
        }],
        campaigns: [],
        context: { region, currency, couponCode: "TEST10", packageCode: "MLBB_22", gameId: "mlbb" },
        strategy: { mode: "BEST_PRICE" }
    };
}

async function preview(region, promo = false) {
    const currency = region === "TH" ? "THB" : "MMK";
    return resolveCommercePricingPreview({ productCode: "mlbb", packageCode: "MLBB_22", region, currency, promoCode: promo ? "TEST10" : "" }, {}, {
        loadCatalogPackage: async () => ({ pkg, price: { amount: region === "TH" ? 14.1 : 1689.9, currency, enabled: true, publishedPriceMode: "POLICY_DERIVED" }, productCode: "mlbb", packageCode: "MLBB_22", region, currency }),
        buildPricingContext: async () => pricingContext(region),
        loadPromotionContext: async () => promotionContext(region, currency),
        now: "2026-08-09T00:00:00.000Z",
        quoteId: `AZP-FIXTURE-${region}-${promo ? "PROMO" : "BASE"}`
    });
}

async function main() {
    const th = await preview("TH");
    assert.strictEqual(th.baseAmount, 14.1);
    assert.strictEqual(th.finalAmount, 14.1);
    const thPromo = await preview("TH", true);
    assert.strictEqual(thPromo.discountAmount, 1.41);
    assert.strictEqual(thPromo.finalAmount, 12.69);

    const mm = await preview("MM");
    assert.strictEqual(mm.baseAmount, 1703);
    assert.strictEqual(mm.finalAmount, 1703);
    const mmPromo = await preview("MM", true);
    assert.strictEqual(mmPromo.discountAmount, 170.3);
    assert.strictEqual(mmPromo.finalAmount, 1532.7);

    const tampered = await resolveCommercePricingPreview({
        productCode: "mlbb", packageCode: "MLBB_22", region: "TH", currency: "THB",
        sellingPrice: 0.01, customerPayable: 0.01, recommendedPrice: 0.01, discount: 9999, exchangeRate: 1
    }, {}, {
        loadCatalogPackage: async () => ({ pkg, price: { amount: 9999, currency: "THB", enabled: true, publishedPriceMode: "POLICY_DERIVED", referencePrice: 999999, discountLabel: "FREE" }, productCode: "mlbb", packageCode: "MLBB_22", region: "TH", currency: "THB" }),
        buildPricingContext: async () => pricingContext("TH"),
        now: "2026-08-09T00:00:00.000Z",
        quoteId: "AZP-FIXTURE-TAMPER"
    });
    assert.strictEqual(tampered.finalAmount, 14.1, "browser financial fields and presentation metadata must be ignored");

    const compatibilityPreview = await resolveCommercePricingPreview(
        { productCode: "mlbb", packageCode: "MLBB_22", region: "TH", currency: "THB" }, {}, {
            loadCatalogPackage: async () => ({ pkg, price: { amount: 14.1, currency: "THB", enabled: true, publishedPriceMode: "POLICY_DERIVED" }, productCode: "mlbb", packageCode: "MLBB_22", region: "TH", currency: "THB" }),
            buildPricingContext: async () => {
                const context = pricingContext("TH");
                context.pricing.pricingInput.context.businessRuntime.supplierCostConfigured = false;
                context.pricing.pricingInput.context.businessRuntime.supplierCostSource = "catalog_price_compatibility";
                context.pricing.pricingInput.context.supplierCostSnapshot = { amount: 14.1, currency: "THB", configured: false, source: "catalog_price_compatibility" };
                context.pricing.pricingInput.supplierCost = 14.1;
                return context;
            }
        }
    );
    assert.strictEqual(compatibilityPreview.finalAmount, 15.1, "legacy packages must still be calculated by the server Commerce runtime");
    assert.strictEqual(compatibilityPreview.supplierCostConfigured, false);
    assert.strictEqual(compatibilityPreview.pricingSource, "catalog_price_compatibility");

    const prices = fs.readFileSync(path.join(ROOT, "frontend/js/prices.js"), "utf8");
    assert(prices.includes('/api/pricing/preview'), "Product Detail must request authoritative pricing previews.");
    assert(!prices.includes('price.amount *'), "Product Detail must not duplicate pricing arithmetic.");
    const adminCatalog = fs.readFileSync(path.join(ROOT, "frontend/js/admin-catalog.js"), "utf8");
    assert(adminCatalog.includes("Current Commerce Price"));
    assert(adminCatalog.includes("Published Catalog Price"));
    assert(adminCatalog.includes("COMMERCE_PRICING_RUNTIME"));
    assert(prices.includes("Promise.allSettled"), "one rejected package preview must not collapse the whole grid");
    assert(prices.includes("requestId !== pricingRenderRequestId"), "stale region preview requests must be ignored");
    assert(prices.includes("forceRefresh: true"), "pricing preview retry must force a fresh Catalog/preview attempt");
    assert(prices.includes("catalogLoadInFlight"), "Catalog ready events must not duplicate an in-flight package preview run");
    console.log("Commerce pricing preview verification passed.");
}

main().catch(error => { console.error(error); process.exit(1); });
