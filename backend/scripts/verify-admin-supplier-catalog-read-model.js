"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createAdminSupplierCatalogReadService } = require("../services/adminSupplierCatalogReadService");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks += 1; };
const oid = number => number.toString(16).padStart(24, "0");
const now = new Date("2026-08-30T10:00:00.000Z");

function fixture() {
    const suppliers = [
        { _id: oid(1), supplierCode: "FAZERCARDS", name: "FazerCards", enabled: true, supportedRegions: ["TH"] },
        { _id: oid(2), supplierCode: "WONDD", name: "WonDD", enabled: true, supportedRegions: ["MM", "TH"] }
    ];
    const products = [];
    for (let index = 0; index < 5; index += 1) products.push({ _id: oid(100 + index), supplierId: oid(1), catalogNamespace: "FAZERCARDS_RESELLER_CATALOG", supplierProductCode: index === 0 ? "mobile_legends_global" : `fazer_product_${index}`, displayName: index === 0 ? "Mobile Legends Global" : `Fazer Product ${index}`, supplierMarketCode: index === 0 ? "GLOBAL" : "TH", supportState: "SUPPORTED", lastObservedAt: now });
    for (let index = 0; index < 11; index += 1) products.push({ _id: oid(200 + index), supplierId: oid(2), catalogNamespace: "WONDD_PACKAGE_LIST", supplierProductCode: index === 0 ? "9622" : String(9700 + index), displayName: index === 0 ? "Mobile Legends" : `WonDD Product ${index}`, supplierMarketCode: "UNSPECIFIED", supportState: "SUPPORTED", lastObservedAt: now });
    const offers = [];
    const availability = [];
    const addOffer = ({ supplierId, product, index, reconciliationState, coverageComplete, code, name, cost }) => {
        const _id = oid(1000 + offers.length);
        offers.push({ _id, supplierId, supplierCatalogProductId: product._id, catalogNamespace: product.catalogNamespace, supplierProductCode: product.supplierProductCode, supplierOfferCode: code || `offer_${index}`, supplierOfferName: name || `Offer ${index}`, supplierCost: { amount: cost || index + 1, currency: "USD", observedAt: now }, catalogLifecycleState: "ACTIVE", reconciliationState, normalizedSemantics: { amount: index + 1 }, rawSnapshot: { offer_id: code || `offer_${index}`, name: name || `Offer ${index}` } });
        availability.push({ _id: oid(2000 + offers.length), supplierCatalogOfferId: _id, state: "AVAILABLE", evidenceCode: coverageComplete ? "COMPLETE_CATEGORY_SNAPSHOT" : "OBSERVED_IN_PACKAGE_LIST", coverageComplete, observedAt: now });
        return offers.at(-1);
    };
    for (let index = 0; index < 106; index += 1) addOffer({ supplierId: oid(1), product: products[index % 5], index, reconciliationState: index < 36 ? "EXACT_CANONICAL_MATCH" : index < 66 ? "SEMANTIC_REVIEW_REQUIRED" : "SPECIAL_VARIANT", coverageComplete: true });
    for (let index = 0; index < 153; index += 1) addOffer({ supplierId: oid(2), product: products[5 + (index % 11)], index: 106 + index, reconciliationState: index < 131 ? "EXACT_CANONICAL_MATCH" : index < 148 ? "NO_CANONICAL_PACKAGE" : "SPECIAL_VARIANT", coverageComplete: false });
    offers[0].supplierOfferCode = "429_diamonds"; offers[0].supplierOfferName = "429 Diamonds"; offers[0].supplierCost.amount = 8;
    offers[106].supplierOfferCode = "ML00570"; offers[106].supplierOfferName = "570 Diamonds"; offers[106].supplierCost.amount = 7;
    const catalogProducts = [{ _id: oid(3001), productCode: "mlbb", name: "Mobile Legends", metadata: { market: "GLOBAL" } }];
    const catalogPackages = [{ _id: oid(3002), productCode: "mlbb", packageCode: "MLBB_570", name: "570 Diamonds", enabled: true, deletedAt: null, prices: { TH: { enabled: true, amount: 299, currency: "THB" } } }];
    const mapping = (offer, supplierCode, role, number) => ({ _id: oid(4000 + number), supplierId: supplierCode === "FAZERCARDS" ? oid(1) : oid(2), supplierCode, supplierCatalogOfferId: offer._id, productCode: "mlbb", packageCode: "MLBB_570", region: "TH", supplierProductCode: offer.supplierProductCode, supplierPackageCode: offer.supplierOfferCode, enabled: true, archivedAt: null, executionMode: "API", productionRole: role, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true }, costAuthorityMaximumAgeSeconds: 999999999 }, supplierCostAuthority: { rawSupplierCost: supplierCode === "FAZERCARDS" ? 9 : 7, supplierCurrency: "USD", capturedAt: now, source: "APPROVED_MAPPING" }, fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", version: 1 } });
    const mappings = [mapping(offers[0], "FAZERCARDS", "BACKUP", 1), mapping(offers[106], "WONDD", "PRIMARY", 2), { _id: oid(4999), supplierId: oid(9), supplierCode: "SEAGM", productCode: "mlbb", packageCode: "MLBB_WEEKLY_1X", region: "TH", supplierProductCode: "MLBB", supplierPackageCode: "WEEKLY_PASS", enabled: true, productionRole: "DISABLED", executionMode: "MANUAL" }];
    const publications = [{ _id: oid(5001), productCode: "mlbb", packageCode: "MLBB_570", customerMarket: "TH", published: true }];
    const runs = [{ _id: oid(6001), supplierId: oid(1), catalogNamespace: "FAZERCARDS_RESELLER_CATALOG", runKey: "f", status: "SUCCEEDED_COMPLETE", coverageState: "COMPLETE", startedAt: now, completedAt: now, productsObserved: 5, offersObserved: 106, metadata: { completenessEvidence: "Authenticated full category" } }, { _id: oid(6002), supplierId: oid(2), catalogNamespace: "WONDD_PACKAGE_LIST", runKey: "w", status: "SUCCEEDED_PARTIAL", coverageState: "PARTIAL", startedAt: now, completedAt: now, productsObserved: 11, offersObserved: 153, metadata: { completenessEvidence: "Observed package list; completeness unproven" } }];
    return { suppliers, products, offers, availability, runs, mappings, catalogProducts, catalogPackages, publications, controlledTests: [] };
}

