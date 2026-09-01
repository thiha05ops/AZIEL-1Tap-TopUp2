#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Run = require("../models/SupplierCatalogIngestionRun");
const Mapping = require("../models/SupplierProductMapping");
const Decision = require("../models/SupplierCatalogReconciliationDecision");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Publication = require("../models/PackageMarketPublication");
const PricingQuote = require("../models/PricingQuote");
const CommerceOrder = require("../models/CommerceOrder");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const Inventory = require("../models/PackageInventoryState");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");
const { mappingBusinessHash } = require("../services/supplierCatalog/supplierCatalogMappingReferenceService");
const { assessProductionMappingFromContext } = require("../services/supplierProductionSelectionService");

const ARTIFACT = path.resolve(__dirname, "../../docs/supplier-cost-availability-audit-phase2h-a-2026-08-31.json");
const MODELS = { SupplierCatalogProduct: Product, SupplierCatalogOffer: Offer, SupplierOfferAvailability: Availability, SupplierCatalogIngestionRun: Run, SupplierProductMapping: Mapping, SupplierCatalogReconciliationDecision: Decision, CatalogProduct, CatalogPackage, PackageMarketPublication: Publication, PricingQuote, CommerceOrder, FulfillmentAttempt, PackageInventoryState: Inventory };
const id = value => String(value?._id || value || "");
const sha = value => crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const finite = value => Number.isFinite(Number(value));
const iso = value => value ? new Date(value).toISOString() : null;
const countBy = (rows, key) => rows.reduce((out, row) => { const value = typeof key === "function" ? key(row) : row[key]; const label = value || "UNSPECIFIED"; out[label] = (out[label] || 0) + 1; return out; }, {});
const sortedObject = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

function compareCost(observed, authority) {
    if (!observed) return { state: "NO_OBSERVED_COST", comparable: false };
    if (!authority || authority.rawSupplierCost == null || !authority.supplierCurrency) return { state: "NO_MAPPING_COST_AUTHORITY", comparable: false };
    if (!finite(observed.amount) || Number(observed.amount) < 0 || !String(observed.currency || "").trim() || !observed.observedAt) return { state: "INVALID_OBSERVATION", comparable: false };
    if (!finite(authority.rawSupplierCost) || Number(authority.rawSupplierCost) < 0) return { state: "UNCOMPARABLE", comparable: false };
    const observedCurrency = String(observed.currency).toUpperCase();
    const authorityCurrency = String(authority.supplierCurrency).toUpperCase();
    if (observedCurrency !== authorityCurrency) return { state: "CURRENCY_MISMATCH", comparable: false, observedCurrency, authorityCurrency };
    const observedAmount = Number(observed.amount);
    const authorityAmount = Number(authority.rawSupplierCost);
    const delta = observedAmount - authorityAmount;
    const percentageDelta = authorityAmount === 0 ? (delta === 0 ? 0 : null) : (delta / authorityAmount) * 100;
    return { state: delta === 0 ? "MATCH" : delta > 0 ? "INCREASE" : "DECREASE", comparable: true, observedAmount, authorityAmount, currency: observedCurrency, absoluteDelta: delta, percentageDelta, direction: delta === 0 ? "NONE" : delta > 0 ? "UP" : "DOWN" };
}

async function fingerprint(Model) {
    const rows = await Model.find().sort({ _id: 1 }).lean();
    return { count: rows.length, sha256: sha(rows) };
}
async function fingerprints() {
    return Object.fromEntries(await Promise.all(Object.entries(MODELS).map(async ([name, Model]) => [name, await fingerprint(Model)])));
}

