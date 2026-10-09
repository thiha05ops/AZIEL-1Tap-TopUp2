"use strict";

const assert = require("assert");
const { createSupplierCanonicalProductAuthorityService, deterministicProductCode, sourceLock } = require("../services/supplierCatalog/supplierCanonicalProductAuthorityService");

const h = char => char.repeat(64);
const now = new Date("2026-01-01T00:00:00.000Z");
const product = { _id: "sp1", supplierId: "s1", catalogNamespace: "FAZERCARDS", supplierProductCode: "NEW-GAME-1", supplierMarketCode: "GLOBAL", displayName: "Brand New Game", supportState: "SUPPORTED", sourceRevision: "product-v1", rawSnapshotHash: h("a"), lastChangedAt: now, metadata: {} };
const offers = [
    { _id: "o1", supplierCatalogProductId: "sp1", supplierId: "s1", catalogNamespace: "FAZERCARDS", supplierProductCode: "NEW-GAME-1", supplierOfferCode: "60", supplierOfferName: "60 Gems", catalogLifecycleState: "ACTIVE", reconciliationState: "NO_CANONICAL_PACKAGE", sourceRevision: "offer-v1", rawSnapshotHash: h("b"), lastChangedAt: now, normalizedSemantics: { denomination: 60 } },
    { _id: "o2", supplierCatalogProductId: "sp1", supplierId: "s1", catalogNamespace: "FAZERCARDS", supplierProductCode: "NEW-GAME-1", supplierOfferCode: "special", supplierOfferName: "First Cheer", catalogLifecycleState: "ACTIVE", reconciliationState: "AMBIGUOUS", sourceRevision: "offer-v1", rawSnapshotHash: h("c"), lastChangedAt: now }
];
const availability = offers.map((offer, index) => ({ supplierCatalogOfferId: offer._id, state: "AVAILABLE", coverageComplete: true, evidenceCode: "FIXTURE", observedAt: now, sourceRevision: `a${index}` }));
const state = { product: structuredClone(product), offers: structuredClone(offers), canonical: [], audits: [] };
const clone = value => value == null ? value : structuredClone(value);
const repos = {
    transaction: async fn => { const before = clone(state); try { return await fn({ test: true }); } catch (error) { Object.assign(state, before); throw error; } },
    productById: async value => id(value) === id(state.product) ? clone(state.product) : null,
    offersByProduct: async value => id(value) === id(state.product) ? clone(state.offers) : [],
    availabilityByOffers: async values => clone(availability.filter(item => values.map(id).includes(id(item.supplierCatalogOfferId)))),
    canonicalByCode: async code => clone(state.canonical.find(item => item.productCode === code)),
    canonicalBySourceProduct: async value => clone(state.canonical.find(item => id(item.metadata?.preparedFromSupplierCatalogProductId) === id(value))),
    auditForAuthority: async (productCode, supplierCatalogProductId, idempotencyKey) => clone(state.audits.find(item => item.resourceId === productCode && id(item.metadata?.supplierCatalogProductId) === id(supplierCatalogProductId) && item.metadata?.idempotencyKey === idempotencyKey)),
    createCanonical: async document => { const row = { _id: `cp${state.canonical.length + 1}`, ...clone(document) }; state.canonical.push(row); return clone(row); },
    updateProductAuthority: async (_productId, expectedHash, authority) => { if (state.product.rawSnapshotHash !== expectedHash || state.product.metadata.onboardingCanonicalProduct) return { modifiedCount: 0 }; state.product.metadata.onboardingCanonicalProduct = clone(authority); return { modifiedCount: 1 }; },
    createAudit: async document => { state.audits.push(clone(document)); return clone(document); }
};
const id = value => String(value?._id || value || "");
const actor = { id: "admin1", username: "owner", role: "OWNER" };
const service = createSupplierCanonicalProductAuthorityService({ repos, gate: () => true, clock: () => now });

