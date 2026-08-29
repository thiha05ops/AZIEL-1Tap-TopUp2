const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const operations = require("../services/supplierOperationsService");
const analytics = require("../services/adminBusinessAnalyticsService");
const { classifySupplierFailure, SUPPLIER_FAILURE_CATEGORIES } = require("../services/supplierFailureClassificationService");
const { createWonddAdapter } = require("../services/suppliers/wonddAdapter");
const { createFazerCardsAdapter, MAX_CATEGORY_PAGES, AVAILABILITY_CONCURRENCY } = require("../services/suppliers/fazercardsAdapter");

const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const query = rows => ({ sort() { return { lean: async () => rows }; } });

function order(overrides = {}) {
    return {
        status: "completed",
        paymentStatus: "paid",
        payment: { status: "paid" },
        fulfilment: { status: "completed" },
        product: { gameCode: "mlbb", gameName: "Mobile Legends", packageCode: "MLBB-86", packageName: "86 Diamonds", quantity: 1 },
        commercial: { currency: "MMK", region: "MM", quantity: 1, totalAmount: 12000 },
        quoteSnapshot: { pricingSnapshot: { businessRuntime: { supplierCostConfigured: true }, result: { currency: "MMK", totalCost: 9000, supplierCost: 8000, gatewayFeeAmount: 500, businessCostAmount: 500 } } },
        ...overrides
    };
}

async function verifyWonddBalanceShape() {
    const adapter = createWonddAdapter({
        env: { WONDD_USERNAME: "user", WONDD_PASSWORD: "secret" },
        fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ balance: "99.5" }) })
    });
    const result = await adapter.getBalance();
    assert.strictEqual(result.status, "SUCCEEDED");
    assert.strictEqual(result.rawMetadata.balance, 99.5);
    assert.strictEqual(result.rawMetadata.currency, "THB");
    assert(!JSON.stringify(result).includes("secret"), "Supplier credentials must never enter normalized output");
}