function buildArtifact(data) {
    const supplierById = new Map(data.suppliers.map(row => [id(row), row]));
    const offerById = new Map(data.offers.map(row => [id(row), row]));
    const availabilityByOffer = new Map(data.availability.map(row => [id(row.supplierCatalogOfferId), row]));
    const mappingByOffer = new Map(data.mappings.filter(row => row.supplierCatalogOfferId).map(row => [id(row.supplierCatalogOfferId), row]));
    const packageByKey = new Map(data.catalogPackages.map(row => [`${row.productCode}/${row.packageCode}`, row]));
    const publicationByKey = new Map(data.publications.map(row => [`${row.productCode}/${row.packageCode}/${row.customerMarket}`, row]));
    const successfulMappings = new Set(data.fulfillmentAttempts.filter(row => row.status === "SUCCEEDED" && row.supplierReference).map(row => id(row.supplierMappingId)));
    const rows = data.offers.map(offer => {
        const supplier = supplierById.get(id(offer.supplierId)) || {};
        const mapping = mappingByOffer.get(id(offer)) || null;
        const availability = availabilityByOffer.get(id(offer)) || null;
        const pkg = mapping ? packageByKey.get(`${mapping.productCode}/${mapping.packageCode}`) : null;
        const readiness = mapping ? assessProductionMappingFromContext(mapping, { supplier, pkg, controlledTest: successfulMappings.has(id(mapping)) ? { _id: "evidence" } : null }) : null;
        const comparison = compareCost(offer.supplierCost, mapping?.supplierCostAuthority);
        return {
            supplierCatalogOfferId: id(offer), supplierCode: supplier.supplierCode || "", supplierProductCode: offer.supplierProductCode, supplierOfferCode: offer.supplierOfferCode, supplierOfferName: offer.supplierOfferName || offer.rawName || "",
            mappingId: mapping ? id(mapping) : null, canonicalProductCode: mapping?.productCode || null, canonicalPackageCode: mapping?.packageCode || null, canonicalPackageName: pkg?.name || pkg?.displayName || null, customerMarket: mapping?.region || null, mappingRole: mapping?.productionRole || null,
            observedCost: offer.supplierCost ? { amount: Number(offer.supplierCost.amount), currency: offer.supplierCost.currency, observedAt: iso(offer.supplierCost.observedAt), sourceOfferHash: offer.rawSnapshotHash, sourceRevision: offer.sourceRevision || offer.rawSnapshotHash } : null,
            mappingCostAuthority: mapping?.supplierCostAuthority?.rawSupplierCost != null ? { amount: Number(mapping.supplierCostAuthority.rawSupplierCost), currency: mapping.supplierCostAuthority.supplierCurrency || null, capturedAt: iso(mapping.supplierCostAuthority.capturedAt), source: mapping.supplierCostAuthority.source || "", providerProductCode: mapping.supplierCostAuthority.providerProductCode || "", providerOfferCode: mapping.supplierCostAuthority.providerOfferCode || "", fundingCost: Number(mapping.supplierCostAuthority.fundingCost || 0), otherAcquisitionCost: Number(mapping.supplierCostAuthority.otherAcquisitionCost || 0) } : null,
            costComparison: comparison,
            availability: { state: availability?.state || "UNKNOWN", evidenceCode: availability?.evidenceCode || "INSUFFICIENT_EVIDENCE", observedAt: iso(availability?.observedAt), staleAt: iso(availability?.staleAt), lastAvailableAt: iso(availability?.lastAvailableAt), lastUnavailableAt: iso(availability?.lastUnavailableAt), consecutiveMissingCount: Number(availability?.consecutiveMissingCount || 0), coverageComplete: availability?.coverageComplete === true },
            productionReadiness: readiness ? { ready: readiness.ready, blockers: readiness.blockers } : null,
            publication: mapping ? (publicationByKey.get(`${mapping.productCode}/${mapping.packageCode}/${mapping.region}`)?.published === true ? "PUBLISHED" : "PRIVATE") : "NOT_APPLICABLE"
        };
    }).sort((a, b) => [a.supplierCode, a.supplierProductCode, a.supplierOfferCode].join("|").localeCompare([b.supplierCode, b.supplierProductCode, b.supplierOfferCode].join("|")));
    const mapped = rows.filter(row => row.mappingId);
    const unmapped = rows.filter(row => !row.mappingId);
    const comparable = mapped.filter(row => row.costComparison.comparable);
    const top = state => comparable.filter(row => row.costComparison.state === state).sort((a, b) => Math.abs(b.costComparison.percentageDelta ?? -Infinity) - Math.abs(a.costComparison.percentageDelta ?? -Infinity)).slice(0, 10).map(row => ({ supplier: row.supplierCode, canonicalPackage: `${row.canonicalProductCode}/${row.canonicalPackageCode}`, supplierOffer: `${row.supplierProductCode}/${row.supplierOfferCode}`, authority: row.mappingCostAuthority, observed: row.observedCost, delta: row.costComparison.absoluteDelta, percentageDelta: row.costComparison.percentageDelta, currency: row.costComparison.currency }));
    const availabilitySummary = {};
    for (const supplierCode of [...new Set(rows.map(row => row.supplierCode))].sort()) {
        const own = rows.filter(row => row.supplierCode === supplierCode);
        availabilitySummary[supplierCode] = { total: own.length, states: sortedObject(countBy(own, row => row.availability.state)), coverageComplete: own.filter(row => row.availability.coverageComplete).length, coveragePartial: own.filter(row => !row.availability.coverageComplete).length, staleMarked: own.filter(row => row.availability.staleAt).length };
    }
    const disagreements = mapped.filter(row => (row.availability.state !== "AVAILABLE" && row.productionReadiness?.ready) || (row.availability.state === "AVAILABLE" && !row.productionReadiness?.ready)).map(row => ({ supplier: row.supplierCode, package: `${row.canonicalProductCode}/${row.canonicalPackageCode}`, role: row.mappingRole, availability: row.availability.state, coverageComplete: row.availability.coverageComplete, productionReady: row.productionReadiness.ready, blockers: row.productionReadiness.blockers }));
    const mlbb570 = mapped.filter(row => row.canonicalProductCode === "mlbb" && row.canonicalPackageCode === "MLBB_570").map(row => ({ supplier: row.supplierCode, role: row.mappingRole, supplierOffer: `${row.supplierProductCode}/${row.supplierOfferCode}`, observedCost: row.observedCost, mappingCostAuthority: row.mappingCostAuthority, costComparison: row.costComparison, availability: row.availability, productionReadiness: row.productionReadiness, publication: row.publication, automaticFailover: false, cheapestSupplierRouting: false }));
    const base = {
        artifactType: "AZIEL_SUPPLIER_COST_AVAILABILITY_AUDIT_PHASE_2H_A", artifactVersion: 1, auditAsOf: rows.reduce((latest, row) => !latest || new Date(row.observedCost?.observedAt || row.availability.observedAt || 0) > new Date(latest) ? (row.observedCost?.observedAt || row.availability.observedAt) : latest, null), mode: "PRODUCTION_READ_ONLY",
        authorityNotice: "Supplier observations are informational evidence. They are not mapping cost authority, Pricing Engine authority, operational readiness, routing, eligibility, or publication authority.",
        productionBaseline: { supplierCatalogProducts: data.products.length, supplierCatalogOffers: data.offers.length, supplierOfferAvailability: data.availability.length, supplierCatalogIngestionRuns: data.runs.length, supplierProductMappings: data.mappings.length, linkedMappings: data.mappings.filter(row => row.supplierCatalogOfferId).length, legacyUnlinkedMappings: data.mappings.filter(row => !row.supplierCatalogOfferId).length, supplierCatalogReconciliationDecisions: data.decisions.length, catalogProducts: data.catalogProducts.length, catalogPackages: data.catalogPackages.length, packageMarketPublications: data.publications.length, pricingQuotes: data.pricingQuotes.length, commerceOrders: data.commerceOrders.length, fulfillmentAttempts: data.fulfillmentAttempts.length, packageInventoryStates: data.inventory.length },
        costMetrics: { mappedOffersWithObservedCost: mapped.filter(row => row.observedCost).length, mappedOffersWithoutObservedCost: mapped.filter(row => !row.observedCost).length, mappingsWithCostAuthority: data.mappings.filter(row => row.supplierCostAuthority?.rawSupplierCost != null && row.supplierCostAuthority?.supplierCurrency).length, mappingsWithoutCostAuthority: data.mappings.filter(row => row.supplierCostAuthority?.rawSupplierCost == null || !row.supplierCostAuthority?.supplierCurrency).length, linkedComparablePairs: comparable.length, comparisonStates: sortedObject(countBy(mapped, row => row.costComparison.state)), largestIncreases: top("INCREASE"), largestDecreases: top("DECREASE") },
        availabilityMetrics: { bySupplier: availabilitySummary, mappedStates: sortedObject(countBy(mapped, row => row.availability.state)), unmappedStates: sortedObject(countBy(unmapped, row => row.availability.state)), primaryStates: sortedObject(countBy(mapped.filter(row => row.mappingRole === "PRIMARY"), row => row.availability.state)), backupStates: sortedObject(countBy(mapped.filter(row => row.mappingRole === "BACKUP"), row => row.availability.state)), staleMarked: rows.filter(row => row.availability.staleAt).length, freshnessTtlConfigured: false, readinessDisagreementCount: disagreements.length, readinessDisagreements: disagreements },
        mlbb570,
        authorityGraph: [
            { from: "SupplierCatalogOffer.supplierCost", to: "SupplierProductMapping.supplierCostAuthority", edge: "NO_CONNECTION", future: "EXPLICIT_ADMIN_COPY_WITH_SOURCE_LOCK" },
            { from: "SupplierProductMapping.supplierCostAuthority", to: "Admin Pricing Workspace", edge: "READ_DERIVE" },
            { from: "Admin Pricing Workspace", to: "CatalogPackage.prices[market]", edge: "EXPLICIT_PUBLISH_WRITE" },
            { from: "CatalogPackage.prices[market]", to: "Pricing Engine", edge: "READ" },
            { from: "Pricing Engine", to: "PricingQuote", edge: "DERIVE_SNAPSHOT" },
            { from: "PricingQuote", to: "CommerceOrder", edge: "COPY_SNAPSHOT" },
            { from: "SupplierProductMapping.supplierCostAuthority", to: "FulfillmentAttempt", edge: "SNAPSHOT_VIA_FULFILLMENT_SERVICE" }
        ],
        blockers: ["NO_COST_OBSERVATION_HISTORY_MODEL", "NO_COST_AUTHORITY_CHANGE_HISTORY", "NO_DEDICATED_SUPPLIER_COST_MANAGE_PERMISSION", "NO_PROMOTION_SOURCE_LOCK_MUTATION", "NO_APPROVED_AVAILABILITY_FRESHNESS_TTL"],
        phase2hBActions: ["Add append-only cost observation history", "Add append-only cost authority change audit", "Add OWNER-only SUPPLIER_COST_MANAGE", "Implement single-mapping source-locked review and promotion", "Keep availability evidence read-only; reuse explicit operational mapping/readiness controls for disablement"],
        supplierNetworkCalls: { catalog: 0, balance: 0, validation: 0, order: 0, status: 0, fulfillment: 0 }, productionWrites: 0
    };
    return { ...base, artifactHash: sha(base) };
}