(() => {
    const service = createAdminSupplierCatalogReadService();
    const data = fixture();
    const projected = service.project(data);
    const summary = service.summarize(projected);
    const fazer = projected.rows.filter(row => row.supplierCode === "FAZERCARDS");
    const wondd = projected.rows.filter(row => row.supplierCode === "WONDD");
    const fazer570 = fazer.find(row => row.supplierOfferCode === "429_diamonds");
    const wondd570 = wondd.find(row => row.supplierOfferCode === "ML00570");
    ok(projected.rows.length === 259, "259 supplier offers projected");
    ok(projected.productRows.length === 16, "16 supplier products projected");
    ok(fazer.length === 106 && wondd.length === 153, "suppliers remain distinct");
    ok(fazer.some(row => row.supplierMarketCode === "GLOBAL"), "supplier market preserved");
    ok(wondd.every(row => row.supplierMarketCode === "UNSPECIFIED"), "WonDD market remains unspecified");
    ok(fazer570.mappingStatus === "LINKED", "mapped status derives from catalog offer reference");
    ok(fazer570.canonicalPackageCode === "MLBB_570" && fazer570.mappingId === oid(4001), "mapping context joins exactly");
    ok(fazer[1].mappingStatus === "UNLINKED", "unmapped supplier offer remains unmapped");
    ok(projected.legacyUnlinkedMappings.length === 1 && projected.legacyUnlinkedMappings[0].supplierCode === "SEAGM", "legacy SEAGM remains catalog-unlinked");
    ok(summary.semanticReview === 30 && summary.specialVariants === 45 && summary.noCanonicalPackage === 17, "reconciliation states preserved");
    ok(projected.rows.every(row => row.availabilityState === "AVAILABLE"), "availability states preserved");
    ok(fazer.every(row => row.coverageComplete) && wondd.every(row => !row.coverageComplete), "coverage completeness distinct");
    ok(wondd570.availabilityEvidenceCode === "OBSERVED_IN_PACKAGE_LIST" && !wondd570.coverageComplete, "WonDD partial coverage accurate");
    ok(fazer570.observedSupplierCost === 8 && fazer570.mappingSupplierCostAuthority.rawSupplierCost === 9 && fazer570.costDifference === -1, "observed and mapping costs remain separate");
    ok(fazer570.publicationState === "PUBLISHED", "publication derives from publication record");
    const noPublication = service.project({ ...data, publications: [] }).rows.find(row => row.offerId === fazer570.offerId);
    ok(noPublication.mappingStatus === "LINKED" && noPublication.publicationState === "PRIVATE", "mapping does not imply publication");
    ok(fazer[1].availabilityState === "AVAILABLE" && fazer[1].publicationState === "NOT_APPLICABLE", "availability does not imply publication");
    ok(noPublication.productionReadiness && noPublication.publicationState === "PRIVATE", "readiness does not imply publication");
    const unavailableData = { ...data, availability: data.availability.map(item => String(item.supplierCatalogOfferId) === fazer570.offerId ? { ...item, state: "UNAVAILABLE" } : item) };
    ok(service.project(unavailableData).rows.find(row => row.offerId === fazer570.offerId).publicationState === "PUBLISHED", "publication does not imply availability");
    ok(fazer570.offerId !== wondd570.offerId && fazer570.mappingId !== wondd570.mappingId, "multi-supplier offers remain separate");
    ok(fazer570.supplierRole === "BACKUP" && wondd570.supplierRole === "PRIMARY", "MLBB_570 roles remain distinct");
    ok([...fazer570.alternativeMappings, ...wondd570.alternativeMappings].every(item => item.automaticFailover === false), "no automatic failover inferred");
    const serviceSource = fs.readFileSync(path.resolve(__dirname, "../services/adminSupplierCatalogReadService.js"), "utf8");
    ok(!/(fetch\(|axios|submitTopup|placeOrder|validatePlayer|checkStatus)/.test(serviceSource), "no supplier network call");
    ok(!/\.(save|create|insertMany|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate)\s*\(/.test(serviceSource), "read service has no writes");
    const sorted = projected.rows.map(row => row.offerId);
    ok(sorted.slice(0, 25).join("|") === service.filterRows(projected.rows, {}).slice(0, 25).map(row => row.offerId).join("|"), "pagination source ordering stable");
    ok(service.filterRows(projected.rows, { supplier: "WONDD", coverage: "PARTIAL" }).length === 153, "filtering stable");
    const before = fazer[1].reconciliationState;
    ok(service.filterRows(projected.rows, { search: fazer[1].supplierOfferCode })[0].reconciliationState === before, "search does not alter reconciliation");
    ok(summary.bySupplier.FAZERCARDS.products === 5 && summary.bySupplier.WONDD.products === 11, "provider product breakdown computed");
    ok(projected.runs[0].status === "SUCCEEDED_COMPLETE" && projected.runs[1].status === "SUCCEEDED_PARTIAL", "ingestion runs preserve status");
    const html = fs.readFileSync(path.resolve(__dirname, "../../frontend/admin.html"), "utf8");
    const js = fs.readFileSync(path.resolve(__dirname, "../../frontend/js/admin-supplier-catalog.js"), "utf8");
    const css = fs.readFileSync(path.resolve(__dirname, "../../frontend/css/admin/admin-supplier-catalog.css"), "utf8");
    ok(html.includes("section-supplier-catalog") && js.includes("renderSupplierCatalogOffers"), "desktop list wired");
    ok(css.includes("@media(max-width:767px)") && css.includes("supplier-catalog-mobile-back"), "mobile layout wired");
    ok(js.includes("supplierCatalogSearch") && js.includes("supplierCatalogSupplier") && js.includes("data-page"), "search filters and pagination wired");
    ok(js.includes("renderSupplierCatalogDetail") && js.includes("loadSupplierCatalogRuns"), "detail and ingestion runs wired");
    ok(js.includes("supplier-catalog-empty") && js.includes("supplier-catalog-error") && js.includes("supplier-catalog-loading"), "empty error and loading states wired");
    console.log(JSON.stringify({ result: "PASS", checks, fixture: { products: 16, offers: 259, availability: 259, runs: 2 }, supplierCalls: 0, databaseWrites: 0 }, null, 2));
})();
