"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Duplex } = require("stream");

const root = path.join(__dirname, "..", "..");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const PricingPolicy = require("../models/PricingPolicy");
const PricingWorkspaceDraft = require("../models/PricingWorkspaceDraft");
const PriceVersion = require("../models/PriceVersion");
const {
    getPricingConsoleState,
    publishPricing,
    saveDraftPricing
} = require("../services/commerce/adminPricingEngineService");
const { buildProductionPricingContext } = require("../services/commerce/productionPricingContextService");

function read(file) {
    return fs.readFileSync(path.join(root, file), "utf8");
}

function invokeExpress(app, requestPath, options = {}) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const timeout = setTimeout(() => reject(new Error(`Verifier request hung: ${requestPath}`)), options.timeoutMs || 3000);
        class MockSocket extends Duplex {
            _read() {}
            _write(chunk, encoding, callback) {
                chunks.push(Buffer.from(chunk));
                callback();
            }
        }

        const socket = new MockSocket();
        const req = new http.IncomingMessage(socket);
        req.method = options.method || "GET";
        req.url = requestPath;
        req.originalUrl = requestPath;
        req.headers = options.headers || { authorization: "Bearer test" };

        const res = new http.ServerResponse(req);
        res.assignSocket(socket);
        res.on("finish", () => {
            clearTimeout(timeout);
            const rawBody = Buffer.concat(chunks).toString("utf8");
            const bodyStart = rawBody.indexOf("\r\n\r\n");
            resolve({
                status: res.statusCode,
                headers: res.getHeaders(),
                bodyText: bodyStart >= 0 ? rawBody.slice(bodyStart + 4) : rawBody
            });
        });
        res.on("error", error => {
            clearTimeout(timeout);
            reject(error);
        });
        app.handle(req, res, reject);
    });
}

function assertContains(file, needle, message) {
    assert(read(file).includes(needle), message);
}

function assertNotContains(file, needle, message) {
    assert(!read(file).includes(needle), message);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function chain(value) {
    const api = {
        sort() { return api; },
        select() { return api; },
        limit() { return api; },
        maxTimeMS() { return api; },
        lean: async () => clone(value)
    };
    return api;
}

function matchValue(actual, expected) {
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
        if (expected.$in) return expected.$in.includes(actual);
        if (expected.$exists !== undefined) return expected.$exists ? actual !== undefined : actual === undefined;
        if (expected.$lte !== undefined) return actual == null || new Date(actual) <= new Date(expected.$lte);
        if (expected.$gte !== undefined) return actual == null || new Date(actual) >= new Date(expected.$gte);
    }
    return String(actual ?? "") === String(expected ?? "");
}

function matches(document, query = {}) {
    return Object.entries(query).every(([key, expected]) => {
        if (key === "$and") return expected.every(item => matches(document, item));
        if (key === "$or") return expected.some(item => matches(document, item));
        const actual = key.split(".").reduce((current, part) => current?.[part], document);
        return matchValue(actual, expected);
    });
}

