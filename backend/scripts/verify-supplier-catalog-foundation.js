"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { isDeepStrictEqual } = require("util");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Run = require("../models/SupplierCatalogIngestionRun");
const fixtures = require("../fixtures/supplierCatalogPhase2B");
const utils = require("../services/supplierCatalog/supplierCatalogNormalization");

function hasIndex(Model, fields, unique = false) {
    return Model.schema.indexes().some(([keys, options]) => isDeepStrictEqual(keys, fields) && Boolean(options.unique) === unique);
}

function verify() {
    let checks = 0;
    const check = (condition, message) => { assert(condition, message); checks += 1; };
    const supplierId = new mongoose.Types.ObjectId();
    const productId = new mongoose.Types.ObjectId();
    const offerId = new mongoose.Types.ObjectId();
    const observedAt = new Date(fixtures.OBSERVED_AT);
    const raw = { name: "42 Diamonds", price_usd: 0.7 };
    const hash = utils.hashSupplierCatalogSnapshot(raw);

    check(hasIndex(Product, { supplierId: 1, catalogNamespace: 1, supplierProductCode: 1 }, true), "Product composite identity index missing.");
    check(hasIndex(Offer, { supplierId: 1, catalogNamespace: 1, supplierProductCode: 1, supplierOfferCode: 1 }, true), "Offer composite identity index missing.");
    check(hasIndex(Availability, { supplierCatalogOfferId: 1 }, true), "Offer availability unique index missing.");
    check(hasIndex(Run, { supplierId: 1, catalogNamespace: 1, runKey: 1 }, true), "Run-key unique index missing.");
    for (const [Model, fields, label] of [
        [Product, { supplierId: 1, supplierMarketCode: 1, supportState: 1 }, "product market/support"],
        [Product, { lastObservedAt: 1 }, "product observation"],
        [Product, { rawSnapshotHash: 1 }, "product hash"],
        [Offer, { supplierCatalogProductId: 1, catalogLifecycleState: 1 }, "offer lifecycle"],
        [Offer, { supplierId: 1, reconciliationState: 1 }, "offer reconciliation"],
        [Offer, { lastObservedAt: 1 }, "offer observation"],
        [Offer, { rawSnapshotHash: 1 }, "offer hash"],
        [Availability, { state: 1, staleAt: 1 }, "availability state"],
        [Availability, { observedAt: 1 }, "availability observation"],
        [Availability, { observationRunId: 1 }, "availability run"],
        [Run, { supplierId: 1, startedAt: -1 }, "supplier run history"],
        [Run, { status: 1, startedAt: 1 }, "run status"]
    ]) check(hasIndex(Model, fields), `${label} index missing.`);

    const productIdentity = utils.normalizeSupplierProductIdentity({ supplierId, ...fixtures.products.fazerMlbb });
    const offerIdentity = utils.normalizeSupplierOfferIdentity({ ...productIdentity, supplierOfferCode: fixtures.offers.mlbbOrdinary.supplierOfferCode });
    check(productIdentity.key.includes("mobile_legends_global"), "Supplier product identity must retain provider code.");
    check(offerIdentity.key.endsWith("42_diamonds"), "Supplier offer identity must retain provider offer code.");
    check(!Object.hasOwn(offerIdentity, "packageCode"), "Foundation identity must not manufacture canonical package identity.");

    const first = utils.observationTimestamps({}, observedAt, { changed: true });
    const second = utils.observationTimestamps(first, new Date(observedAt.getTime() + 1000), { changed: false });
    check(+second.firstSeenAt === +first.firstSeenAt, "firstSeenAt must be preserved.");
    check(+second.lastSeenAt > +first.lastSeenAt && +second.lastObservedAt > +first.lastObservedAt, "Observation timestamps must advance.");
    check(+second.lastChangedAt === +first.lastChangedAt, "Identical observation must not churn lastChangedAt.");

    check(hash === utils.hashSupplierCatalogSnapshot({ price_usd: 0.7, name: "42 Diamonds" }), "Canonical hash must be key-order stable.");
    check(hash !== utils.hashSupplierCatalogSnapshot({ ...raw, price_usd: 0.71 }), "Changed payload must change hash.");
    const sanitized = utils.sanitizeSupplierCatalogSnapshot({ offer: raw, Authorization: "Bearer secret", password: "secret", nested: { api_key: "secret", safe: true } });
    check(!JSON.stringify(sanitized.snapshot).includes("secret") && sanitized.truncation.reasons.includes("SENSITIVE_KEY_FILTERED"), "Snapshot sanitizer must remove secrets.");
    const oversized = utils.sanitizeSupplierCatalogSnapshot({ text: "x".repeat(utils.MAX_RAW_SNAPSHOT_BYTES * 2) }, { maxStringLength: utils.MAX_RAW_SNAPSHOT_BYTES * 2 });
    check(oversized.serializedBytes <= utils.MAX_RAW_SNAPSHOT_BYTES && oversized.truncation.reasons.includes("BYTE_LIMIT"), "Snapshot byte limit must be enforced.");
    check(oversized.truncation.truncated === true, "Truncation metadata must be preserved.");

    check(utils.normalizeSupplierMarketCode("TH", { evidenceProvided: false }) === "UNSPECIFIED", "THB cost or legacy TH context must not infer supplier market.");
    check(utils.normalizeSupplierMarketCode(fixtures.products.wonddMlbb.metadata.supplierCurrency, { evidenceProvided: false }) === "UNSPECIFIED", "WonDD THB cost must not infer TH market.");
    check(utils.normalizeSupplierMarketCode("", { evidenceProvided: false }) === fixtures.products.fazerHok.supplierMarketCode, "FazerCards HOK must remain UNSPECIFIED.");
    check(utils.normalizeSupplierMarketCode("global", { evidenceProvided: true }) === "GLOBAL" && utils.normalizeSupplierMarketCode("th", { evidenceProvided: true }) === "TH", "Provider-owned market evidence must normalize explicitly.");

    const bonus = utils.normalizeOfferSemantics(fixtures.offers.mlbbBonus.semantics);
    const flat = utils.normalizeOfferSemantics(fixtures.offers.mlbbFlat.semantics);
    check(bonus.baseAmount === 78 && bonus.bonusAmount === 8 && flat.baseAmount === 86 && flat.bonusAmount === 0, "Base/bonus semantics must remain distinct.");
    check(JSON.stringify(bonus) !== JSON.stringify(flat), "78+8 must not become equivalent to flat 86.");
    const weekly = utils.normalizeOfferSemantics(fixtures.offers.weeklyPass.semantics);
    const oneTime = utils.normalizeOfferSemantics(fixtures.offers.oneTimeWeekly.semantics);
    check(weekly.passType !== oneTime.passType && weekly.repeatability !== oneTime.repeatability, "Weekly Pass and One-Time Weekly Pass must remain distinct.");

    const product = new Product({ supplierId, catalogNamespace: "TOPUP", supplierProductCode: "mobile_legends_global", supplierMarketCode: "GLOBAL", supportState: "DISCOVERED", ...first, rawSnapshotHash: hash, rawSnapshot: raw });
    check(!product.validateSync(), "SupplierCatalogProduct fixture must validate.");
    const offer = new Offer({ supplierCatalogProductId: productId, supplierId, catalogNamespace: "TOPUP", supplierProductCode: "mobile_legends_global", supplierOfferCode: "42_diamonds", supplierCost: utils.normalizeSupplierCost(fixtures.offers.mlbbOrdinary.price), normalizedSemantics: utils.normalizeOfferSemantics(fixtures.offers.mlbbOrdinary.semantics), ...first, rawSnapshotHash: hash, rawSnapshot: raw });
    check(!offer.validateSync(), "SupplierCatalogOffer fixture must validate without mapping/publication fields.");
    check(offer.supplierCost.amount === 0.7 && !Object.hasOwn(offer.toObject(), "prices"), "Observed supplier cost must not create retail pricing.");
    const availability = new Availability({ supplierCatalogOfferId: offerId, observedAt, coverageComplete: false });
    check(!availability.validateSync() && availability.state === "UNKNOWN", "UNKNOWN availability must be the safe default.");
    const partial = new Run({ supplierId, catalogNamespace: "TOPUP", runKey: "fixture-revision-1", status: "SUCCEEDED_PARTIAL", coverageState: "PARTIAL", startedAt: observedAt, completedAt: observedAt, missingOffers: 0, errors: [{ category: "honor_of_kings", code: "TIMEOUT" }] });
    check(!partial.validateSync() && partial.coverageState === "PARTIAL" && availability.state === "UNKNOWN", "Partial run must be representable without marking missing offers unavailable.");
    check(![...Object.keys(Product.schema.paths), ...Object.keys(Offer.schema.paths)].some(path => /^(published|public|storefrontReady|packageCode|productionRole|fulfillmentEligibility)$/.test(path)), "Catalog models must not own publication, canonical identity, role, or eligibility.");
    check(!Offer.schema.paths.supplierCost.options.authoritativeForPricing, "Observed offer cost must not become pricing authority.");
    check(fixtures.products.fazerMlbb.supplierMarketCode === "GLOBAL" && fixtures.products.fazerPubg.supplierMarketCode === "GLOBAL" && fixtures.products.fazerFreefire.supplierMarketCode === "TH" && fixtures.products.fazerValorant.supplierMarketCode === "TH", "Provider market fixtures must preserve explicit evidence.");

    console.log(JSON.stringify({ result: "PASS", checks, databaseConnections: 0, databaseWrites: 0, supplierCalls: 0, mappingCreations: 0, publicationWrites: 0, retailPriceWrites: 0 }, null, 2));
}

verify();
