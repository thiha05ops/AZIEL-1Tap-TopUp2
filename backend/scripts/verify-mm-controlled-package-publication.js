#!/usr/bin/env node
"use strict";

const assert = require("assert");
const CatalogPackage = require("../models/CatalogPackage");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const { setPackageMarketPublication, explicitPublishedPackages } = require("../services/packageMarketPublicationService");
const { publicPaymentMarketReadiness } = require("../services/publicPaymentMarketReadinessService");
const { applySelectedPublicPurchasability } = require("../services/catalogService");
const { contractFingerprint } = require("../services/suppliers/fazercardsFulfillmentContractService");
const { createPricingQuote } = require("../services/commerce/pricingQuoteRuntime");
const { checkoutFromQuote } = require("../services/commerce/checkoutApplicationService");
const { PRODUCTION_API_BASE_URL } = require("../services/myanmyanpay/myanMyanPayConfiguration");

const PACKAGE_CODE = "MC_MLBB_MM_CONTROLLED_TEST";
const PRICE_MMK = 5000;
const MAPPING_ID = "64b000000000000000000001";
const SUPPLIER_ID = "64b000000000000000000002";
const OFFER_ID = "64b000000000000000000003";
const envKeys = [
    "MYANMYANPAY_ENVIRONMENT",
    "MYANMYANPAY_PRODUCTION_APP_ID",
    "MYANMYANPAY_PRODUCTION_PUBLISHABLE_KEY",
    "MYANMYANPAY_PRODUCTION_SECRET_KEY",
    "MYANMYANPAY_PRODUCTION_API_BASE_URL",
    "FAZERCARDS_API_KEY",
    "FAZERCARDS_AUTO_FULFILLMENT_ENABLED"
];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

function restoreEnvironment() {
    for (const key of envKeys) {
        if (originalEnv[key] == null) delete process.env[key];
        else process.env[key] = originalEnv[key];
    }
}

function configureFixtureEnvironment() {
    process.env.MYANMYANPAY_ENVIRONMENT = "PRODUCTION";
    process.env.MYANMYANPAY_PRODUCTION_APP_ID = "fixture-app";
    process.env.MYANMYANPAY_PRODUCTION_PUBLISHABLE_KEY = "pk_live_fixture";
    process.env.MYANMYANPAY_PRODUCTION_SECRET_KEY = "sk_live_fixture";
    process.env.MYANMYANPAY_PRODUCTION_API_BASE_URL = PRODUCTION_API_BASE_URL;
    process.env.FAZERCARDS_API_KEY = "fixture-only";
    process.env.FAZERCARDS_AUTO_FULFILLMENT_ENABLED = "true";
}

async function verifyAdminSellingOnWrite() {
    const originals = {
        packageFindOne: CatalogPackage.findOne,
        publicationFindOne: PackageMarketPublication.findOne,
        publicationFindOneAndUpdate: PackageMarketPublication.findOneAndUpdate
    };
    let capturedFilter = null;
    let capturedUpdate = null;
    let capturedOptions = null;
    try {
        CatalogPackage.findOne = query => ({
            lean: async () => ({ _id: "package-id", ...query, enabled: true, prices: { MM: { amount: PRICE_MMK, currency: "MMK", enabled: true } } })
        });
        PackageMarketPublication.findOne = () => Promise.resolve(null);
        PackageMarketPublication.findOneAndUpdate = (filter, update, options) => {
            capturedFilter = filter;
            capturedUpdate = update;
            capturedOptions = options;
            return { lean: async () => ({ ...filter, ...update.$set }) };
        };
        const result = await setPackageMarketPublication({
            productCode: "MLBB",
            packageCode: PACKAGE_CODE.toLowerCase(),
            customerMarket: "mm",
            published: true,
            actor: "owner-fixture",
            decisionNote: "Controlled Myanmar publication verification"
        });
        assert.deepStrictEqual(capturedFilter, { productCode: "mlbb", packageCode: PACKAGE_CODE, customerMarket: "GLOBAL" });
        assert.strictEqual(capturedUpdate.$set.published, true);
        assert.strictEqual(capturedUpdate.$set.decisionVersion, 1);
        assert.strictEqual(capturedUpdate.$set.publishedBy, "owner-fixture");
        assert(capturedUpdate.$set.publishedAt instanceof Date);
        assert.strictEqual(capturedUpdate.$set.unpublishedAt, null);
        assert.strictEqual(capturedUpdate.$set.provenance.source, "ADMIN");
        assert.strictEqual(capturedOptions.upsert, true);
        assert.strictEqual(capturedOptions.runValidators, true);
        assert.strictEqual(result.publication.customerMarket, "GLOBAL");
        return result.publication;
    } finally {
        CatalogPackage.findOne = originals.packageFindOne;
        PackageMarketPublication.findOne = originals.publicationFindOne;
        PackageMarketPublication.findOneAndUpdate = originals.publicationFindOneAndUpdate;
    }
}