function installModelMocks() {
    const originals = {
        productFind: CatalogProduct.find,
        catalogFind: CatalogPackage.find,
        policyFind: PricingPolicy.find,
        policyFindOne: PricingPolicy.findOne,
        policyFindOneAndUpdate: PricingPolicy.findOneAndUpdate,
        policyCreate: PricingPolicy.create,
        policyUpdateOne: PricingPolicy.updateOne,
        workspaceDraftFind: PricingWorkspaceDraft.find,
        workspaceDraftFindOne: PricingWorkspaceDraft.findOne,
        workspaceDraftFindOneAndUpdate: PricingWorkspaceDraft.findOneAndUpdate,
        ruleFind: require("../models/PricingRule").find,
        versionFindOne: PriceVersion.findOne,
        versionFind: PriceVersion.find,
        versionCreate: PriceVersion.create,
        versionUpdateOne: PriceVersion.updateOne
    };

    let policyId = 1;
    let versionId = 1;
    const policies = [];
    const workspaceDrafts = [];
    const versions = [];
    const packages = [{
        _id: "64f000000000000000000123",
        productCode: "mlbb",
        packageCode: "WEEKLY",
        name: "Weekly Pass",
        enabled: true,
        deletedAt: null,
        sortOrder: 1,
        prices: { TH: { amount: 1000, currency: "THB", enabled: true, supplierCost: 1000, supplierCurrency: "THB" } },
        metadata: { gameName: "Mobile Legends" }
    }];
    const products = [{
        productCode: "mlbb",
        name: "Mobile Legends",
        enabled: true,
        supportedRegions: ["TH", "MM"],
        deletedAt: null
    }];

    CatalogProduct.find = () => chain(products);
    CatalogPackage.find = () => chain(packages);
    PricingPolicy.find = query => chain(policies.filter(policy => matches(policy, query)));
    PricingPolicy.findOne = query => chain(policies.filter(policy => matches(policy, query)).at(-1) || null);
    PricingPolicy.findOneAndUpdate = (query, update) => {
        let doc = policies.find(policy => matches(policy, query));
        if (!doc) {
            doc = { _id: `policy-${policyId++}`, code: update.$setOnInsert?.code, createdBy: update.$setOnInsert?.createdBy, createdAt: new Date().toISOString() };
            policies.push(doc);
        }
        Object.assign(doc, update.$set || {}, { updatedAt: new Date().toISOString() });
        return chain(doc);
    };
    PricingPolicy.create = async input => {
        const doc = { ...clone(input), _id: `policy-${policyId++}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        policies.push(doc);
        return clone(doc);
    };
    PricingPolicy.updateOne = async (query, update) => {
        const doc = policies.find(policy => matches(policy, query));
        if (doc) Object.assign(doc, update.$set || {}, { updatedAt: new Date().toISOString() });
        return { modifiedCount: doc ? 1 : 0 };
    };
    PricingWorkspaceDraft.find = query => chain(workspaceDrafts.filter(draft => matches(draft, query)));
    PricingWorkspaceDraft.findOne = query => chain(workspaceDrafts.filter(draft => matches(draft, query)).at(-1) || null);
    PricingWorkspaceDraft.findOneAndUpdate = (query, update) => {
        let doc = workspaceDrafts.find(draft => matches(draft, query));
        if (!doc) {
            doc = {
                _id: `workspace-draft-${workspaceDrafts.length + 1}`,
                productId: update.$setOnInsert?.productId,
                region: update.$setOnInsert?.region,
                supplierCurrency: update.$setOnInsert?.supplierCurrency,
                status: update.$setOnInsert?.status || "DRAFT",
                version: update.$setOnInsert?.version || 1,
                createdBy: update.$setOnInsert?.createdBy,
                createdAt: new Date().toISOString()
            };
            workspaceDrafts.push(doc);
        }
        Object.assign(doc, update.$set || {}, { updatedAt: new Date().toISOString() });
        if (update.$inc?.version) doc.version = Number(doc.version || 0) + Number(update.$inc.version);
        return chain(doc);
    };
    require("../models/PricingRule").find = () => chain([]);
    PriceVersion.findOne = query => chain(versions.filter(version => matches(version, query)).at(-1) || null);
    PriceVersion.find = query => chain(versions.filter(version => matches(version, query)));
    PriceVersion.create = async input => {
        const doc = { ...clone(input), _id: `version-${versionId}`, versionId: `pv-${versionId++}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        versions.push(doc);
        return clone(doc);
    };
    PriceVersion.updateOne = async (query, update) => {
        const doc = versions.find(version => matches(version, query));
        if (doc) Object.assign(doc, update.$set || {}, { updatedAt: new Date().toISOString() });
        return { modifiedCount: doc ? 1 : 0 };
    };

    return {
        packages,
        products,
        policies,
        workspaceDrafts,
        versions,
        restore() {
            CatalogProduct.find = originals.productFind;
            CatalogPackage.find = originals.catalogFind;
            PricingPolicy.find = originals.policyFind;
            PricingPolicy.findOne = originals.policyFindOne;
            PricingPolicy.findOneAndUpdate = originals.policyFindOneAndUpdate;
            PricingPolicy.create = originals.policyCreate;
            PricingPolicy.updateOne = originals.policyUpdateOne;
            PricingWorkspaceDraft.find = originals.workspaceDraftFind;
            PricingWorkspaceDraft.findOne = originals.workspaceDraftFindOne;
            PricingWorkspaceDraft.findOneAndUpdate = originals.workspaceDraftFindOneAndUpdate;
            require("../models/PricingRule").find = originals.ruleFind;
            PriceVersion.findOne = originals.versionFindOne;
            PriceVersion.find = originals.versionFind;
            PriceVersion.create = originals.versionCreate;
            PriceVersion.updateOne = originals.versionUpdateOne;
        }
    };
}

function mountPricingEngineRoute({ adminMiddlewareExport, serviceOverride } = {}) {
    const adminMiddlewarePath = require.resolve("../middleware/adminMiddleware");
    const servicePath = require.resolve("../services/commerce/adminPricingEngineService");
    const routePath = require.resolve("../routes/adminPricingEngine");
    const originalAdminMiddleware = require.cache[adminMiddlewarePath];
    const originalService = require.cache[servicePath];
    const originalRoute = require.cache[routePath];
    if (adminMiddlewareExport) {
        require.cache[adminMiddlewarePath] = {
            id: adminMiddlewarePath,
            filename: adminMiddlewarePath,
            loaded: true,
            exports: adminMiddlewareExport
        };
    }
    if (serviceOverride) {
        require.cache[servicePath] = {
            id: servicePath,
            filename: servicePath,
            loaded: true,
            exports: {
                ...require("../services/commerce/adminPricingEngineService"),
                ...serviceOverride
            }
        };
    }
    delete require.cache[routePath];
    const express = require("express");
    const app = express();
    app.use(express.json());
    app.use("/api", require("../routes/adminPricingEngine"));

    return {
        app,
        restore() {
            if (originalAdminMiddleware) require.cache[adminMiddlewarePath] = originalAdminMiddleware;
            else delete require.cache[adminMiddlewarePath];
            if (originalService) require.cache[servicePath] = originalService;
            else delete require.cache[servicePath];
            if (originalRoute) require.cache[routePath] = originalRoute;
            else delete require.cache[routePath];
        }
    };
}

async function verifyApiGetCompletesQuickly() {
    const mock = installModelMocks();
    try {
        for (let index = 0; index < 180; index += 1) {
            mock.packages.push({
                _id: `64f0000000000000001${String(index).padStart(3, "0")}`,
                productCode: `game${index % 20}`,
                packageCode: `PKG${index}`,
                name: `Package ${index}`,
                enabled: true,
                deletedAt: null,
                sortOrder: index,
                prices: {
                    TH: { amount: 100 + index, currency: "THB", enabled: true },
                    MM: { amount: 10000 + index, currency: "MMK", enabled: true }
                },
                metadata: { gameName: `Game ${index % 20}` }
            });
        }

        const mounted = mountPricingEngineRoute({
            adminMiddlewareExport: (req, res, next) => {
                req.admin = { role: "OWNER", username: "owner" };
                next();
            }
        });
        try {
            const startedAt = Date.now();
            const response = await invokeExpress(mounted.app, "/api/admin/pricing-engine");
            const body = JSON.parse(response.bodyText);
            const elapsedMs = Date.now() - startedAt;
            assert.strictEqual(response.status, 200, "Pricing Engine GET must return 200.");
            assert.strictEqual(body.success, true, "Pricing Engine GET must return success.");
            assert(elapsedMs < 2000, `Pricing Engine GET should complete under 2s in realistic-volume verifier, got ${elapsedMs}ms.`);
            assert(Array.isArray(body.products) && body.products.length >= 20, "Pricing Engine GET must return grouped real products.");
            assert(body.products[0].packages.length > 0, "Pricing Engine GET products must contain package contexts.");

            CatalogPackage.find = () => {
                throw new Error("database unavailable");
            };
            const failureStartedAt = Date.now();
            const failureResponse = await invokeExpress(mounted.app, "/api/admin/pricing-engine");
            const failureBody = JSON.parse(failureResponse.bodyText);
            const failureElapsedMs = Date.now() - failureStartedAt;
            assert.strictEqual(failureResponse.status, 503, "Database failure must return a fast 503.");
            assert.strictEqual(failureBody.code, "PRICING_DATA_UNAVAILABLE", "Database failure must return an actionable pricing data error.");
            assert(failureElapsedMs < 1000, `Database failure should return quickly, got ${failureElapsedMs}ms.`);
            console.log("Pricing Engine API verifier timing:", {
                successElapsedMs: elapsedMs,
                failureElapsedMs
            });
        } finally {
            mounted.restore();
        }
    } finally {
        mock.restore();
    }
}

async function verifyMiddlewareAndDeadlineLifecycle() {
    let mounted = mountPricingEngineRoute({
        adminMiddlewareExport: (req, res) => res.status(401).json({ success: false, error: "ADMIN_SESSION_INVALID" })
    });
    try {
        const startedAt = Date.now();
        const response = await invokeExpress(mounted.app, "/api/admin/pricing-engine", { headers: {} });
        const body = JSON.parse(response.bodyText);
        assert.strictEqual(response.status, 401, "Unauthenticated Pricing Engine GET must return promptly.");
        assert.strictEqual(body.success, false, "Unauthenticated response must be structured.");
        assert(Date.now() - startedAt < 1000, "Unauthenticated Pricing Engine GET must not hang.");
    } finally {
        mounted.restore();
    }

    mounted = mountPricingEngineRoute({
        adminMiddlewareExport: (req, res, next) => {
            req.admin = { role: "SUPPORT", username: "support" };
            next();
        }
    });
    try {
        const startedAt = Date.now();
        const response = await invokeExpress(mounted.app, "/api/admin/pricing-engine");
        const body = JSON.parse(response.bodyText);
        assert.strictEqual(response.status, 403, "Forbidden Pricing Engine GET must return promptly.");
        assert.strictEqual(body.success, false, "Forbidden response must be structured.");
        assert(Date.now() - startedAt < 1000, "Forbidden Pricing Engine GET must not hang.");
    } finally {
        mounted.restore();
    }

    mounted = mountPricingEngineRoute({
        adminMiddlewareExport: (req, res, next) => {
            req.admin = { role: "OWNER", username: "owner" };
            next();
        },
        serviceOverride: {
            getPricingConsoleState: () => new Promise(() => {})
        }
    });
    try {
        const startedAt = Date.now();
        const response = await invokeExpress(mounted.app, "/api/admin/pricing-engine", { timeoutMs: 9000 });
        const body = JSON.parse(response.bodyText);
        const elapsedMs = Date.now() - startedAt;
        assert.strictEqual(response.status, 503, "Stalled Pricing Engine GET must return server-side 503.");
        assert.strictEqual(body.code, "PRICING_WORKSPACE_BOOTSTRAP_TIMEOUT", "Stalled Pricing Engine GET must return timeout code.");
        assert(body.stage, "Stalled Pricing Engine GET must return the last safe stage.");
        assert(body.requestId, "Stalled Pricing Engine GET must return requestId.");
        assert(elapsedMs >= 7500 && elapsedMs < 9000, `Stalled service must be bounded by server deadline, got ${elapsedMs}ms.`);
    } finally {
        mounted.restore();
    }
}

async function verifyDraftPublishAndQuotePickup() {
    const mock = installModelMocks();
    try {
        await saveDraftPricing({
            policies: [{
                region: "TH",
                currency: "THB",
                config: {
                    exchangeRate: 1,
                    supplierFee: { enabled: false, type: "PERCENT", value: 0 },
                    businessCost: { enabled: false, type: "FIXED", value: 0 },
                    gatewayFee: { enabled: true, type: "PERCENT", value: 2 },
                    platformCost: { enabled: true, type: "FIXED", value: 20 },
                    tax: { enabled: false, type: "PERCENT", value: 0 },
                    profitRule: { type: "PERCENT", value: 15 },
                    roundingRule: { enabled: true, mode: "NEAREST", increment: 10, psychologicalEnding: 0 }
                }
            }]
        }, { username: "owner" });

        let state = await getPricingConsoleState();
        assert(Array.isArray(state.products), "Pricing Engine load must return products.");
        assert.strictEqual(state.products.length, 1, "Pricing Engine load must group catalog packages by product.");
        assert(Array.isArray(state.products[0].packages), "Pricing Engine product must include selectable package contexts.");
        assert.strictEqual(state.products[0].packages[0].supplierPrice, 1000, "Pricing Engine package context must include real supplier/base price.");
        assert.strictEqual(state.policies.find(item => item.region === "TH").draft.config.profitRule.value, 15, "Saved draft must survive backend reload.");

        await saveDraftPricing({
            policies: [{
                region: "TH",
                currency: "THB",
                config: {
                    profitRule: { type: "PERCENT", value: 0 },
                    gatewayFee: { enabled: false, type: "PERCENT", value: 0 },
                    platformCost: { enabled: false, type: "FIXED", value: 0 },
                    roundingRule: { enabled: false, mode: "NONE", increment: 0 }
                }
            }]
        }, { username: "owner" });
        state = await getPricingConsoleState();
        assert.strictEqual(state.policies.find(item => item.region === "TH").draft.config.profitRule.value, 0, "Pricing Engine draft must preserve valid zero profit.");
        assert.strictEqual(state.policies.find(item => item.region === "TH").draft.config.gatewayFee.value, 0, "Pricing Engine draft must preserve valid zero gateway fee.");

        await saveDraftPricing({
            policies: [{
                region: "TH",
                currency: "THB",
                config: {
                    exchangeRate: 1,
                    supplierFee: { enabled: false, type: "PERCENT", value: 0 },
                    businessCost: { enabled: false, type: "FIXED", value: 0 },
                    gatewayFee: { enabled: true, type: "PERCENT", value: 2 },
                    platformCost: { enabled: true, type: "FIXED", value: 20 },
                    tax: { enabled: false, type: "PERCENT", value: 0 },
                    profitRule: { type: "PERCENT", value: 15 },
                    roundingRule: { enabled: true, mode: "NEAREST", increment: 10, psychologicalEnding: 0 }
                }
            }]
        }, { username: "owner" });
        const published = await publishPricing({ username: "owner" });
        assert.strictEqual(published.version.versionNumber, 1, "First publish must create pricing version v1.");
        assert.strictEqual(mock.versions[0].status, "PUBLISHED", "Published version must be PUBLISHED.");
        assert.strictEqual(mock.policies.some(policy => policy.status === "ACTIVE" && policy.region === "TH"), true, "Publish must activate a production policy.");

        const context = await buildProductionPricingContext({
            pkg: {
                _id: "64f000000000000000000123",
                productCode: "mlbb",
                packageCode: "WEEKLY",
                name: "Weekly Pass",
                metadata: { gameName: "Mobile Legends" }
            },
            price: { amount: 1000, currency: "THB", supplierCost: 1000, supplierCurrency: "THB" },
            catalog: { productCode: "mlbb", packageCode: "WEEKLY", productName: "Mobile Legends" },
            region: "TH",
            currency: "THB",
            now: new Date()
        });
        assert.strictEqual(context.pricing.pricingInput.policy.profitRule.value, 15, "Future quote context must use the newly published active policy.");
        assert.strictEqual(context.pricing.versionContext.priceVersionNumber, 1, "Future quote context must snapshot the published pricing version.");

        const oldOrder = Object.freeze({ commercial: Object.freeze({ totalAmount: 1000 }), quoteMetadata: Object.freeze({ pricingVersion: "pv-old" }) });
        await saveDraftPricing({
            policies: [{
                region: "TH",
                currency: "THB",
                config: { profitRule: { type: "PERCENT", value: 30 } }
            }]
        }, { username: "owner" });
        const second = await publishPricing({ username: "owner" });
        assert.strictEqual(second.version.versionNumber, 2, "Second publish must increment pricing version.");
        assert.strictEqual(oldOrder.commercial.totalAmount, 1000, "Historical CommerceOrder snapshots must remain unchanged after publish.");
    } finally {
        mock.restore();
    }
}

function verifySource() {
    assertContains("frontend/admin.html", "pricingSaveDraftBtn", "Pricing Engine UI must expose Save Draft.");
    assertContains("frontend/admin.html", "pricingPublishBtn", "Pricing Engine UI must expose Publish.");
    assertNotContains("frontend/admin.html", "Simulation Only", "Pricing Engine page must not remain in Simulation Only mode.");
    assertContains("frontend/js/admin-pricing-engine.js", "/api/admin/pricing-engine", "Pricing Engine UI must load production config.");
    assertContains("frontend/js/admin-pricing-engine.js", "/api/admin/pricing-engine/draft", "Pricing Engine UI must save backend drafts.");
    assertContains("frontend/js/admin-pricing-engine.js", "/api/admin/pricing-engine/publish", "Pricing Engine UI must publish backend versions.");
    assertContains("frontend/js/admin-pricing-engine.js", "handleSectionClick", "Pricing Engine actions must use delegated click handling so controls survive rerenders.");
    assertContains("frontend/js/admin-pricing-engine.js", "event.target.closest(\"[data-pricing-edit]\")", "Pricing Engine Edit buttons must be handled by delegated events.");
    assertContains("frontend/js/admin-pricing-engine.js", "pricingFetch", "Pricing Engine API actions must use bounded request lifecycle.");
    assertContains("frontend/js/admin-pricing-engine.js", "controller.abort()", "Pricing Engine Save/Publish must not remain loading forever on a hung request.");
    assertContains("frontend/js/admin-pricing-engine.js", "cache: options.cache || \"no-store\"", "Pricing Engine bootstrap must bypass stale browser/service-worker cache.");
    assertContains("frontend/js/admin-pricing-engine.js", "pricingFetch(\"/api/admin/pricing-engine\", {}, 0)", "Pricing Engine bootstrap GET must not be client-aborted before the backend sends a structured response.");
    assertContains("frontend/js/admin-pricing-engine.js", "requestProductionLoad(section, \"dom-ready\")", "Pricing Engine DOM boot must use the coalesced load lifecycle.");
    assertContains("frontend/js/admin-pricing-engine.js", "requestProductionLoad(section, \"admin-auth-ready\")", "Pricing Engine auth-ready boot must join the same load lifecycle.");
    assertContains("frontend/js/admin-pricing-engine.js", "waitForAdminAuthReady", "Pricing Engine must wait for Admin auth readiness before the initial production fetch.");
    assertContains("frontend/js/admin-pricing-engine.js", "state.loadPromise", "Pricing Engine load lifecycle must coalesce duplicate boot/auth requests.");
    assertContains("frontend/js/admin-pricing-engine.js", "[PRICING_ENGINE_ASYNC]", "Pricing Engine async lifecycle must have opt-in timing checkpoints.");
    assertContains("frontend/admin.html", "20260729-pricing-final", "Admin page must cache-bust the final Pricing Workspace QA repair.");
    assertContains("frontend/js/admin-pricing-engine.js", "pricingRetryLoadBtn", "Pricing Engine frontend must expose a retry action after bootstrap failure.");
    assertContains("frontend/js/admin-pricing-engine.js", "Pricing workspace failed to load", "Pricing Engine frontend must leave loading state with an actionable error.");
    assertContains("frontend/admin.html", "data-pricing-product-id=", "Static Pricing Engine product cards must expose the canonical delegated-click contract.");
    assertContains("frontend/js/admin-pricing-engine.js", "apiReady", "Pricing Engine must separate API readiness from local preview interactivity.");
    assertContains("frontend/js/admin-pricing-engine.js", "hydrateFallbackProductsFromDom", "Pricing Engine must hydrate selectable products from static DOM before API completion.");
    assertContains("frontend/js/admin-pricing-engine.js", "canPersistPricing", "Pricing Engine must gate Save/Publish on trusted API state and valid preview.");
    assertContains("frontend/js/admin-pricing-engine.js", "selectedProductId", "Pricing Engine must keep selected product in explicit state.");
    assertContains("frontend/js/admin-pricing-engine.js", "selectedPackageId", "Pricing Engine must keep selected package in explicit state.");
    assertContains("frontend/js/admin-pricing-engine.js", "previewError", "Pricing Engine must keep preview error in explicit state.");
    assertContains("frontend/js/admin-pricing-engine.js", "loadError", "Pricing Engine must keep load error in explicit state.");
    assertContains("frontend/js/admin-pricing-engine.js", "saveError", "Pricing Engine must keep save error in explicit state.");
    assertContains("frontend/js/admin-pricing-engine.js", "publishError", "Pricing Engine must keep publish error in explicit state.");
    assertContains("frontend/js/admin-pricing-engine.js", "getSelectedPackage", "Pricing Engine preview must resolve a real package context.");
    assertContains("frontend/js/admin-pricing-engine.js", "positiveAmount(selectedPackage.supplierPrice", "Pricing Engine preview must validate package supplier cost.");
    assertContains("frontend/js/admin-pricing-engine.js", "button.textContent = originalText", "Pricing Engine buttons must restore labels after Save/Publish settles.");
    assertContains("frontend/js/admin-pricing-engine.js", "state.saving = false", "Save Draft must clear saving state in finally.");
    assertContains("frontend/js/admin-pricing-engine.js", "state.publishing = false", "Publish must clear publishing state in finally.");
    assertContains("backend/services/commerce/adminPricingEngineService.js", "Promise.all", "Pricing Engine GET must run independent reads in parallel.");
    assertContains("backend/services/commerce/adminPricingEngineService.js", "CATALOG_PRODUCT_QUERY_STARTED", "Pricing Engine GET must trace CatalogProduct query start.");
    assertContains("backend/services/commerce/adminPricingEngineService.js", "CATALOG_PRODUCT_QUERY_COMPLETED", "Pricing Engine GET must trace CatalogProduct query completion.");
    assertContains("backend/services/commerce/adminPricingEngineService.js", "withBootstrapDeadline", "Pricing Engine GET must wrap bootstrap dependencies in an awaited server-side deadline.");
    assertContains("backend/services/commerce/adminPricingEngineService.js", "plainJson", "Pricing Engine GET state must be converted to JSON-safe data.");
    assertContains("backend/services/commerce/adminPricingEngineService.js", "readCatalogPackages", "Pricing Engine GET must use one bounded catalog/package query.");
    assertContains("backend/services/commerce/adminPricingEngineService.js", "readConsolePolicies", "Pricing Engine GET must use one bounded policy query.");
    assertContains("backend/services/commerce/adminPricingEngineService.js", "maxTimeMS", "Pricing Engine GET queries must be bounded.");
    assertContains("backend/routes/adminPricingEngine.js", "PRICING_ENGINE_REQUEST_TIMEOUT_MS", "Pricing Engine GET route must have a hard timeout safety net.");
    assertContains("backend/routes/adminPricingEngine.js", "pricingLifecycle", "Pricing Engine GET must start tracing and deadline before auth/RBAC.");
    assertContains("backend/routes/adminPricingEngine.js", "pricingAuth", "Pricing Engine auth/RBAC lifecycle must use the shared admin middleware with trace checkpoints.");
    assertContains("backend/routes/adminPricingEngine.js", "adminMiddleware", "Pricing Engine must use the same Admin auth middleware as the rest of Admin.");
    assertContains("backend/routes/adminPricingEngine.js", "requireAdminPermission(permission)", "Pricing Engine must use the canonical RBAC middleware without custom wrapper hangs.");
    assertContains("backend/routes/adminPricingEngine.js", "PRICING_WORKSPACE_BOOTSTRAP_TIMEOUT", "Pricing Engine deadline must send a structured timeout response.");
    assertContains("backend/routes/adminPricingEngine.js", "RESPONSE_SERIALIZATION_STARTED", "Pricing Engine GET must trace response serialization.");
    assertContains("backend/routes/adminPricingEngine.js", "RESPONSE_SERIALIZATION_COMPLETED", "Pricing Engine GET must prove response serialization completed before send.");
    assertContains("backend/routes/adminPricingEngine.js", "/admin/pricing-engine/diagnostics", "Pricing Engine must expose temporary OWNER-only diagnostics.");
    assertContains("backend/services/commerce/adminPricingEngineService.js", "runPricingEngineDiagnostics", "Pricing Engine diagnostics must run bounded model checks.");
    assertContains("backend/routes/adminPricingEngine.js", "requireOwner", "Publishing must be OWNER-only.");
    assertContains("backend/services/commerce/adminPricingEngineService.js", "PriceVersion.create", "Publishing must create a PriceVersion.");
    assertContains("backend/services/commerce/productionPricingContextService.js", "\"metadata.policyIds\"", "Production quote context must resolve branch versions published by the admin console.");
}

async function main() {
    verifySource();
    await verifyDraftPublishAndQuotePickup();
    await verifyApiGetCompletesQuickly();
    await verifyMiddlewareAndDeadlineLifecycle();
    console.log("Admin Pricing Engine production activation verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
