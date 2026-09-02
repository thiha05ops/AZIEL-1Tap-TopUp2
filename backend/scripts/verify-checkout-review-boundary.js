#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { resolveFulfillmentCapability } = require("../services/fulfillmentCapabilityService");
const { reviewCustomerCheckout } = require("../services/commerce/customerManualPromptPayCheckoutService");
const { createAndPersistPricingQuote } = require("../services/commerce/pricingQuoteApplicationService");
const { checkoutFromQuote } = require("../services/commerce/checkoutApplicationService");

const ROOT = path.resolve(__dirname, "../..");
const checkoutSource = fs.readFileSync(path.join(ROOT, "frontend/js/product-checkout.js"), "utf8");
const packageCode = "MC_MLBB_1007_156_DIAMONDS_83C0D0F9";
const future = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();

function classList() {
    const values = new Set();
    return {
        add: (...items) => items.forEach(item => values.add(item)),
        remove: (...items) => items.forEach(item => values.delete(item)),
        toggle: (item, force) => force === undefined ? (values.has(item) ? !values.delete(item) : Boolean(values.add(item))) : (force ? Boolean(values.add(item)) : !values.delete(item)),
        contains: item => values.has(item)
    };
}

function element() {
    return {
        textContent: "",
        hidden: false,
        disabled: false,
        href: "",
        dataset: {},
        classList: classList(),
        addEventListener() {},
        setAttribute(name, value) { this[name] = String(value); },
        toggleAttribute(name, enabled) { this[name] = enabled; }
    };
}

async function runFrontend(fetchImpl) {
    const nodes = new Map();
    const listeners = {};
    const draft = {
        createdAt: new Date().toISOString(),
        returnUrl: "mlbb.html",
        order: {
            orderId: "checkout-boundary-test",
            productCode: "mlbb",
            gameKey: "mlbb",
            game: "Mobile Legends Diamonds",
            packageCode,
            packageName: "1007 + 156 Diamonds",
            amount: 651.08,
            currency: "THB",
            region: "TH",
            userId: "123456789",
            zoneId: "1234"
        }
    };
    const storage = new Map([["azielProductCheckoutDraft", JSON.stringify(draft)]]);
    const document = {
        addEventListener(name, handler) { listeners[name] = handler; },
        getElementById(id) {
            if (!nodes.has(id)) nodes.set(id, element());
            return nodes.get(id);
        },
        querySelector() { return null; }
    };
    const window = {
        document,
        selectedPaymentData: { key: "promptpay", method: "PromptPay", paymentType: "manual" },
        matchMedia: () => ({ matches: false }),
        setTimeout,
        clearTimeout,
        location: { replace() { throw new Error("Unexpected checkout redirect."); } }
    };
    window.window = window;
    vm.runInNewContext(checkoutSource, {
        window,
        document,
        sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
        fetch: fetchImpl,
        AbortController,
        CustomEvent: class CustomEvent {},
        Event: class Event {},
        Date,
        Number,
        String,
        Boolean,
        JSON,
        console,
        setTimeout,
        clearTimeout
    }, { filename: "product-checkout.js" });
    listeners.DOMContentLoaded();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    return { nodes, storage };
}

function publicQuote() {
    return {
        quoteId: "AZQ_CHECKOUT_BOUNDARY",
        status: "ISSUED",
        expiresAt: future(),
        package: { packageCode, packageName: "1007 + 156 Diamonds", gameName: "Mobile Legends Diamonds" },
        pricing: { originalPrice: 651.08, discountAmount: 0, quotedUnitPrice: 651.08, quotedTotalAmount: 651.08, currency: "THB" },
        promotion: null
    };
}