function fazerCardsFixture() {
    const contract = {
        version: 1,
        decisionVersion: 1,
        supplierCode: "FAZERCARDS",
        protocol: "FAZERCARDS_TOPUPS_ORDER_V2",
        supplierProductCode: "mobile_legends_global",
        sourceSupplierCatalogProductId: "supplier-product-fixture",
        sourceHash: "source-fixture",
        sourceOfferHash: "offer-fixture",
        authorityScope: "OFFER",
        noCustomerInput: false,
        fields: [
            { customerField: "userId", providerField: "player_id", required: true, label: "User ID", type: "numeric-text", options: [], constraints: {}, transformationId: "DIRECT" },
            { customerField: "zoneId", providerField: "server_id", required: true, label: "Zone ID", type: "numeric-text", options: [], constraints: {}, transformationId: "DIRECT" }
        ]
    };
    contract.fingerprint = contractFingerprint(contract);
    const mapping = {
        _id: MAPPING_ID,
        supplierId: SUPPLIER_ID,
        supplierCode: "FAZERCARDS",
        supplierCatalogOfferId: OFFER_ID,
        productCode: "mlbb",
        packageCode: PACKAGE_CODE,
        supplierProductCode: contract.supplierProductCode,
        supplierPackageCode: "offer-fixture",
        region: "GLOBAL",
        enabled: true,
        archivedAt: null,
        executionMode: "API",
        fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", verifiedAt: new Date(), version: 1 },
        mappingMetadata: { readiness: { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true }, fulfillmentContract: contract }
    };
    return {
        mapping,
        supplier: { _id: SUPPLIER_ID, supplierCode: "FAZERCARDS", enabled: true, mode: "API" },
        offer: { _id: OFFER_ID, supplierId: SUPPLIER_ID, supplierProductCode: mapping.supplierProductCode, supplierOfferCode: mapping.supplierPackageCode, catalogLifecycleState: "ACTIVE" },
        availability: { supplierCatalogOfferId: OFFER_ID, state: "AVAILABLE", observedAt: new Date(), staleAt: new Date(Date.now() + 60_000) }
    };
}

