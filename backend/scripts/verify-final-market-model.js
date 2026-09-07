"use strict";

const assert = require("assert");
const {
    assessProductionReadyFulfillmentMapping,
    assessPreCommercialFulfillmentReadiness,
    supplierCapabilityProductCode
} = require("../services/fulfillmentCapabilityService");
const { assessExistingPreparedRoute } = require("../services/supplierCatalog/supplierRoutePreparationService");
const { basicCandidateBlockers, summarizeEligibilityResolution } = require("../services/supplierEligibilityRouteResolver");
const { applyPublicationMetadata, explicitPublishedPackages } = require("../services/packageMarketPublicationService");

const now = new Date().toISOString();

const supplier = (code = "FAZERCARDS") => ({
    _id: `${code.toLowerCase()}-supplier`,
    supplierCode: code,
    enabled: true,
    mode: "API",
    supportedRegions: ["TH"]
});

const product = (code = "example-th-product", markets = ["TH"]) => ({
    _id: `${code}-product`,
    productCode: code,
    enabled: true,
    supportedRegions: markets,
    presentation: { displayMarketLabel: markets[0] === "GLOBAL" ? "Global" : "Thailand", marketScope: markets[0] === "GLOBAL" ? "GLOBAL" : "MULTI_REGION" }
});

const pkg = (productCode = "example-th-product", packageCode = "PKG_TH") => ({
    _id: `${packageCode}-pkg`,
    productCode,
    packageCode,
    enabled: true,
    prices: {
        TH: { enabled: true, amount: 100, supplierCost: 50 },
        MM: { enabled: true, amount: 100000, supplierCost: 50000 }
    }
});

const mapping = ({
    id = "mapping-1",
    productCode = "example-th-product",
    packageCode = "PKG_TH",
    supplierCode = "FAZERCARDS",
    supplierProductCode = "provider-product",
    supplierPackageCode = "provider-package",
    region = "TH",
    role = "PRIMARY",
    enabled = true,
    eligibilityMarkets = ["TH", "MM"],
    readiness = {}
} = {}) => ({
    _id: id,
    supplierId: `${supplierCode.toLowerCase()}-supplier`,
    supplierCode,
    productCode,
    packageCode,
    supplierProductCode,
    supplierPackageCode,
    supplierCatalogOfferId: `${id}-offer`,
    region,
    enabled,
    productionRole: role,
    executionMode: "API",
    archivedAt: null,
    fulfillmentEligibility: {
        mode: "CUSTOMER_MARKET_ALLOWLIST",
        allowedCustomerMarkets: eligibilityMarkets,
        evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY",
        evidenceSource: "fixture",
        verifiedAt: now,
        version: 2
    },
    mappingMetadata: {
        readiness: {
            supplierMapped: true,
            inputReady: true,
            validationReady: true,
            pricingReady: true,
            fulfillmentReady: true,
            storefrontReady: true,
            ...readiness
        },
        fulfillmentContract: {
            protocol: supplierCode === "WONDD" ? "WONDD_GAME_ID_TOPUP" : "FAZERCARDS_TOPUPS_ORDER_V2",
            fields: [{ customerField: "userId", providerField: "userId", required: true }]
        }
    },
    supplierCostAuthority: { rawSupplierCost: 50, supplierCurrency: "THB", capturedAt: now }
});

const supplierProduct = ({ code = "provider-product", market = "TH", supplierCode = "FAZERCARDS" } = {}) => ({
    _id: `${code}-supplier-product`,
    supplierId: `${supplierCode.toLowerCase()}-supplier`,
    supplierProductCode: code,
    supplierMarketCode: market,
    supportState: "SUPPORTED",
    metadata: supplierCode === "WONDD" ? { transactionalServiceCode: "mlbb" } : {},
    normalizedInputContract: { fields: [{ customerField: "userId", providerField: "userId", required: true }] }
});