async function verifySupplierIsolationAndCaching() {
    operations.clearSupplierOperationsCache();
    let balanceCalls = 0;
    const suppliers = [
        { _id: "1", supplierCode: "GOOD", name: "Good Supplier", mode: "API", enabled: true, metadata: { operationalThresholds: { balance: { THB: { low: 100, critical: 20 } } } } },
        { _id: "2", supplierCode: "MANUAL", name: "Manual Supplier", mode: "MANUAL", enabled: true, metadata: {} }
    ];
    const SupplierModel = {
        find: () => query(suppliers),
        updateOne: async () => ({ acknowledged: true })
    };
    const MappingModel = { find: () => query([{ supplierCode: "GOOD", productCode: "mlbb", packageCode: "MLBB-86", supplierProductCode: "mlbb", supplierPackageCode: "86", supplierDisplayName: "86 Diamonds", region: "MM" }]) };
    const adapterResolver = supplier => supplier.supplierCode === "GOOD" ? {
        async getBalance() { balanceCalls += 1; await new Promise(resolve => setTimeout(resolve, 8)); return { status: "SUCCEEDED", rawMetadata: { balance: 99, currency: "THB" } }; },
        async getPackageAvailability() { return { supported: true, evidence: "PROVIDER_PACKAGE_LIST_RETURNED", packages: [{ supplierPackageCode: "86", availability: "AVAILABLE" }] }; }
    } : {};

    const [first, second] = await Promise.all([
        operations.getSupplierOperations({ SupplierModel, MappingModel, adapterResolver }),
        operations.getSupplierOperations({ SupplierModel, MappingModel, adapterResolver })
    ]);
    assert.strictEqual(balanceCalls, 1, "Concurrent supplier refreshes must coalesce");
    assert.strictEqual(first.length, 2, "One unsupported supplier must not hide another supplier");
    assert.strictEqual(second[0].balance.amount, 99);
    assert.strictEqual(first[0].balance.status, "LOW");
    assert.strictEqual(first[1].balance.supported, false);
    assert.strictEqual(first[1].balance.amount, null, "Unsupported balance must never become zero");
    assert.strictEqual(first[0].packageAvailability.packages[0].availability, "AVAILABLE");
    const successfulAvailabilityFetchedAt = first[0].packageAvailability.fetchedAt;
    assert(!JSON.stringify(first).match(/password|authorization|secret/i), "Frontend supplier payload must not contain credential material");

    const degraded = await operations.getSupplierOperations({
        SupplierModel,
        MappingModel,
        force: true,
        adapterResolver: supplier => supplier.supplierCode === "GOOD" ? {
            async getBalance() { throw Object.assign(new Error("temporary timeout"), { code: "TEST_TIMEOUT" }); },
            async getPackageAvailability() { throw Object.assign(new Error("temporary timeout"), { code: "TEST_TIMEOUT" }); }
        } : {}
    });
    assert.strictEqual(degraded[0].balance.amount, 99, "Last successful balance must survive a temporary supplier failure");
    assert.strictEqual(degraded[0].balance.stale, true, "Reused last-success balance must be marked stale");
    assert.strictEqual(degraded[0].packageAvailability.packages[0].availability, "AVAILABLE");
    assert.strictEqual(degraded[0].packageAvailability.stale, true, "Reused package evidence must be marked stale");
    assert.strictEqual(degraded[0].packageAvailability.fetchedAt, successfulAvailabilityFetchedAt, "A refresh failure must preserve the last successful evidence timestamp");
    assert.strictEqual(degraded[0].packageAvailability.errorCode, "TEST_TIMEOUT", "Refresh failure metadata must remain visible");
    assert.strictEqual(operations._cache.get("GOOD").snapshot.packageAvailability.packages[0].availability, "AVAILABLE", "Failed refresh must not overwrite cached successful package evidence with synthetic UNKNOWN");

    const recovered = await operations.getSupplierOperations({
        SupplierModel,
        MappingModel,
        force: true,
        now: new Date("2026-08-30T00:10:00.000Z"),
        adapterResolver: supplier => supplier.supplierCode === "GOOD" ? {
            async getBalance() { return { status: "SUCCEEDED", rawMetadata: { balance: 120, currency: "THB" } }; },
            async getPackageAvailability() { return { supported: true, evidence: "RECOVERED_PROVIDER_LIST", packages: [{ supplierProductCode: "mlbb", supplierPackageCode: "86", availability: "AVAILABLE" }] }; }
        } : {}
    });
    assert.strictEqual(recovered[0].packageAvailability.stale, false, "Later successful refresh must replace stale evidence normally");
    assert.strictEqual(recovered[0].packageAvailability.errorCode, undefined, "Successful refresh must clear prior refresh error metadata");
    assert.strictEqual(recovered[0].packageAvailability.fetchedAt, "2026-08-30T00:10:00.000Z");
}