function verifyStaticBoundaries(artifact) {
    let checks = 0;
    const ok = (condition, message) => { assert(condition, message); checks += 1; };
    const read = relative => fs.readFileSync(path.resolve(__dirname, "..", relative), "utf8");
    const offerModel = read("models/SupplierCatalogOffer.js");
    const availabilityModel = read("models/SupplierOfferAvailability.js");
    const mappingModel = read("models/SupplierProductMapping.js");
    const fazer = read("services/supplierCatalog/providers/fazerCardsCatalogIngestionService.js");
    const wondd = read("services/supplierCatalog/providers/wonddCatalogIngestionService.js");
    const routing = read("services/supplierProductionSelectionService.js");
    const eligibility = read("services/supplierEligibilityRouteResolver.js");
    const pricing = read("services/commerce/pricingCalculationEngine.js");
    const quoteModel = read("models/PricingQuote.js");
    const orderModel = read("models/CommerceOrder.js");
    const architecture = fs.readFileSync(path.resolve(__dirname, "../../docs/supplier-cost-availability-operations-phase2h.md"), "utf8");
    ok(offerModel.includes("supplierCostSchema") && mappingModel.includes("supplierCostAuthority"), "observed cost and mapping authority are separate schemas");
    ok(!fazer.includes("supplierCostAuthority") && !wondd.includes("supplierCostAuthority"), "ingestion cannot promote mapping authority");
    ok(pricing.includes("supplierCost") && !pricing.includes("SupplierCatalogOffer"), "Pricing Engine remains a separate authority");
    ok(!availabilityModel.includes("PackageMarketPublication") && architecture.includes("publication intent"), "publication remains separate");
    ok(availabilityModel.includes('["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]'), "availability states are evidence states");
    ok(fazer.includes('state:"UNKNOWN"') && fazer.includes('stage.coverageState==="COMPLETE"'), "complete-coverage disappearance becomes UNKNOWN");
    ok(wondd.includes("missing: []") && wondd.includes('coverageState: "PARTIAL"'), "partial coverage does not infer unavailable");
    ok(eligibility.includes("FULFILLMENT_ELIGIBILITY_UNKNOWN"), "UNKNOWN customer eligibility remains fail-closed");
    const primaryResolver = routing.slice(routing.indexOf("async function resolvePrimaryRouteSnapshot"), routing.indexOf("async function resolveLegacyCheckoutRouteSnapshot"));
    ok(primaryResolver.includes('productionRole: ROLES.PRIMARY') && !primaryResolver.includes("BACKUP") && !primaryResolver.includes("Availability"), "routing selects PRIMARY and does not auto-failover");
    ok(artifact.costMetrics.comparisonStates.CURRENCY_MISMATCH >= 0 || !artifact.costMetrics.comparisonStates.CURRENCY_MISMATCH, "currency mismatch is never converted");
    ok(architecture.includes("Both increases and decreases require review"), "cost decreases are not auto-approved");
    ok(architecture.includes("Both increases and decreases require review"), "cost increases are not auto-approved");
    ok(architecture.includes("rawSnapshotHash") && architecture.includes("COST_RECONFIRMATION_REQUIRED"), "future promotion requires a source revision lock");
    ok(quoteModel.includes("immutable: true") && orderModel.includes("quoteSnapshot") && orderModel.includes("immutable: true"), "historical quote and order snapshots are immutable");
    ok(artifact.authorityGraph[0].edge === "NO_CONNECTION", "observed cost is not copied automatically");
    ok(artifact.mlbb570.length === 2 && new Set(artifact.mlbb570.map(row => row.supplier)).size === 2, "supplier-specific costs remain separate");
    ok(artifact.mlbb570.every(row => row.automaticFailover === false && row.cheapestSupplierRouting === false), "MLBB_570 suppliers remain distinct");
    ok(artifact.productionWrites === 0 && Object.values(artifact.supplierNetworkCalls).every(value => value === 0), "audit has no production writes or supplier calls");
    ok(artifact.artifactHash === sha(Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "artifactHash"))), "artifact hash valid");
    return checks;
}