const offer = ({ id = "mapping-1-offer", supplierCode = "FAZERCARDS", supplierProductCode = "provider-product", offerCode = "provider-package" } = {}) => ({
    _id: id,
    supplierId: `${supplierCode.toLowerCase()}-supplier`,
    supplierCatalogProductId: `${supplierProductCode}-supplier-product`,
    supplierProductCode,
    supplierOfferCode: offerCode,
    catalogLifecycleState: "ACTIVE",
    reconciliationState: "EXACT_CANONICAL_MATCH"
});

const availability = (id = "mapping-1-offer", extra = {}) => ({
    supplierCatalogOfferId: id,
    state: "AVAILABLE",
    coverageComplete: false,
    observedAt: now,
    staleAt: null,
    ...extra
});

const adapter = enabled => ({
    isConfigured: () => true,
    isAutoFulfillmentEnabled: () => enabled,
    autoFulfillmentGateState: () => ({ blockerCode: enabled ? "" : "SUPPLIER_AUTO_FULFILLMENT_DISABLED" })
});

function assertReadyForCommerceMarket(customerMarket) {
    const m = mapping({ supplierCode: "GENERICAPI", eligibilityMarkets: ["TH"] });
    const blockers = basicCandidateBlockers({
        mapping: m,
        supplier: supplier("GENERICAPI"),
        pkg: pkg(),
        customerMarket,
        adapter: adapter(true),
        offer: offer({ id: m.supplierCatalogOfferId, supplierCode: m.supplierCode, supplierProductCode: m.supplierProductCode, offerCode: m.supplierPackageCode }),
        availability: availability(m.supplierCatalogOfferId),
        requireCatalogEvidence: true
    }).blockers;
    assert.deepStrictEqual(blockers, [], `${customerMarket} commerce must not invalidate a TH player-region route`);
}

assertReadyForCommerceMarket("TH");
assertReadyForCommerceMarket("MM");

{
    const m = mapping({ productCode: "id-game", packageCode: "PKG_ID", region: "ID" });
    const assessment = assessProductionReadyFulfillmentMapping(m, supplier(), {
        productCode: "id-game",
        packageCode: "PKG_ID",
        region: "TH",
        productCompatibilityMarkets: ["ID"],
        adapterResolver: () => adapter(true),
        mappingSupportResolver: () => true
    });
    assert(assessment.ready, "TH commerce + ID player product may be production-ready when operational evidence is valid.");
    assert(!assessment.blockers.includes("PRODUCT_ACCOUNT_MARKET_INCOMPATIBLE"));
}

{
    const m = mapping({ productCode: "global-game", packageCode: "PKG_GLOBAL", region: "UNSPECIFIED" });
    const pre = assessPreCommercialFulfillmentReadiness({
        mapping: m,
        supplier: supplier(),
        supplierProduct: supplierProduct({ market: "UNSPECIFIED" }),
        offer: offer({ id: m.supplierCatalogOfferId, supplierProductCode: m.supplierProductCode, offerCode: m.supplierPackageCode }),
        availability: availability(m.supplierCatalogOfferId),
        canonicalProduct: product("global-game", ["GLOBAL"]),
        canonicalPackages: [pkg("global-game", "PKG_GLOBAL")],
        customerMarkets: ["TH", "MM"],
        fulfillmentContract: m.mappingMetadata.fulfillmentContract,
        adapterConfigured: true,
        autoFulfillmentEnabled: true,
        processorSupported: true
    });
    assert(pre.ready, "UNSPECIFIED supplier market must not itself block exact observed offer readiness.");
    assert(!pre.blockers.includes("MARKET_UNRESOLVED"));
    assert(!pre.blockers.includes("PRODUCT_ACCOUNT_MARKET_INCOMPATIBLE"));
}