(async () => {
    let checks = 0;
    const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };
    const plan = await service.plan("sp1");
    ok(plan.state === "NEW_TO_AZIEL", "new product identified");
    ok(plan.offers[0].state === "PREPARABLE" && plan.offers[1].state === "NEEDS_ATTENTION", "bounded safe/ambiguous wizard split");
    ok(plan.offers[0].disposition === "READY_TO_CREATE" && plan.offers[1].disposition === "REVIEW_REQUIRED", "internal authority disposition remains fail closed");
    ok(plan.canonical.productCode === deterministicProductCode(product), "deterministic code");
    const approvedOffers = [{ supplierCatalogOfferId: "o1", expectedSource: plan.offers[0].sourceLock }];
    const input = { supplierCatalogProductId: "sp1", confirmed: true, productCode: plan.canonical.productCode, name: plan.canonical.name, expectedSource: plan.product.sourceLock, approvedOffers, idempotencyKey: "new-game-1" };
    const created = await service.authorize(input, { actor, requestId: "r1" });
    ok(created.canonicalProduct.enabled === false && created.canonicalProduct.commerceState === "HIDDEN", "canonical product fail closed");
    ok(created.canonicalProduct.publicDiscoveryEnabled === false && created.canonicalProduct.homepageEnabled === false, "not customer visible");
    ok(state.product.metadata.onboardingCanonicalProduct.authoritative === true, "durable authority metadata");
    ok(state.product.metadata.onboardingCanonicalProduct.approvedOfferIds.join() === "o1", "explicit offer scope persisted");
    ok(state.audits.length === 1, "mandatory audit");
    const replay = await service.authorize(input, { actor, requestId: "r2" });
    ok(replay.idempotentReplay === true && state.canonical.length === 1 && state.audits.length === 1, "idempotent replay");
    const duplicate = Object.assign(new Error("duplicate key race"), { code: 11000 });
    const racingService = createSupplierCanonicalProductAuthorityService({ repos: { ...repos, transaction: async () => { throw duplicate; } }, gate: () => true, clock: () => now });
    const racingReplay = await racingService.authorize(input, { actor, requestId: "r-race" });
    ok(racingReplay.idempotentReplay === true && racingReplay.concurrentReplay === true && state.canonical.length === 1 && state.audits.length === 1, "duplicate-key loser verifies committed winner without duplicate audit");
    await assert.rejects(() => racingService.authorize({ ...input, idempotencyKey: "different-authority" }, { actor }), error => error.code === "CANONICAL_PRODUCT_IDENTITY_CONFLICT"); checks += 1;
    const collisionRepos = { ...repos, canonicalBySourceProduct: async () => null, canonicalByCode: async () => ({ _id: "other", productCode: input.productCode, metadata: { preparedFromSupplierCatalogProductId: "other-product" } }) };
    const collisionService = createSupplierCanonicalProductAuthorityService({ repos: { ...collisionRepos, transaction: async () => { throw duplicate; } }, gate: () => true, clock: () => now });
    await assert.rejects(() => collisionService.authorize(input, { actor }), error => error.code === "CANONICAL_PRODUCT_CODE_CONFLICT"); checks += 1;
    const staleState = { ...sourceLock(product), sourceHash: h("d") };
    await assert.rejects(() => service.authorize({ ...input, expectedSource: staleState }, { actor }), error => error.code === "SUPPLIER_PRODUCT_SOURCE_STALE"); checks += 1;
    const ambiguousPlan = await service.plan("sp1");
    await assert.rejects(() => service.authorize({ ...input, productCode: "different-code", approvedOffers: [{ supplierCatalogOfferId: "o2", expectedSource: ambiguousPlan.offers[1].sourceLock }] }, { actor }), error => ["CANONICAL_PRODUCT_CODE_OVERRIDE_REQUIRED", "ONBOARDING_OFFER_REVIEW_REQUIRED"].includes(error.code)); checks += 1;
    const disabled = createSupplierCanonicalProductAuthorityService({ repos, gate: () => false });
    await assert.rejects(() => disabled.authorize(input, { actor }), error => error.code === "SUPPLIER_PRODUCT_ONBOARDING_MUTATIONS_DISABLED"); checks += 1;
    console.log(JSON.stringify({ result: "PASS", checks, newCanonicalProducts: state.canonical.length, audits: state.audits.length, approvedOffers: 1, ambiguousExcluded: 1, productionWrites: 0 }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