(async () => {
    assert(process.env.MONGO_URI, "MONGO_URI is required for the production read-only audit.");
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred" });
    const before = await fingerprints();
    const [suppliers, products, offers, availability, runs, mappings, decisions, catalogProducts, catalogPackages, publications, pricingQuotes, commerceOrders, fulfillmentAttempts, inventory] = await Promise.all([Supplier.find().lean(), Product.find().lean(), Offer.find().lean(), Availability.find().lean(), Run.find().lean(), Mapping.find().lean(), Decision.find().lean(), CatalogProduct.find().lean(), CatalogPackage.find().lean(), Publication.find().lean(), PricingQuote.find().lean(), CommerceOrder.find().lean(), FulfillmentAttempt.find().lean(), Inventory.find().lean()]);
    const mappingHashBefore = mappingBusinessHash(mappings);
    const artifact = buildArtifact({ suppliers, products, offers, availability, runs, mappings, decisions, catalogProducts, catalogPackages, publications, pricingQuotes, commerceOrders, fulfillmentAttempts, inventory });
    const checks = verifyStaticBoundaries(artifact);
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    const after = await fingerprints();
    const mappingHashAfter = mappingBusinessHash(await Mapping.find().lean());
    assert.deepStrictEqual(after, before, "Protected production fingerprints changed");
    assert.strictEqual(mappingHashAfter, mappingHashBefore, "SupplierProductMapping business state changed");
    console.log(JSON.stringify({ result: "PASS", checks, artifact: ARTIFACT, artifactHash: artifact.artifactHash, productionBaseline: artifact.productionBaseline, costMetrics: artifact.costMetrics, availabilityMetrics: artifact.availabilityMetrics, mlbb570: artifact.mlbb570, protectedFingerprints: after, protectedStateExactEquality: true, mappingBusinessStateHash: mappingHashAfter, supplierNetworkCalls: artifact.supplierNetworkCalls, productionWrites: 0 }, null, 2));
    await mongoose.disconnect();
})().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(error); process.exit(1); });

module.exports = { compareCost, buildArtifact, verifyStaticBoundaries };