async function verifyBackend() {
    let persistedQuote = null;
    const mapping = {
        _id: "6a94fec6591c7120027da868",
        supplierId: "supplier",
        supplierCode: "FAZERCARDS",
        productCode: "mlbb",
        packageCode,
        region: "GLOBAL",
        enabled: true,
        executionMode: "API",
        productionRole: "PRIMARY",
        supplierProductCode: "mobile_legends_global",
        supplierPackageCode: "1007_156_diamonds",
        fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "provider evidence", verifiedAt: new Date(), version: 2 },
        mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, validationReady: true, pricingReady: true, fulfillmentReady: true, storefrontReady: true } }
    };
    const supplier = { _id: "supplier", enabled: true, mode: "API", supportedRegions: ["TH"] };
    const capability = resolveFulfillmentCapability({
        product: {}, mappings: [mapping], suppliers: [supplier], productCode: "mlbb", packageCode, region: "TH",
        context: { adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }), mappingSupportResolver: () => true }
    });
    assert.strictEqual(capability.fulfillmentAvailable, true, "GLOBAL supplier market must be eligible for its explicitly allowed TH customer market.");

    const pkg = { _id: "package", productCode: "mlbb", packageCode, name: "1007 + 156 Diamonds", prices: { TH: { amount: 651.08, currency: "THB", enabled: true } }, metadata: {} };
    const result = await reviewCustomerCheckout(
        { checkoutKey: "checkout-boundary-test", productCode: "mlbb", packageCode, region: "TH", currency: "THB" },
        { user: { id: "customer" } },
        {
            loadCatalogPackage: async () => ({ pkg, price: pkg.prices.TH, region: "TH", currency: "THB", productCode: "mlbb", packageCode }),
            assertFulfillmentReady: async () => capability,
            buildPricingContext: async () => ({
                packageContext: { packageId: "package", packageRef: "package", packageCode, packageName: pkg.name, gameId: "mlbb", gameCode: "mlbb", gameName: "Mobile Legends Diamonds", categoryId: "game", categoryCode: "game" },
                pricing: { pricingInput: { supplierCost: 651.08, supplierCurrency: "THB", targetCurrency: "THB", exchangeRate: null, acquisitionCosts: { fundingCost: 0, otherAcquisitionCost: 0 }, policy: { profitRule: { enabled: true, type: "FIXED", value: 0 } }, appliedPricingRules: [{ code: "PUBLISHED_PRICE", ruleType: "PRICE_OVERRIDE", value: 651.08, priority: 1000, stopFurtherProcessing: true, configuration: {} }], context: {} }, versionContext: { priceVersionId: "published-price", priceVersionNumber: 1, branchKey: "storefront" } }
            }),
            createAndPersistPricingQuote: (input, dependencies) => createAndPersistPricingQuote(input, {
                ...dependencies,
                createQuoteRecord: async ({ quote }) => {
                    persistedQuote = { ...quote, createdAt: new Date(), __pricingQuotePersistenceOutcome: "isolated_no_write" };
                    return persistedQuote;
                }
            })
        }
    );
    assert.strictEqual(result.review.status, "ISSUED");
    assert.strictEqual(result.review.pricing.originalPrice, 651.08);
    assert.strictEqual(result.review.pricing.discountAmount, 0);
    assert.strictEqual(result.review.pricing.quotedTotalAmount, 651.08);
    assert.strictEqual(result.review.pricing.currency, "THB");

    const supplierRouteSnapshot = {
        routeType: "SUPPLIER_API", supplierMappingId: mapping._id, supplierId: mapping.supplierId, supplierCode: "FAZERCARDS",
        productCode: "mlbb", packageCode, supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode,
        executionMode: "API", selectedRole: "PRIMARY", selectedAt: new Date().toISOString(), snapshotVersion: 2,
        supplierMarket: "GLOBAL", customerMarket: "TH", eligibility: mapping.fulfillmentEligibility,
        fulfillmentContract: { version: 1, supplierCode: "FAZERCARDS", protocol: "FAZERCARDS_TOPUPS_ORDER_V2", supplierProductCode: mapping.supplierProductCode, fields: [
            { customerField: "playerId", providerField: "player_id", required: true, label: "Player ID", type: "text", constraints: {} },
            { customerField: "serverId", providerField: "server_id", required: true, label: "Server ID", type: "text", constraints: {} }
        ] }
    };
    let persistedOrder = null;
    let supplierCalls = 0;
    const checkout = await checkoutFromQuote({
        quoteId: persistedQuote.quoteId, owner: { userId: "customer" }, idempotencyKey: "checkout:checkout-boundary-test",
        paymentSelection: { paymentMethodId: "promptpay", paymentChannel: "MANUAL_PROMPTPAY" },
        customerInput: { gameAccount: { userId: "439488505", zoneId: "2409", accountFields: [
            { key: "userId", label: "MLBB User ID", value: "439488505" }, { key: "zoneId", label: "Zone ID", value: "2409" }
        ] }, customFields: { gameKey: "mlbb" } }, requestMetadata: { source: "isolated-verifier" }
    }, {
        findOwnedQuote: async () => persistedQuote, findOrderByQuoteId: async () => null, findOrderByCheckoutIdempotency: async () => null,
        validateOperationalPackageState: async () => ({ allowed: true, supplierRouteSnapshot }),
        validateFulfilmentInput: async ({ customerInput }) => ({ allowed: true, normalisedFulfilmentInput: customerInput }),
        validatePaymentMethod: async () => ({ allowed: true, paymentSnapshot: { paymentMethodId: "promptpay", paymentChannel: "MANUAL_PROMPTPAY", provider: "MANUAL_PROMPTPAY", nextAction: "OPEN_MANUAL_PAYMENT", paymentMethodBound: true }, nextAction: "OPEN_MANUAL_PAYMENT" }),
        validatePromotionRedemption: async () => ({ allowed: true, promotionRedemptionSnapshot: null }),
        getCheckoutTime: () => new Date(), generateOrderId: () => "AZL-CHECKOUT-BOUNDARY", generateCheckoutId: () => "CHK-CHECKOUT-BOUNDARY",
        transactionRunner: async callback => callback({}),
        createOrderRecord: async ({ orderSnapshot }) => { persistedOrder = orderSnapshot; return orderSnapshot; }, markQuoteUsed: async () => persistedQuote
    });
    assert.strictEqual(checkout.checkout.orderId, "AZL-CHECKOUT-BOUNDARY");
    assert(persistedOrder, "Valid userId/zoneId aliases must reach mocked CommerceOrder persistence.");
    assert.deepStrictEqual({ routeType: persistedOrder.fulfilment.routeSnapshot.routeType, supplierCode: persistedOrder.fulfilment.routeSnapshot.supplierCode, supplierMappingId: persistedOrder.fulfilment.routeSnapshot.supplierMappingId, supplierMarket: persistedOrder.fulfilment.routeSnapshot.supplierMarket, customerMarket: persistedOrder.fulfilment.routeSnapshot.customerMarket, snapshotVersion: persistedOrder.fulfilment.routeSnapshot.snapshotVersion }, { routeType: "SUPPLIER_API", supplierCode: "FAZERCARDS", supplierMappingId: mapping._id, supplierMarket: "GLOBAL", customerMarket: "TH", snapshotVersion: 2 });
    assert.strictEqual(supplierCalls, 0, "Checkout verification must not call the supplier.");
}