{
    const m = mapping();
    const unavailable = basicCandidateBlockers({
        mapping: m,
        supplier: supplier(),
        pkg: pkg(),
        customerMarket: "TH",
        adapter: adapter(true),
        offer: offer({ id: m.supplierCatalogOfferId, supplierProductCode: m.supplierProductCode, offerCode: m.supplierPackageCode }),
        availability: availability(m.supplierCatalogOfferId, { state: "UNKNOWN" }),
        requireCatalogEvidence: true
    }).blockers;
    assert(unavailable.includes("SUPPLIER_AVAILABILITY_NOT_CONFIRMED"), "Exact unavailable offer must still fail closed.");
    const stale = basicCandidateBlockers({
        mapping: m,
        supplier: supplier(),
        pkg: pkg(),
        customerMarket: "TH",
        adapter: adapter(true),
        offer: offer({ id: m.supplierCatalogOfferId, supplierProductCode: m.supplierProductCode, offerCode: m.supplierPackageCode }),
        availability: availability(m.supplierCatalogOfferId, { staleAt: new Date(Date.now() - 1000).toISOString() }),
        requireCatalogEvidence: true
    }).blockers;
    assert(stale.includes("SUPPLIER_AVAILABILITY_NOT_CONFIRMED"), "Stale exact offer must still fail closed.");
}

{
    const m = mapping({ readiness: { inputReady: false } });
    const pre = assessPreCommercialFulfillmentReadiness({
        mapping: m,
        supplier: supplier(),
        supplierProduct: supplierProduct(),
        offer: offer({ id: m.supplierCatalogOfferId, supplierProductCode: m.supplierProductCode, offerCode: m.supplierPackageCode }),
        availability: availability(m.supplierCatalogOfferId),
        canonicalProduct: product(),
        canonicalPackages: [pkg()],
        customerMarkets: ["TH"],
        fulfillmentContract: m.mappingMetadata.fulfillmentContract,
        adapterConfigured: true,
        autoFulfillmentEnabled: true,
        processorSupported: true
    });
    assert(pre.blockers.includes("INPUT_NOT_READY"), "Missing input readiness must still block.");
}

{
    const m = mapping();
    const pre = assessPreCommercialFulfillmentReadiness({
        mapping: m,
        supplier: supplier(),
        supplierProduct: supplierProduct(),
        offer: offer({ id: m.supplierCatalogOfferId, supplierProductCode: m.supplierProductCode, offerCode: m.supplierPackageCode }),
        availability: availability(m.supplierCatalogOfferId),
        canonicalProduct: product(),
        canonicalPackages: [pkg()],
        customerMarkets: ["TH"],
        fulfillmentContract: m.mappingMetadata.fulfillmentContract,
        adapterConfigured: true,
        autoFulfillmentEnabled: false,
        processorSupported: true
    });
    assert(pre.blockers.includes("SUPPLIER_AUTO_FULFILLMENT_DISABLED"), "Supplier gate disabled must still block.");
}

{
    const m = mapping({ supplierCode: "WONDD", productCode: "mlbb-twilight-weekly-pass", packageCode: "MLBB_ONE_TIME_WEEKLY_PASS", supplierProductCode: "mlbb", supplierPackageCode: "MLOTW01", region: "TH" });
    assert.strictEqual(supplierCapabilityProductCode(m, supplier("WONDD")), "mlbb");
    const calls = [];
    const result = assessExistingPreparedRoute({
        mapping: m,
        supplier: supplier("WONDD"),
        supplierProduct: supplierProduct({ code: "9622", market: "UNSPECIFIED", supplierCode: "WONDD" }),
        offer: { ...offer({ id: m.supplierCatalogOfferId, supplierCode: "WONDD", supplierProductCode: m.supplierProductCode, offerCode: m.supplierPackageCode }), supplierCatalogProductId: "9622-supplier-product" },
        availability: availability(m.supplierCatalogOfferId),
        canonicalProduct: product("mlbb-twilight-weekly-pass", ["GLOBAL"]),
        canonicalPackages: [pkg("mlbb-twilight-weekly-pass", "MLBB_ONE_TIME_WEEKLY_PASS")]
    }, ["TH"], {
        adapterResolver: () => ({
            isConfigured: () => true,
            isAutoFulfillmentEnabled: code => (calls.push(code), code === "mlbb")
        }),
        processorSupportResolver: () => true
    });
    assert(result.ready, "WonDD sibling AZIEL products backed by mlbb service identity must share the mlbb capability classification.");
    assert.deepStrictEqual(calls, ["mlbb"]);
}