async function verifyPublishedPackageBecomesLive(publication) {
    const payment = await publicPaymentMarketReadiness("MM", {
        findMethods: async () => [{
            key: "myanmyanpay_mmqr",
            provider: "MYANMYANPAY",
            method: "MMQR",
            region: "MM",
            paymentType: "auto",
            enabled: true,
            myanMyanPayActivationState: "PUBLIC",
            myanMyanPayProductionTestApproved: true,
            myanMyanPayProductionTestVerified: true,
            myanMyanPayGoLiveApproved: true
        }]
    });
    assert.deepStrictEqual(payment, { ready: true, market: "MM", methodKeys: ["myanmyanpay_mmqr"] });
    const { mapping, supplier, offer, availability } = fazerCardsFixture();
    const rawPackage = { packageCode: PACKAGE_CODE, enabled: true, prices: { TH: { amount: 40, currency: "THB", enabled: true }, MM: { amount: PRICE_MMK, currency: "MMK", enabled: true } } };
    const project = { productCode: "mlbb", enabled: true, deletedAt: null, publicDiscoveryEnabled: true, commerceState: "PURCHASABLE" };
    for (const market of ["TH", "MM"]) {
        const projection = { packages: [{ packageCode: PACKAGE_CODE, prices: rawPackage.prices, fulfillmentRegions: { TH: true, MM: true } }] };
        applySelectedPublicPurchasability(
            projection, project, [rawPackage], [mapping], [supplier],
            [{ productCode: "mlbb", packageCode: PACKAGE_CODE, customerMarket: market, supplierMappingId: MAPPING_ID }],
            [publication], [offer], [availability], market, true, market === "MM" ? payment.ready : true
        );
        assert.strictEqual(projection.packages[0].salesState, "LIVE", `Global Selling ON must make the package LIVE in ${market}`);
        assert.strictEqual(projection.packages[0].prices[market].currency, market === "MM" ? "MMK" : "THB");
        assert.strictEqual(projection.packages[0].effectiveSupplierMappingId, MAPPING_ID, "Payment region must not change the selected supplier mapping");
        assert.strictEqual(explicitPublishedPackages(projection).length, 1);
    }
    for (const market of ["TH", "MM"]) {
        const projection = { packages: [{ packageCode: PACKAGE_CODE, prices: rawPackage.prices, fulfillmentRegions: { TH: true, MM: true } }] };
        applySelectedPublicPurchasability(projection, project, [rawPackage], [mapping], [supplier], [], [
            { ...publication, customerMarket: "TH", published: true },
            { ...publication, customerMarket: "GLOBAL", published: false }
        ], [offer], [availability], market, true, true);
        assert.strictEqual(projection.packages[0].salesState, "DISABLED", `Global Selling OFF must hide the package in ${market}`);
        assert.strictEqual(explicitPublishedPackages(projection).length, 0);
    }
    const legacyProjection = { packages: [{ packageCode: PACKAGE_CODE, prices: rawPackage.prices, fulfillmentRegions: { TH: true, MM: true } }] };
    applySelectedPublicPurchasability(legacyProjection, project, [rawPackage], [mapping], [supplier], [{ customerMarket: "MM", packageCode: PACKAGE_CODE, supplierMappingId: MAPPING_ID }], [{ ...publication, customerMarket: "TH", published: true }], [offer], [availability], "MM", true, true);
    assert.strictEqual(legacyProjection.packages[0].salesState, "LIVE", "A legacy published package must not disappear before a global decision is written");
    return mapping;
}

function mmQuote() {
    return createPricingQuote({
        quoteId: "AZQ-MM-CONTROLLED-1",
        issuedAt: "2026-10-10T00:00:00.000Z",
        expiresAt: "2099-10-10T00:10:00.000Z",
        owner: { userId: "user-mm-1", sessionId: "session-mm-1" },
        request: {
            region: "MM",
            currency: "MMK",
            package: { packageId: "package-mm-1", packageCode: PACKAGE_CODE, packageName: "Controlled MM Package", gameId: "mlbb", gameCode: "mlbb", gameName: "Mobile Legends", categoryId: "mobile-games", quantity: 1 }
        },
        pricingInput: {
            supplierCost: PRICE_MMK,
            supplierCurrency: "MMK",
            targetCurrency: "MMK",
            policy: { profitRule: { type: "FIXED", value: 0 }, gatewayFee: { enabled: false, type: "FIXED", value: 0 }, roundingRule: { enabled: false, mode: "NONE" } }
        },
        promotionInput: { promotions: [], campaigns: [], context: { region: "MM", currency: "MMK", evaluationTime: "2026-10-10T00:00:00.000Z" }, strategy: {} },
        versionContext: { priceVersionId: "mm-price-v1", priceVersionNumber: 1, branchKey: "main" },
        trace: { traceId: "mm-controlled", issueSource: "verification" }
    });
}