async function verifyTimeoutAndAvailabilitySemantics() {
    assert.strictEqual(operations.SUPPLIER_BALANCE_TIMEOUT_MS, 4500, "Balance operations must retain the fast 4.5-second budget");
    assert.strictEqual(operations.SUPPLIER_PACKAGE_AVAILABILITY_TIMEOUT_MS, 15000, "Package availability must use one bounded 15-second aggregate budget");
    await assert.rejects(() => operations._withTimeout(() => new Promise(() => {}), 5), error => error.code === "SUPPLIER_OPERATION_TIMEOUT");
    const mappings = [
        { supplierCode: "WONDD", productCode: "mlbb", packageCode: "A", supplierProductCode: "mlbb", supplierPackageCode: "A", region: "MM" },
        { supplierCode: "WONDD", productCode: "mlbb", packageCode: "B", supplierProductCode: "mlbb", supplierPackageCode: "B", region: "MM" }
    ];
    const normalized = operations.normalizeAvailabilityEvidence({ supported: true, evidence: "PROVIDER_PACKAGE_LIST_RETURNED", packages: [{ supplierPackageCode: "A", availability: "AVAILABLE" }] }, mappings, "2026-08-29T00:00:00.000Z");
    assert.strictEqual(normalized.packages[0].availability, "AVAILABLE");
    assert.strictEqual(normalized.packages[1].availability, "UNKNOWN", "Missing provider rows must not become out of stock");
    assert.strictEqual(normalized.summary.OUT_OF_STOCK, 0);
    const ambiguous = operations.normalizeAvailabilityEvidence({ supported: true, packages: [{ supplierProductCode: "mlbb", supplierPackageCode: "A", availability: "AVAILABLE" }, { supplierProductCode: "mlbb", supplierPackageCode: "A", availability: "OUT_OF_STOCK" }] }, mappings.slice(0, 1), "2026-08-29T00:00:00.000Z");
    assert.strictEqual(ambiguous.packages[0].availability, "UNKNOWN", "Ambiguous duplicate offer identities must not attach arbitrary evidence");
    assert.strictEqual(ambiguous.packages[0].evidence, "AMBIGUOUS_SUPPLIER_OFFER_IDENTITY");

    const scaledMapping = [{ supplierCode: "FAZERCARDS", productCode: "freefire", packageCode: "FF_33_DIA", supplierProductCode: "free_fire_th", supplierPackageCode: "33_diamonds", region: "TH" }];
    const scaledSuccess = await operations._fetchAvailability({
        mappings: scaledMapping,
        previous: null,
        now: new Date("2026-08-30T00:00:00.000Z"),
        timeoutMs: 30,
        adapter: { async getPackageAvailability() { await new Promise(resolve => setTimeout(resolve, 12)); return { supported: true, evidence: "BOUNDED_TRAVERSAL", packages: [{ supplierProductCode: "free_fire_th", supplierPackageCode: "33_diamonds", availability: "AVAILABLE" }] }; } }
    });
    assert.strictEqual(scaledSuccess.packages[0].availability, "AVAILABLE", "Aggregate availability work exceeding the scaled balance budget but below the scaled catalog budget must succeed");

    const firstTimeout = await operations._fetchAvailability({
        mappings: scaledMapping,
        previous: null,
        now: new Date("2026-08-30T00:01:00.000Z"),
        timeoutMs: 5,
        adapter: { async getPackageAvailability() { return new Promise(() => {}); } }
    });
    assert.strictEqual(firstTimeout.packages[0].availability, "UNKNOWN", "First-ever timeout without evidence must remain UNKNOWN");
    assert.strictEqual(firstTimeout.stale, true);
    assert.strictEqual(firstTimeout.fetchedAt, null, "First-ever timeout must not fabricate a successful timestamp");
    assert.strictEqual(firstTimeout.errorCode, "SUPPLIER_OPERATION_TIMEOUT");

    const retained = await operations._fetchAvailability({
        mappings: scaledMapping,
        previous: scaledSuccess,
        now: new Date("2026-08-30T00:02:00.000Z"),
        timeoutMs: 5,
        adapter: { async getPackageAvailability() { return new Promise(() => {}); } }
    });
    assert.strictEqual(retained.packages[0].availability, "AVAILABLE", "Timeout after success must retain known-good availability");
    assert.strictEqual(retained.fetchedAt, scaledSuccess.fetchedAt, "Timeout after success must preserve the successful timestamp");
    assert.strictEqual(retained.stale, true);
    assert.strictEqual(retained.errorCode, "SUPPLIER_OPERATION_TIMEOUT");
}