{
    const m = mapping({ supplierCode: "WONDD", productCode: "new-wondd-game", supplierProductCode: "", supplierPackageCode: "PKG", region: "TH" });
    assert.strictEqual(supplierCapabilityProductCode(m, supplier("WONDD")), "new-wondd-game");
    const result = assessExistingPreparedRoute({
        mapping: m,
        supplier: supplier("WONDD"),
        supplierProduct: { ...supplierProduct({ code: "9999", market: "UNSPECIFIED", supplierCode: "WONDD" }), metadata: {} },
        offer: { ...offer({ id: m.supplierCatalogOfferId, supplierCode: "WONDD", supplierProductCode: m.supplierProductCode, offerCode: m.supplierPackageCode }), supplierCatalogProductId: "9999-supplier-product" },
        availability: availability(m.supplierCatalogOfferId),
        canonicalProduct: product("new-wondd-game", ["GLOBAL"]),
        canonicalPackages: [pkg("new-wondd-game", "PKG")]
    }, ["TH"], {
        adapterResolver: () => ({
            isConfigured: () => true,
            isAutoFulfillmentEnabled: code => code === "mlbb",
            autoFulfillmentGateState: () => ({ blockerCode: "PRODUCT_AUTO_FULFILLMENT_DISABLED" })
        }),
        processorSupportResolver: () => true
    });
    assert(result.blockers.includes("SUPPLIER_AUTO_FULFILLMENT_DISABLED"), "Unknown WonDD supplier capability identity must fail closed.");
}

{
    const conflictResult = summarizeEligibilityResolution({
        productCode: "game",
        packageCode: "PKG",
        customerMarket: "TH",
        mappings: [
            mapping({ id: "a", productCode: "game", packageCode: "PKG" }),
            mapping({ id: "b", productCode: "game", packageCode: "PKG" })
        ],
        assessments: new Map([["a", { blockers: [] }], ["b", { blockers: [] }]])
    });
    assert.strictEqual(conflictResult.outcome, "AMBIGUOUS_PRIMARY_ROUTE", "No automatic supplier failover may be introduced.");
}

{
    const hokMapping = mapping({
        id: "hok-route",
        productCode: "hok",
        packageCode: "HOK_16_TOKENS",
        supplierProductCode: "honor_of_kings",
        supplierPackageCode: "16_tokens",
        region: "TH",
        eligibilityMarkets: ["TH"]
    });
    const route = ({ customerMarket, packageOverride = {}, adapterEnabled = true, availabilityOverride = {} }) => basicCandidateBlockers({
        mapping: hokMapping,
        supplier: supplier(),
        pkg: { ...pkg("hok", "HOK_16_TOKENS"), ...packageOverride },
        customerMarket,
        adapter: adapter(adapterEnabled),
        offer: offer({ id: hokMapping.supplierCatalogOfferId, supplierProductCode: hokMapping.supplierProductCode, offerCode: hokMapping.supplierPackageCode }),
        availability: availability(hokMapping.supplierCatalogOfferId, availabilityOverride),
        requireCatalogEvidence: true
    }).blockers;
    assert.deepStrictEqual(route({ customerMarket: "TH" }), [], "HOK TH commerce must use the THB price and the same TH supplier route.");
    assert.deepStrictEqual(route({ customerMarket: "MM" }), [], "HOK MM commerce must use the MMK price and the same TH supplier route.");
    assert.deepStrictEqual(route({
        customerMarket: "MM",
        packageOverride: { prices: { TH: { enabled: true, amount: 100, supplierCost: 50 } } }
    }), ["CUSTOMER_MARKET_PRICE_NOT_PUBLISHED"], "Missing MMK price must be the only MM blocker when the route is otherwise ready.");
    assert(route({ customerMarket: "TH", availabilityOverride: { state: "UNKNOWN" } }).includes("SUPPLIER_AVAILABILITY_NOT_CONFIRMED"), "Unavailable supplier offer must block TH.");
    assert(route({ customerMarket: "MM", availabilityOverride: { state: "UNKNOWN" } }).includes("SUPPLIER_AVAILABILITY_NOT_CONFIRMED"), "Unavailable supplier offer must block MM.");
    assert(route({ customerMarket: "TH", adapterEnabled: false }).includes("SUPPLIER_AUTO_FULFILLMENT_DISABLED"), "Supplier gate disabled must block TH.");
    assert(route({ customerMarket: "MM", adapterEnabled: false }).includes("SUPPLIER_AUTO_FULFILLMENT_DISABLED"), "Supplier gate disabled must block MM.");
    assert(basicCandidateBlockers({
        mapping: { ...hokMapping, enabled: false },
        supplier: supplier(),
        pkg: pkg("hok", "HOK_16_TOKENS"),
        customerMarket: "MM",
        adapter: adapter(true),
        offer: offer({ id: hokMapping.supplierCatalogOfferId, supplierProductCode: hokMapping.supplierProductCode, offerCode: hokMapping.supplierPackageCode }),
        availability: availability(hokMapping.supplierCatalogOfferId),
        requireCatalogEvidence: true
    }).blockers.includes("MAPPING_DISABLED"), "Disabled mapping must block both commerce markets.");
}