async function verifyMmkCheckoutFreezesRoute(mapping) {
    const quote = mmQuote();
    assert.strictEqual(quote.commercialSnapshot.currency, "MMK");
    assert.strictEqual(quote.commercialSnapshot.quotedTotalAmount, PRICE_MMK);
    const routeSnapshot = {
        snapshotVersion: 2,
        routeType: "SUPPLIER_API",
        supplierMappingId: MAPPING_ID,
        supplierId: SUPPLIER_ID,
        supplierCode: "FAZERCARDS",
        supplierMarket: "GLOBAL",
        productCode: "mlbb",
        packageCode: PACKAGE_CODE,
        customerMarket: "MM",
        supplierProductCode: mapping.supplierProductCode,
        supplierPackageCode: mapping.supplierPackageCode,
        executionMode: "API",
        selectedRole: "PACKAGE_SUPPLIER_SELECTION",
        selectedAt: "2026-10-10T00:00:00.000Z",
        eligibility: mapping.fulfillmentEligibility,
        fulfillmentContract: mapping.mappingMetadata.fulfillmentContract
    };
    let storedOrder = null;
    const result = await checkoutFromQuote({
        quoteId: quote.quoteId,
        owner: quote.owner,
        idempotencyKey: "mm-controlled-checkout",
        paymentSelection: { paymentMethodId: "myanmyanpay_mmqr", paymentChannel: "MYANMYANPAY_MMQR" },
        customerInput: { gameAccount: { userId: "123456789", zoneId: "2468" } },
        requestMetadata: { source: "verification" }
    }, {
        getCheckoutTime: () => new Date("2026-10-10T00:05:00.000Z"),
        generateCheckoutId: () => "CHK-MM-CONTROLLED-1",
        generateOrderId: () => "AZL-MM-CONTROLLED-1",
        fingerprintCheckoutRequest: () => "mm-controlled-fingerprint",
        hashCheckoutIdempotencyKey: () => "mm-controlled-idempotency-hash",
        findOwnedQuote: async () => structuredClone(quote),
        findOrderByQuoteId: async () => null,
        findOrderByCheckoutIdempotency: async () => null,
        validateOperationalPackageState: async () => ({ allowed: true, supplierRouteSnapshot: routeSnapshot }),
        validateFulfilmentInput: async ({ customerInput }) => ({ allowed: true, normalisedFulfilmentInput: customerInput }),
        validatePaymentMethod: async () => ({ allowed: true, paymentSnapshot: { paymentMethodId: "myanmyanpay_mmqr", paymentChannel: "MYANMYANPAY_MMQR", provider: "MYANMYANPAY", nextAction: "OPEN_PROVIDER_PAYMENT" }, nextAction: "OPEN_PROVIDER_PAYMENT" }),
        validatePromotionRedemption: async () => ({ allowed: true }),
        transactionRunner: async callback => callback({ mongoSession: "fixture" }),
        createOrderRecord: async ({ orderSnapshot }) => { storedOrder = structuredClone(orderSnapshot); return storedOrder; },
        markQuoteUsed: async () => ({ outcome: "success" })
    });
    assert.strictEqual(result.checkout.pricing.currency, "MMK");
    assert.strictEqual(result.checkout.pricing.totalAmount, PRICE_MMK);
    assert.strictEqual(storedOrder.commercial.currency, "MMK");
    assert.strictEqual(storedOrder.commercial.totalAmount, PRICE_MMK);
    assert.notStrictEqual(storedOrder.fulfilment.routeSnapshot, routeSnapshot, "Order must persist an immutable copy of the selected route");
    assert.strictEqual(storedOrder.fulfilment.routeSnapshot.supplierMappingId, MAPPING_ID);
    assert.strictEqual(storedOrder.fulfilment.routeSnapshot.supplierId, SUPPLIER_ID);
    assert.strictEqual(storedOrder.fulfilment.routeSnapshot.supplierCode, "FAZERCARDS");
    assert.strictEqual(storedOrder.fulfilment.routeSnapshot.customerMarket, "MM");
    assert.strictEqual(storedOrder.fulfilment.routeSnapshot.supplierProductCode, mapping.supplierProductCode);
    assert.strictEqual(storedOrder.fulfilment.routeSnapshot.supplierPackageCode, mapping.supplierPackageCode);
    assert.strictEqual(storedOrder.fulfilment.routeSnapshot.fulfillmentContract.fingerprint, mapping.mappingMetadata.fulfillmentContract.fingerprint);
    assert.strictEqual(storedOrder.fulfilment.routeSnapshot.supplierMarket, "GLOBAL", "Supplier destination must not be derived from MMK currency");
}

(async () => {
    configureFixtureEnvironment();
    const publication = await verifyAdminSellingOnWrite();
    const mapping = await verifyPublishedPackageBecomesLive(publication);
    await verifyMmkCheckoutFreezesRoute(mapping);
    console.log(JSON.stringify({ result: "PASS", market: "MM", currency: "MMK", amount: PRICE_MMK, publicationWrites: "fixture-only", productionWrites: 0, providerCalls: 0, supplierSubmissions: 0, frozenSupplierMappingId: MAPPING_ID }, null, 2));
})().catch(error => {
    console.error("VERIFY_MM_CONTROLLED_PACKAGE_PUBLICATION_FAILED:", error.stack || error, error.causeCode || "", error.metadata || error.details || "");
    process.exitCode = 1;
}).finally(restoreEnvironment);