async function verifyFazerCardsAvailabilitySnapshot() {
    const requests = [];
    let active = 0;
    let maxActive = 0;
    const response = payload => ({ ok: true, json: async () => payload });
    const realContractRequests = [];
    const realContractAdapter = createFazerCardsAdapter({
        env: { FAZERCARDS_API_KEY: "test-only" },
        fetchImpl: async url => {
            realContractRequests.push(url);
            if (url.endsWith("/topups")) return response({ ok: true, kind: "topup", items: [{ category_id: "free_fire_th", name: "Free Fire (TH)" }], meta: { next_cursor: null, has_more: false } });
            return response({ offers: [{ offer_id: "33_diamonds", name: "33 Diamonds", price_usd: "0.2900" }] });
        }
    });
    const realContract = await realContractAdapter.getPackageAvailability({ categoryIds: ["free_fire_th"] });
    assert.strictEqual(realContract.diagnostics.retrievedCategories, 1, "Real payload.items category rows must be recognized");
    assert.strictEqual(realContract.packages[0].supplierProductCode, "free_fire_th", "category_id must survive normalization exactly");
    assert.strictEqual(realContractRequests.filter(url => url.includes("category_id=free_fire_th")).length, 1, "Mapped payload.items category must execute offer retrieval");
    assert.strictEqual(realContract.packages[0].supplierPackageCode, "33_diamonds", "Exact offer_id must survive normalization");
    assert.strictEqual(realContract.packages[0].availability, "AVAILABLE", "Listed mapped offer must normalize AVAILABLE");
    const realMappings = [
        { supplierCode: "FAZERCARDS", productCode: "freefire", packageCode: "FF_33_DIA", supplierProductCode: "free_fire_th", supplierPackageCode: "33_diamonds", region: "TH" },
        { supplierCode: "FAZERCARDS", productCode: "freefire", packageCode: "FF_68_DIA", supplierProductCode: "free_fire_th", supplierPackageCode: "68_diamonds", region: "TH" }
    ];
    const realMapped = operations.normalizeAvailabilityEvidence(realContract, realMappings, "2026-08-30T00:00:00.000Z");
    assert.strictEqual(realMapped.packages[0].availability, "AVAILABLE", "supplierPackageCode must map exactly to offer_id");
    assert.strictEqual(realMapped.packages[1].availability, "UNKNOWN", "A missing offer must not become false out of stock");
    assert(!JSON.stringify(realContract).includes("test-only"), "Credentials must never enter normalized Admin evidence");

    for (const categoryPayload of [
        { categories: [{ category_id: "legacy_category" }], meta: {} },
        { data: { categories: [{ category_id: "legacy_category" }] }, meta: {} },
        { data: [{ category_id: "legacy_category" }], meta: {} }
    ]) {
        let offerCalls = 0;
        const legacyAdapter = createFazerCardsAdapter({ env: { FAZERCARDS_API_KEY: "test-only" }, fetchImpl: async url => {
            if (url.endsWith("/topups")) return response(categoryPayload);
            offerCalls += 1;
            return response({ offers: [{ offer_id: "legacy_offer" }] });
        } });
        const legacyResult = await legacyAdapter.getPackageAvailability({ categoryIds: ["legacy_category"] });
        assert.strictEqual(legacyResult.diagnostics.retrievedCategories, 1, "Previously supported category response shapes must remain supported");
        assert.strictEqual(offerCalls, 1, "Previously supported category shapes must still select mapped categories");
    }
    const adapter = createFazerCardsAdapter({
        env: { FAZERCARDS_API_KEY: "test-only" },
        fetchImpl: async url => {
            requests.push(url);
            if (url.endsWith("/topups")) return response({ categories: [{ category_id: "unrelated" }], meta: { next_cursor: "page-2" } });
            if (url.includes("cursor=page-2")) return response({ categories: [{ category_id: "mobile_legends_global" }, { category_id: "free_fire_th" }], meta: {} });
            active += 1; maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 2));
            active -= 1;
            if (url.includes("mobile_legends_global")) return response({ offers: [
                { offer_id: "86_diamonds", price_usd: "1.25", active: true },
                { offer_id: "172_diamonds", price_usd: "2.50", stock_status: "out_of_stock" },
                { offer_id: "257_diamonds", price_usd: "3.50", enabled: false }
            ] });
            return response({ offers: [{ offer_id: "100_diamonds", price_usd: "0.75" }] });
        }
    });
    const result = await adapter.getPackageAvailability({ categoryIds: ["mobile_legends_global", "free_fire_th"] });
    assert.strictEqual(requests.filter(url => url.includes("/topups/offers?")).length, 2, "FazerCards must retrieve once per category, not once per AZIEL package");
    assert.strictEqual(requests.length, 4, "Snapshot request count is category pages plus mapped categories");
    assert(maxActive <= AVAILABILITY_CONCURRENCY, "Offer retrieval concurrency must remain bounded");
    assert(result.diagnostics.categoryPages <= MAX_CATEGORY_PAGES, "Category traversal must remain bounded");
    assert.strictEqual(result.packages.find(row => row.supplierPackageCode === "86_diamonds").availability, "AVAILABLE");
    assert.strictEqual(result.packages.find(row => row.supplierPackageCode === "172_diamonds").availability, "OUT_OF_STOCK");
    assert.strictEqual(result.packages.find(row => row.supplierPackageCode === "257_diamonds").availability, "UNAVAILABLE");
    assert.strictEqual(result.packages.find(row => row.supplierPackageCode === "100_diamonds").availability, "AVAILABLE", "A current listed offer is orderable catalog evidence");
    assert(!JSON.stringify(result).includes("test-only"), "Credentials must not enter availability payloads");
}

