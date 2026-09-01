#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    COVERAGE_STATES,
    DISPOSITIONS,
    classifySupplierMarket,
    dispositionForOffer
} = require("../services/supplierCatalog/supplierMarketCoveragePolicy");
const { decorateCoverageRow, coverageSummary } = require("../services/adminSupplierCatalogReadService");

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks += 1; };
const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

ok(classifySupplierMarket({ supplierMarketCode: "GLOBAL" }).state === COVERAGE_STATES.ELIGIBLE_GLOBAL, "Explicit Global evidence must be eligible.");
ok(classifySupplierMarket({ supplierMarketCode: "Asia" }).state === COVERAGE_STATES.ELIGIBLE_ASIA, "Explicit Asia evidence must be eligible.");
ok(classifySupplierMarket({ supplierMarketCode: "SEA" }).state === COVERAGE_STATES.ELIGIBLE_ASIA, "Explicit SEA evidence must be eligible.");
ok(classifySupplierMarket({ supplierMarketCode: "TH" }).state === COVERAGE_STATES.ELIGIBLE_ASIA_COUNTRY, "Thailand must be a target Asia country.");
ok(classifySupplierMarket({ supplierMarketCode: "Indonesia" }).state === COVERAGE_STATES.ELIGIBLE_ASIA_COUNTRY, "Indonesia must remain an explicit Asia-country market.");
ok(classifySupplierMarket({ supplierMarketCode: "UNSPECIFIED" }).state === COVERAGE_STATES.UNKNOWN_MARKET, "UNSPECIFIED must fail closed.");
ok(classifySupplierMarket({ supplierMarketCode: "UNKNOWN" }).targetEligible === false, "UNKNOWN must not become target eligible.");
ok(classifySupplierMarket({ supplierMarketCode: "Brazil" }).state === COVERAGE_STATES.NON_TARGET_MARKET, "Brazil must not enter the Asia target scope.");
ok(classifySupplierMarket({ supplierMarketCode: "MENA" }).state === COVERAGE_STATES.UNKNOWN_MARKET, "Ambiguous multi-region markets must fail closed.");
ok(classifySupplierMarket({ supplierMarketCode: "Saudi Arabia" }).state === COVERAGE_STATES.ELIGIBLE_ASIA_COUNTRY, "Explicit Saudi Arabia evidence must remain Asia-country eligible.");
ok(classifySupplierMarket({ supplierMarketCode: "GLOBAL", supportState: "UNSUPPORTED" }).state === COVERAGE_STATES.UNSUPPORTED, "Unsupported supplier products must remain unsupported.");

const globalCoverage = classifySupplierMarket({ supplierMarketCode: "GLOBAL" });
ok(dispositionForOffer({ coverage: globalCoverage, mappingStatus: "LINKED" }) === DISPOSITIONS.MAPPED, "Eligible linked offers must be accounted as mapped.");
ok(dispositionForOffer({ coverage: globalCoverage, mappingStatus: "UNLINKED" }) === DISPOSITIONS.REVIEW_REQUIRED, "Eligible unlinked offers must require review.");
ok(dispositionForOffer({ coverage: classifySupplierMarket({ supplierMarketCode: "UNKNOWN" }), mappingStatus: "LINKED" }) === DISPOSITIONS.REVIEW_REQUIRED, "A mapping cannot override unknown market evidence.");
ok(dispositionForOffer({ coverage: classifySupplierMarket({ supplierMarketCode: "BR" }), mappingStatus: "LINKED" }) === DISPOSITIONS.NON_TARGET_MARKET, "A mapping cannot pull a non-target market into sell scope.");

const row = decorateCoverageRow({ supplierMarketCode: "TH", mappingStatus: "LINKED", reconciliationState: "EXACT_CANONICAL_MATCH", catalogLifecycleState: "ACTIVE", publicationState: "PRIVATE" }, { supportState: "SUPPORTED" });
ok(row.marketCoverageState === COVERAGE_STATES.ELIGIBLE_ASIA_COUNTRY && row.durableDisposition === DISPOSITIONS.MAPPED, "Admin rows must expose market coverage and durable disposition.");
ok(row.sellControl.authority === "PACKAGE_MARKET_PUBLICATION", "Admin SELL control must reuse PackageMarketPublication.");
ok(row.sellControl.preservesMapping && row.sellControl.preservesSupplierEvidence, "Admin OFF must preserve mappings and supplier evidence.");
const summary = coverageSummary([row, decorateCoverageRow({ supplierMarketCode: "UNSPECIFIED", mappingStatus: "UNLINKED" })]);
ok(summary.targetOffers === 1 && summary.targetMapped === 1 && summary.targetUnaccounted === 0, "Every projected offer must have a disposition.");

const adminRead = read("backend/services/adminSupplierCatalogReadService.js");
const adminUi = read("frontend/js/admin-supplier-catalog.js");
const publicCatalog = read("backend/services/catalogService.js");
const routing = read("backend/services/supplierProductionSelectionService.js");
const pricing = read("backend/services/supplierCatalog/supplierCostAuthorityService.js");
ok(adminRead.includes("marketCoverageState") && adminRead.includes("durableDisposition"), "Admin read model must expose coverage accounting.");
ok(adminUi.includes("PACKAGE_MARKET_PUBLICATION") || adminUi.includes("PackageMarketPublication"), "Admin UI must name the publication authority.");
ok(adminUi.includes("OFF preserves canonical identity, supplier mapping, cost evidence and availability history"), "Admin OFF preservation must be explicit.");
ok(publicCatalog.includes("explicitPublishedPackages"), "Public catalog must retain explicit publication filtering.");
ok(routing.includes('productionRole: ROLES.PRIMARY') && routing.includes('productionRole: ROLES.BACKUP'), "Routing roles must remain explicit.");
ok(routing.includes("automaticFailover: false") || read("backend/scripts/verify-owner-routing-publication-boundary.js").includes("backupAutomaticSelection: false"), "Automatic failover must remain absent.");
ok(pricing.includes("SUPPLIER_COST_AUTHORITY_MUTATIONS_ENABLED"), "Observed-cost promotion must remain gated.");

console.log(JSON.stringify({ result: "PASS", checks, productionConnections: 0, supplierCalls: 0, writes: 0 }, null, 2));