async function verifyFrontend() {
    const success = await runFrontend(async () => ({ ok: true, status: 200, json: async () => ({ success: true, review: publicQuote() }) }));
    assert.strictEqual(success.nodes.get("checkoutTotal").textContent, "651.08 ฿");
    assert.strictEqual(success.nodes.get("checkoutPayButton").disabled, false, "PromptPay CTA must enable after authoritative review.");
    assert.strictEqual(success.nodes.get("checkoutTotal").classList.contains("az-storefront-skeleton"), false);

    const failure = await runFrontend(async () => ({ ok: false, status: 409, json: async () => ({ success: false, code: "PACKAGE_UNAVAILABLE", message: "Selected package is no longer available." }) }));
    assert.strictEqual(failure.nodes.get("checkoutTotal").textContent, "Unavailable");
    assert.strictEqual(failure.nodes.get("checkoutTotal").classList.contains("az-storefront-skeleton"), false, "Business failure must clear skeletons.");
    assert.strictEqual(failure.nodes.get("checkoutPayButton").disabled, true);
    assert.strictEqual(failure.nodes.get("checkoutRecoveryActions").hidden, false);
    assert.match(failure.nodes.get("checkoutFeedback").textContent, /Selected package is no longer available/);

    const networkFailure = await runFrontend(async () => { throw new TypeError("Network request failed"); });
    assert.strictEqual(networkFailure.nodes.get("checkoutTotal").textContent, "Unavailable");
    assert.strictEqual(networkFailure.nodes.get("checkoutTotal").classList.contains("az-storefront-skeleton"), false, "Network uncertainty must clear skeletons.");
    assert.strictEqual(networkFailure.nodes.get("checkoutPayButton").disabled, true);
    assert.strictEqual(networkFailure.nodes.get("checkoutRecoveryActions").hidden, false);

    assert(checkoutSource.includes("AbortController"), "Review must have a bounded network wait.");
    assert(checkoutSource.includes("renderReviewFailure"), "Review failure must render a deterministic terminal state.");
    assert(!checkoutSource.includes("player_id") && !checkoutSource.includes("server_id"), "Checkout review must preserve customer-facing input semantics and not expose supplier fields.");
}

async function main() {
    await verifyBackend();
    await verifyFrontend();
    console.log(JSON.stringify({ result: "PASS", state: "PAYMENT_READY", productCode: "mlbb", packageCode, region: "TH", basePrice: 651.08, finalTotal: 651.08, currency: "THB", promptPayAvailable: true, paymentSubmitted: false, supplierCalls: 0, productionWrites: 0 }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