function verifyProductCentricCoverage() {
    const snapshots = [
        { supplierCode: "WONDD", supplierName: "WonDD", packageAvailability: { supported: true, fetchedAt: "2026-08-30T00:00:00.000Z", stale: false, packages: [{ productCode: "mlbb", packageCode: "MLBB-86", supplierPackageCode: "W86", availability: "AVAILABLE", evidence: "LIST" }] } },
        { supplierCode: "FAZERCARDS", supplierName: "FazerCards", packageAvailability: { supported: true, fetchedAt: "2026-08-30T00:00:00.000Z", stale: false, packages: [{ productCode: "mlbb", packageCode: "MLBB-86", supplierPackageCode: "F86", availability: "UNKNOWN", evidence: "NOT_RETURNED_NOT_AUTHORITATIVE" }] } },
        { supplierCode: "SEAGM", supplierName: "SEAGM", liveOperationsVisible: false, balance: { supported: false }, packageAvailability: { supported: false, stale: false, packages: [] } }
    ];
    const products = [{ productCode: "mlbb", name: "Renamed Mobile Legends" }, { productCode: "freefire", name: "Free Fire" }];
    const packages = [{ productCode: "mlbb", packageCode: "MLBB-86", name: "Renamed 86 Diamonds" }, { productCode: "freefire", packageCode: "FF-100", name: "100 Diamonds" }];
    const mappings = [
        { supplierCode: "WONDD", productCode: "mlbb", packageCode: "MLBB-86", supplierProductCode: "mlbb", supplierPackageCode: "W86" },
        { supplierCode: "FAZERCARDS", productCode: "mlbb", packageCode: "MLBB-86", supplierProductCode: "mobile_legends_global", supplierPackageCode: "F86" }
    ];
    const coverage = operations.buildProductPackageCoverage({ snapshots, products, packages, mappings, affectedCounts: [{ _id: { productCode: "mlbb", packageCode: "MLBB-86", supplierCode: "FAZERCARDS" }, count: 3 }] });
    assert.strictEqual(coverage[0].productCode, "mlbb", "Grouping must use canonical productCode, not display names");
    assert.strictEqual(coverage[0].packages[0].packageCode, "MLBB-86", "Grouping must use canonical packageCode");
    assert.strictEqual(coverage[0].packages[0].suppliers.length, 2, "One package must expose all live cross-supplier coverage");
    assert.strictEqual(coverage[0].packages[0].coverage.confirmedAvailableSuppliers, 1, "Only confirmed AVAILABLE suppliers count");
    assert.strictEqual(coverage[0].packages[0].coverage.state, "AVAILABLE_FROM_1");
    assert(!coverage[0].packages[0].suppliers.some(row => row.supplierCode === "SEAGM"), "Suppliers without live operations capability must not enter package presentation");
    assert(!coverage[0].supplierSummary.some(row => row.supplierCode === "SEAGM"), "Suppliers without live operations capability must not enter product summaries");
    assert.strictEqual(coverage[0].packages[0].suppliers.find(row => row.supplierCode === "FAZERCARDS").affectedOrderCount, 3);
    const filtered = operations.buildProductPackageCoverage({ snapshots, products, packages, mappings, filters: { productCode: "freefire" } });
    assert.deepStrictEqual(filtered.map(row => row.productCode), ["freefire"], "Product filter must preserve canonical grouping");
    const supplierFiltered = operations.buildProductPackageCoverage({ snapshots, products, packages, mappings, filters: { productCode: "mlbb", packageCode: "MLBB-86", supplierCode: "WONDD", availability: "AVAILABLE" } });
    assert.deepStrictEqual(supplierFiltered[0].packages[0].suppliers.map(row => row.supplierCode), ["WONDD"]);
}

