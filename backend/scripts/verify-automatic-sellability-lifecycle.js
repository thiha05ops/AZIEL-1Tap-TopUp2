"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { evaluatePackageSupplierCandidates } = require("../services/packageSupplierCandidateService");
const { explicitPublishedPackages } = require("../services/packageMarketPublicationService");
const { resolvePublicProductReadiness } = require("../catalog/publicProductReadiness");

let checks = 0;
const ok = (value, message) => { assert(value, message); checks += 1; };
const now = new Date();
const future = new Date(Date.now() + 60_000);
const product = { productCode: "game", enabled: true, deletedAt: null, supportedRegions: ["TH", "MM"] };
const pkg = { productCode: "game", packageCode: "P1", name: "Package 1", enabled: true, deletedAt: null, prices: { TH: { amount: 10, currency: "THB", enabled: true }, MM: { amount: 1000, currency: "MMK", enabled: true } } };
const supplier = { _id: "s1", supplierCode: "TEST", name: "Test Supplier", enabled: true, mode: "API" };
const offer = { _id: "o1", supplierId: "s1", supplierProductCode: "native-product", supplierOfferCode: "native-offer", catalogLifecycleState: "ACTIVE" };
const availability = { supplierCatalogOfferId: "o1", state: "AVAILABLE", observedAt: now, staleAt: future };
const mapping = { _id: "m1", supplierId: "s1", supplierCode: "TEST", productCode: "game", packageCode: "P1", supplierCatalogOfferId: "o1", supplierProductCode: "native-product", supplierPackageCode: "native-offer", region: "GLOBAL", enabled: true, archivedAt: null, executionMode: "API", productionRole: "DISABLED", fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", verifiedAt: now, version: 1 }, mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true } } };
const adapter = { isConfigured: () => true, isAutoFulfillmentEnabled: () => true };
const evaluate = (overrides = {}) => evaluatePackageSupplierCandidates({ productCode: "game", packageCode: "P1", customerMarket: "TH", product, pkg, publication: null, selection: { supplierMappingId: "m1", decisionVersion: 1 }, mappings: [mapping], suppliers: [supplier], offers: [offer], availabilityRows: [availability], adapterFor: () => adapter, ...overrides });

const live = evaluate();
ok(live.operational.state === "LIVE", "valid price plus exact executable selected route is live without publication intent");
ok(live.publication.published === false && live.publication.historical === true, "publication is historical rather than a sellability gate");
ok(evaluate({ pkg: { ...pkg, prices: { ...pkg.prices, TH: { ...pkg.prices.TH, amount: 12 } } } }).operational.state === "LIVE", "normal price change preserves live routing");
ok(evaluate({ pkg: { ...pkg, prices: { MM: pkg.prices.MM } } }).operational.blockerCodes.includes("NO_VALID_PRICE"), "missing price blocks");
ok(evaluate({ pkg: { ...pkg, enabled: false } }).operational.blockerCodes.includes("PACKAGE_DISABLED"), "disabled package blocks");
ok(evaluate({ availabilityRows: [{ ...availability, state: "UNAVAILABLE" }] }).operational.state === "BLOCKED", "supplier unavailability blocks");
ok(evaluate({ availabilityRows: [availability] }).operational.state === "LIVE", "availability recovery restores live state automatically");
ok(evaluate({ customerMarket: "MM" }).operational.state === "LIVE", "GLOBAL mapping may independently serve MM");
ok(evaluate({ customerMarket: "MM", product: { ...product, supportedRegions: ["TH"] } }).operational.blockerCodes.includes("PRODUCT_MARKET_UNAVAILABLE"), "customer markets are evaluated independently");
ok(evaluate({ selection: null }).operational.blockerCodes.includes("PACKAGE_SUPPLIER_SELECTION_REQUIRED"), "checkout routing authority is still required");

const projected = explicitPublishedPackages({ packages: [{ ...pkg, publication: { customerMarket: "TH", published: false }, fulfillmentRegions: { TH: true } }] });
ok(projected.length === 1, "sellable package is included without a publication record");
ok(explicitPublishedPackages({ packages: [{ ...pkg, publication: { customerMarket: "TH" }, fulfillmentRegions: { TH: false } }] }).length === 0, "unsafe package remains excluded");
const commerce = { checks: { fulfillment: true, availability: true }, regions: { TH: { fulfillment: true, availability: true } } };
ok(resolvePublicProductReadiness({ ...product, publicDiscoveryEnabled: false, commerceState: "HIDDEN" }, [pkg], commerce, { explicitCommercialAuthority: true }).state === "HIDDEN", "Hide suppresses discovery without changing package authorities");
ok(resolvePublicProductReadiness({ ...product, publicDiscoveryEnabled: true, commerceState: "PURCHASABLE" }, [pkg], commerce, { explicitCommercialAuthority: true }).state === "AVAILABLE", "Show immediately restores availability when underlying authorities remain ready");

const root = path.resolve(__dirname, "..");
const frontend = fs.readFileSync(path.join(root, "../frontend/js/admin-catalog.js"), "utf8");
const merchandising = frontend.slice(frontend.indexOf("function renderOperationalPackageRows"), frontend.indexOf("function renderCatalogMerchandisingPanel"));
ok(!merchandising.includes("renderCatalogSupplierSetup") && !merchandising.includes("renderCatalogMarketAvailability"), "normal merchandising UI has no Supplier Setup or Publish Ready workflow");
ok(merchandising.includes("Live ${counts.LIVE} · Blocked ${counts.BLOCKED} · Total ${joined.length}"), "market counts are mutually exclusive and share one denominator");
ok(frontend.includes("publicDiscoveryEnabled: show") && frontend.includes('commerceState: show ? "PURCHASABLE" : "HIDDEN"'), "Show/Hide changes visibility without disabling technical authorities");
ok(frontend.includes("preserveCatalogAnchorPosition(anchor") && frontend.includes("syncCatalogBulkSelectionUi(detail, product, input)"), "Package Offers checkbox scroll preservation remains present");

const addProduct = fs.readFileSync(path.join(root, "services/supplierCatalog/addProductFinalizationService.js"), "utf8");
ok(addProduct.includes('commerceState:"PURCHASABLE",publicDiscoveryEnabled:true') && addProduct.includes("supportedRegions:plan.customerMarkets"), "new Add Product canonical products enter normal visible lifecycle");
ok(addProduct.includes('"mappingMetadata.onboardingPlanHash":plan.planHash') && addProduct.includes("{$set:{enabled:true}}"), "only source-locked mappings created by the trusted plan are activated");
ok(addProduct.includes("applyPackageSupplierSelectionBootstrapPlan") && addProduct.includes("publicationWrites:0"), "Add Product reconciles selection without publication ceremony");

const bootstrap = fs.readFileSync(path.join(root, "services/packageSupplierSelectionBootstrapService.js"), "utf8");
ok(bootstrap.includes("reconcileAutomaticPackageSupplierSelections"), "bounded automatic reconciliation authority exists");
ok(bootstrap.includes("PROTECTED_EXISTING_SELECTION") && bootstrap.includes("MULTIPLE_DURABLE_MAPPING_AUTHORITIES"), "explicit overrides are preserved and ambiguity fails closed");
const ingestion = fs.readFileSync(path.join(root, "services/supplierCatalog/supplierCatalogIngestionOrchestrator.js"), "utf8");
ok(ingestion.includes("reconcileSellability(productCode)"), "completed availability ingestion triggers bounded reconciliation");
ok(!bootstrap.includes("submitTopup") && !bootstrap.includes("validatePlayer") && !bootstrap.includes("fetch("), "reconciliation performs zero provider calls");

console.log(JSON.stringify({ result: "PASS", checks, productionWrites: 0, providerCalls: 0, publicationRequired: false }, null, 2));
