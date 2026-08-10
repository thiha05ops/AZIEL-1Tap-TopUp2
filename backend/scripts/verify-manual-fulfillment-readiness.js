const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { projectCommerceReadiness, applyPublicReadiness } = require("../services/catalogService");
const { resolveFulfillmentCapability } = require("../services/fulfillmentCapabilityService");
const { ensurePaidOrderFulfillmentWork } = require("../services/paidFulfillmentRoutingService");
const { assertAuthoritativeFulfillmentReady } = require("../services/commerce/customerManualPromptPayCheckoutService");

const product = {
    productCode: "mlbb",
    enabled: true,
    publicDiscoveryEnabled: true,
    commerceState: "PURCHASABLE",
    lifecycleStatus: "ACTIVE",
    supportedRegions: ["MM", "TH"],
    productRoute: "mlbb.html",
    productKnowledge: { shortDescription: "A sufficiently meaningful product description for readiness.", faq: [{}] },
    fulfillment: { manualAllowedRegions: ["MM", "TH"] },
    seo: { title: "MLBB", description: "MLBB top up" },
    artworkPath: "/mlbb.webp"
};
const pkg = { _id: "pkg1", productCode: "mlbb", packageCode: "MLBB_1", enabled: true, deletedAt: null, customerNote: "note", prices: { MM: { amount: 1000, enabled: true }, TH: { amount: 30, enabled: true } } };
const supplier = { _id: "supplier1", enabled: true, mode: "API", supportedRegions: ["MM", "TH"] };
const apiMapping = { supplierId: "supplier1", productCode: "mlbb", packageCode: "MLBB_1", region: "MM", enabled: true, executionMode: "API" };

function publicStateFor(testProduct, packages, mappings) {
    const commerce = projectCommerceReadiness(testProduct, packages, mappings, []);
    const projection = {};
    applyPublicReadiness(projection, testProduct, packages, commerce);
    return { commerce, projection };
}

(async () => {
    // A: manual only.
    assert.equal(publicStateFor(product, [pkg], []).projection.publicReadiness.regions.MM.state, "AVAILABLE");
    // B: manual plus mapping.
    assert.equal(publicStateFor(product, [pkg], [apiMapping]).projection.publicReadiness.regions.MM.state, "AVAILABLE");
    // C: automated only.
    const noManual = { ...product, fulfillment: { manualAllowedRegions: [] } };
    assert.equal(publicStateFor(noManual, [pkg], [apiMapping]).projection.publicReadiness.regions.MM.state, "AVAILABLE");
    // D: no route.
    assert.equal(publicStateFor(noManual, [pkg], []).projection.publicReadiness.regions.MM.state, "COMING_SOON");

    const manualCapability = resolveFulfillmentCapability({ product, mappings: [], suppliers: [], productCode: "mlbb", packageCode: "MLBB_1", region: "MM" });
    const automatedCapability = resolveFulfillmentCapability({ product: noManual, mappings: [apiMapping], suppliers: [supplier], productCode: "mlbb", packageCode: "MLBB_1", region: "MM" });
    assert(manualCapability.fulfillmentAvailable && manualCapability.manualAdminAllowed);
    assert(automatedCapability.fulfillmentAvailable && automatedCapability.automatedAvailable);

    // E/F: checkout server defense.
    await assertAuthoritativeFulfillmentReady({ productCode: "mlbb", packageCode: "MLBB_1", region: "MM" }, { loadCapability: async () => manualCapability });
    await assert.rejects(
        assertAuthoritativeFulfillmentReady({ productCode: "telegram", packageCode: "TG_1", region: "MM" }, { loadCapability: async () => ({ fulfillmentAvailable: false }) }),
        error => error.code === "FULFILLMENT_UNAVAILABLE" && error.statusCode === 409
    );

    // G/H: paid manual-only order creates/reuses one work item.
    const attempts = new Map();
    let insertCount = 0;
    const attemptModel = { findOneAndUpdate: async (query, update) => {
        if (!attempts.has(query.idempotencyKey)) {
            insertCount += 1;
            attempts.set(query.idempotencyKey, { _id: "attempt1", ...update.$setOnInsert });
        }
        return attempts.get(query.idempotencyKey);
    } };
    const commerceOrderModel = { updateOne: async () => ({ acknowledged: true }) };
    const paidOrder = { _id: "orderObjectId", orderId: "AZL-1", schemaVersion: "1", commerce: { source: "QUOTE_CHECKOUT" }, product: { gameCode: "mlbb", packageCode: "MLBB_1", region: "MM" }, commercial: { region: "MM" }, paymentStatus: "paid" };
    const routingOptions = { attemptModel, commerceOrderModel, loadCapability: async () => manualCapability };
    const first = await ensurePaidOrderFulfillmentWork(paidOrder, routingOptions);
    const retry = await ensurePaidOrderFulfillmentWork(paidOrder, routingOptions);
    assert.equal(first.attempt.routeType, "MANUAL_ADMIN");
    assert.equal(first.attempt.supplierId, null);
    assert.equal(first.attempt.supplierMappingId, null);
    assert.equal(retry.attempt.fulfillmentId, first.attempt.fulfillmentId);
    assert.equal(insertCount, 1);

    // I: archived package stays excluded even with a stale mapping.
    assert.equal(publicStateFor(noManual, [{ ...pkg, deletedAt: new Date() }], [apiMapping]).projection.publicReadiness.regions.MM.state, "COMING_SOON");

    // J/K: shared Product Detail transition keeps AVAILABLE visible and COMING_SOON hidden.
    const root = path.resolve(__dirname, "../..");
    const stage = fs.readFileSync(path.join(root, "frontend/js/product-detail-stage.js"), "utf8");
    const css = fs.readFileSync(path.join(root, "frontend/css/game/product-detail-desktop.css"), "utf8");
    assert(stage.includes("orderLayout.hidden = false"));
    assert(stage.includes("orderLayout.hidden = true"));
    assert(css.includes(".az-product-detail [hidden]") && css.includes("display: none !important"));

    console.log("Manual fulfillment readiness A-K verification passed.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