function verifyFailureClassification() {
    assert.strictEqual(classifySupplierFailure({ failureCode: "OUT_OF_STOCK" }).category, SUPPLIER_FAILURE_CATEGORIES.OUT_OF_STOCK);
    assert.strictEqual(classifySupplierFailure({ failureCode: "WONDD_INSUFFICIENT_BALANCE" }).category, SUPPLIER_FAILURE_CATEGORIES.BALANCE_INSUFFICIENT);
    assert.strictEqual(classifySupplierFailure({ failureCode: "WONDD_TRANSPORT_ERROR" }).category, SUPPLIER_FAILURE_CATEGORIES.TIMEOUT);
    assert.strictEqual(classifySupplierFailure({ failureCode: "WONDD_ACCOUNT_CONFIGURATION_ERROR" }).category, SUPPLIER_FAILURE_CATEGORIES.AUTH_ERROR);
    assert.strictEqual(classifySupplierFailure({ failureCode: "SOMETHING_NEW" }).category, SUPPLIER_FAILURE_CATEGORIES.UNKNOWN_ERROR);
    const attempt = read("backend/models/FulfillmentAttempt.js");
    assert(attempt.includes("normalizedFailureCategory"));
    assert(attempt.includes("supplierResult"), "Raw sanitized supplier evidence must remain on FulfillmentAttempt");
}

function verifyAnalytics() {
    const paid = order();
    const historical = order({ product: { gameCode: "mlbb", gameName: "Mobile Legends", packageCode: "MLBB-86", packageName: "86 Diamonds", quantity: 2 }, commercial: { currency: "THB", region: "TH", quantity: 2, totalAmount: 220 }, quoteSnapshot: { pricingSnapshot: { businessRuntime: { supplierCostConfigured: true }, result: { currency: "THB", totalCost: 80 } } } });
    const unpaid = order({ status: "pending_payment", paymentStatus: "unpaid", payment: { status: "unpaid" }, commercial: { currency: "MMK", totalAmount: 999999, quantity: 1 } });
    const cancelled = order({ status: "cancelled", paymentStatus: "unpaid", payment: { status: "unpaid" } });
    const incomplete = order({ product: { gameCode: "freefire", gameName: "Free Fire", packageCode: "FF-100", packageName: "100 Diamonds", quantity: 1 }, quoteSnapshot: { pricingSnapshot: { businessRuntime: { supplierCostConfigured: false }, result: { currency: "MMK" } } } });
    const result = analytics.buildBusinessPerformance([paid, historical, unpaid, cancelled, incomplete]);
    assert.strictEqual(result.grossSales.MMK, 24000, "Paid revenue must use immutable order amounts only");
    assert.strictEqual(result.grossSales.THB, 220, "Currencies must remain separate");
    assert.strictEqual(result.grossProfit.MMK, 3000, "Supported profit must use persisted total cost");
    assert.strictEqual(result.grossProfit.THB, 60, "Historical supplier cost changes cannot affect snapshot profit");
    assert.strictEqual(result.profitMargin.MMK, null, "Incomplete cost evidence must suppress precise margin");
    assert.strictEqual(result.topPackages.length, 2);
    assert.strictEqual(result.topPackages[0].rank, "LV1");
    assert.strictEqual(result.topPackages[0].unitsSold, 3);
    assert.strictEqual(result.topPackages[0].productCode, "mlbb");
    assert(!read("backend/models/CommerceOrder.js").includes("packageRank"), "LV display rank must not be persisted as package metadata");
}