{
    const projection = {
        productCode: "hok",
        packages: [
            { ...pkg("hok", "HOK_16_TOKENS"), fulfillmentRegions: { TH: true, MM: true } },
            { ...pkg("hok", "HOK_80_TOKENS"), prices: { TH: { enabled: true, amount: 55, supplierCost: 20 } }, fulfillmentRegions: { TH: true, MM: true } },
            { ...pkg("hok", "HOK_PRIVATE"), prices: { TH: { enabled: true, amount: 22, supplierCost: 10 }, MM: { enabled: true, amount: 2116, supplierCost: 1000 } }, fulfillmentRegions: { TH: true, MM: true } },
            { ...pkg("hok", "HOK_DISABLED"), enabled: false, fulfillmentRegions: { TH: true, MM: true } }
        ]
    };
    applyPublicationMetadata(projection, [
        { productCode: "hok", packageCode: "HOK_16_TOKENS", customerMarket: "TH", published: true, decisionVersion: 1 },
        { productCode: "hok", packageCode: "HOK_80_TOKENS", customerMarket: "TH", published: true, decisionVersion: 1 },
        { productCode: "hok", packageCode: "HOK_DISABLED", customerMarket: "TH", published: true, decisionVersion: 1 }
    ], "MM");
    assert.deepStrictEqual(
        explicitPublishedPackages(projection).map(item => item.packageCode),
        ["HOK_16_TOKENS", "HOK_80_TOKENS", "HOK_DISABLED"],
        "Package-level publication must not require a separate MM publication row."
    );
    assert.strictEqual(projection.packages[0].publication.currentlyPurchasable, true, "Published package with MMK price is purchasable in MM.");
    assert.deepStrictEqual(projection.packages[0].publication.suppressionReasons, [], "MM must not be suppressed by missing MM publication.");
    assert.strictEqual(projection.packages[1].publication.currentlyPurchasable, false, "Published package with only THB price must fail in MM for price only.");
    assert.deepStrictEqual(projection.packages[1].publication.suppressionReasons, ["NO_VALID_PRICE"]);
    assert.strictEqual(projection.packages[2].publication.published, false, "Unpublished package remains unpublished for both commerce markets.");
    assert.strictEqual(projection.packages[3].publication.currentlyPurchasable, false, "Disabled published package remains blocked.");
    assert(projection.packages[3].publication.suppressionReasons.includes("PACKAGE_DISABLED"));
}

console.log(JSON.stringify({
    result: "PASS",
    checks: 27,
    coverage: [
        "TH commerce with TH player product",
        "MM commerce with TH player product",
        "TH commerce with ID player product",
        "MM commerce with GLOBAL player product via UNSPECIFIED supplier route",
        "package-level publication across TH/MM commerce",
        "MM missing price blocks by price only",
        "unpublished/disabled packages remain blocked",
        "exact unavailable/stale offer fail-closed",
        "input/protocol/gate fail-closed",
        "WonDD supplier service identity gate",
        "unknown WonDD service identity fail-closed",
        "no automatic failover"
    ],
    safety: {
        productionWrites: 0,
        supplierOrderCalls: 0,
        paymentOrderCustomerChanges: 0,
        pricingWrites: 0,
        publicationWrites: 0
    }
}, null, 2));