function verifyContracts() {
    const route = read("backend/routes/adminStats.js");
    const frontend = read("frontend/js/admin-stats.js");
    const frontendCss = read("frontend/css/admin/admin-design-system.css");
    assert(route.includes('router.get("/admin/dashboard/supplier-operations", adminMiddleware'));
    assert(route.includes("requireAdminPermission(PERMISSIONS.DASHBOARD_READ)"));
    assert(route.includes("normalizedFailureCategory: SUPPLIER_FAILURE_CATEGORIES.OUT_OF_STOCK"));
    assert(route.includes("CommerceOrder.find({ _id: { $in: stockOrderIds } })"), "Stock drill-down must use one bounded bulk order query");
    assert(frontend.includes("loadSupplierOperations(false)"));
    assert(frontend.includes("Availability uses supplier API evidence only" ) || read("frontend/admin.html").includes("Availability uses supplier API evidence only"));
    assert(!frontend.includes("setInterval(loadSupplierOperations"), "Supplier APIs must not be polled on every Dashboard interval");
    assert(frontend.includes('products.map(product => `<details class="dashboard-product-group">'), "Product groups must use an accessible disclosure and remain collapsed by default");
    assert(!frontend.includes('dashboard-product-group"${productCode !== "ALL" ? " open"'), "Selecting a product must not force product groups open by default");
    assert(frontend.includes('class="dashboard-package-coverage-row"'), "Expanded products must render canonical package disclosures");
    assert(frontend.includes('class="dashboard-supplier-badge dashboard-supplier-badge-'), "Package summaries must render supplier coverage badges");
    assert(frontend.includes("item.supplierName || item.supplierCode") && frontend.includes("supplierAvailabilityLabel(item.availability)"), "Every badge must render supplier name and normalized availability text");
    ["Available", "Out of stock", "Unavailable", "Unknown", "Not monitored"].forEach(label => assert(frontend.includes(`${label}\"`), `Supplier badge label ${label} must remain explicit`));
    assert(frontend.includes('(supplier === "ALL" || row.supplierCode === supplier)'), "Supplier filtering must limit badge coverage without changing canonical grouping");
    assert(frontend.includes('(availability === "ALL" || row.availability === availability)'), "Availability filtering must retain packages with any matching visible supplier");
    assert(frontend.includes('class="dashboard-package-evidence"'), "Existing supplier evidence must remain accessible behind package disclosure");
    assert(!frontend.includes('addEventListener("toggle"'), "Disclosure expansion must not add a supplier request or per-row listener");
    assert(frontendCss.includes(".dashboard-supplier-badges") && frontendCss.includes("flex-wrap: wrap"), "Supplier badges must wrap without a wide comparison table");
    assert(/@media \(max-width: 680px\)[\s\S]*?\.dashboard-package-coverage-row > summary \{ grid-template-columns: minmax\(0, 1fr\)/.test(frontendCss), "Mobile package rows must collapse to one column");
    assert(frontend.includes("supplier.liveOperationsVisible !== false"), "Balance cards and live supplier filters must use centralized capability visibility");
    assert(!frontend.includes('supplierCode !== "SEAGM"'), "Frontend must not scatter supplier-code exclusions");
    assert(route.includes("stockAffectedOrders"), "Historical stock-affected reporting must remain separate from live operations visibility");
    assert(route.includes("supplierCode: attempt.supplierCodeSnapshot"), "Historical supplier identity must remain sourced from immutable fulfillment evidence");
}

async function main() {
    await verifyWonddBalanceShape();
    await verifyFazerCardsAvailabilitySnapshot();
    await verifySupplierIsolationAndCaching();
    await verifyTimeoutAndAvailabilitySemantics();
    verifyProductCentricCoverage();
    verifyFailureClassification();
    verifyAnalytics();
    verifyContracts();
    console.log("Admin supplier operations and business analytics verification passed.");
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
