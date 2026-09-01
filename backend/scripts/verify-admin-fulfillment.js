const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function includes(file, pattern, message) {
    assert(read(file).includes(pattern), `${file}: ${message}`);
}

function notIncludes(file, pattern, message) {
    assert(!read(file).includes(pattern), `${file}: ${message}`);
}

function matches(file, pattern, message) {
    assert(pattern.test(read(file)), `${file}: ${message}`);
}

function verifyModels() {
    includes("backend/models/Supplier.js", "supplierCode", "Supplier canonical identity must exist.");
    includes("backend/models/Supplier.js", "immutable: true", "supplierCode must be immutable.");
    includes("backend/models/Supplier.js", "unique: true", "supplierCode must be unique.");
    includes("backend/models/Supplier.js", "MANUAL", "MANUAL supplier mode must exist.");
    includes("backend/models/Supplier.js", "API", "API supplier mode must exist.");
    includes("backend/models/Supplier.js", "UNKNOWN", "UNKNOWN balance source must exist.");
    includes("backend/models/Supplier.js", "supportedRegions", "Supplier supported regions must be modeled.");
    includes("backend/models/SupplierProductMapping.js", "supplierProductCode", "Supplier mapping product identity must exist.");
    includes("backend/models/SupplierProductMapping.js", "supplierPackageCode", "Supplier mapping package identity must exist.");
    includes("backend/models/SupplierProductMapping.js", "productCode: 1, packageCode: 1, region: 1", "Mapping uniqueness must include AZIEL package identity and region.");
    notIncludes("backend/models/SupplierProductMapping.js", "sell", "Mapping must not own customer sell price.");
    includes("backend/models/FulfillmentAttempt.js", "fulfillmentId", "Fulfillment must have readable identity.");
    includes("backend/models/FulfillmentAttempt.js", "PENDING", "Canonical fulfillment statuses must exist.");
    includes("backend/models/FulfillmentAttempt.js", "IN_PROGRESS", "Canonical fulfillment statuses must exist.");
    includes("backend/models/FulfillmentAttempt.js", "SUCCEEDED", "Canonical fulfillment statuses must exist.");
    includes("backend/models/FulfillmentAttempt.js", "FAILED", "Canonical fulfillment statuses must exist.");
    includes("backend/models/FulfillmentAttempt.js", "CANCELLED", "Canonical fulfillment statuses must exist.");
    includes("backend/models/FulfillmentAttempt.js", "partialFilterExpression", "Active/succeeded attempt database protection must exist.");
    includes("backend/models/FulfillmentAttempt.js", "idempotencyKey", "Fulfillment idempotency boundary must exist.");
}

function verifyServiceOwnership() {
    const service = read("backend/services/fulfillmentService.js");
    includes("backend/services/fulfillmentService.js", "class FulfillmentError", "Fulfillment service error contract must exist.");
    includes("backend/services/fulfillmentService.js", "validateCatalogPackage", "Mappings must validate real catalog product/package truth.");
    includes("backend/services/fulfillmentService.js", "SUPPLIER_ALREADY_EXISTS", "Duplicate supplierCode must be rejected.");
    includes("backend/services/fulfillmentService.js", "SUPPLIER_CODE_IMMUTABLE", "Supplier code changes must be rejected.");
    includes("backend/services/fulfillmentService.js", "INVALID_SUPPLIER_MODE", "Invalid supplier mode must be rejected.");
    includes("backend/services/fulfillmentService.js", "INVALID_REGION", "Unknown region must be rejected.");
    includes("backend/services/fulfillmentService.js", "SUPPLIER_REGION_UNSUPPORTED", "Mapping must reject a supplier that does not support the selected region.");
    includes("backend/services/fulfillmentService.js", "supplier.supportedRegions.includes(region)", "Mapping validation must use persisted supplier supported-region truth.");
    includes("backend/services/fulfillmentService.js", "normalizeBalanceAmount", "Supplier update must validate manual balance amount.");
    includes("backend/services/fulfillmentService.js", "normalizeBalanceCurrency", "Supplier update must validate balance currency.");
    includes("backend/services/fulfillmentService.js", "SUPPLIER_DISABLED", "Disabled supplier must block new mappings/attempts.");
    includes("backend/services/fulfillmentService.js", "SUPPLIER_MAPPING_ALREADY_EXISTS", "Duplicate mappings must be rejected.");
    includes("backend/services/fulfillmentService.js", "SUPPLIER_MAPPING_REQUIRED", "Fulfillment start must require mapping.");
    includes("backend/services/fulfillmentService.js", "FULFILLMENT_ALREADY_ACTIVE", "One active attempt per order must be enforced.");
    includes("backend/services/fulfillmentService.js", "FULFILLMENT_IDEMPOTENCY_REUSED", "A terminal failed attempt must not be returned as a successful retry start.");
    includes("backend/services/fulfillmentService.js", "ORDER_ALREADY_FULFILLED", "Succeeded attempt must block second fulfillment.");
    includes("backend/services/fulfillmentService.js", "ORDER_NOT_FULFILLMENT_ELIGIBLE", "Order eligibility must be enforced.");
    includes("backend/services/fulfillmentService.js", "transitionOrder(order, ORDER_STATES.PROCESSING", "Start must use canonical order transition owner.");
    includes("backend/services/fulfillmentService.js", "transitionOrder(order, ORDER_STATES.COMPLETED", "Success must use canonical order transition owner.");
    includes("backend/services/fulfillmentService.js", "transitionOrder(order, ORDER_STATES.FAILED", "Failure must use canonical order transition owner when allowed.");
    assert(!/order\.status\s*=/.test(service), "Fulfillment service must not directly mutate Order status.");
    includes("backend/services/fulfillmentService.js", "FAILURE_REASON_REQUIRED", "Mark Failed must require reason.");
    includes("backend/services/fulfillmentService.js", "supplierReference", "Supplier reference must be recorded.");
    includes("backend/services/fulfillmentService.js", "writeAdminAudit", "Fulfillment actions must be audited.");
}

function verifyAdapterBoundary() {
    includes("backend/services/supplierAdapterRegistry.js", "SupplierAdapterError", "Adapter error contract must exist.");
    includes("backend/services/supplierAdapterRegistry.js", "MANUAL_SUPPLIER_REQUIRES_ADMIN_ACTION", "Manual supplier must not auto-submit.");
    includes("backend/services/supplierAdapterRegistry.js", "SUPPLIER_ADAPTER_NOT_CONFIGURED", "API supplier without adapter must fail safely.");
    includes("backend/services/supplierAdapterRegistry.js", "normalizeSupplierResult", "Normalized supplier result contract must exist.");
    includes("backend/services/supplierAdapterRegistry.js", "sanitizeProviderMetadata", "Provider metadata must be sanitized.");
    notIncludes("backend/services/supplierAdapterRegistry.js", "Math.random", "Adapter must not generate fake production references.");
}

function verifyRoutesAndRbac() {
    includes("backend/services/adminAuthorizationService.js", "SUPPLIERS_READ", "Supplier read permission must be backend-owned.");
    includes("backend/services/adminAuthorizationService.js", "SUPPLIERS_MANAGE", "Supplier manage permission must be backend-owned.");
    includes("backend/services/adminAuthorizationService.js", "SUPPLIER_MAPPINGS_MANAGE", "Mapping manage permission must be backend-owned.");
    includes("backend/services/adminAuthorizationService.js", "FULFILLMENT_READ", "Fulfillment read permission must be backend-owned.");
    includes("backend/services/adminAuthorizationService.js", "FULFILLMENT_EXECUTE", "Fulfillment execute permission must be backend-owned.");
    includes("backend/services/adminAuthorizationService.js", "FULFILLMENT_RESOLVE", "Fulfillment resolve permission must be backend-owned.");
    includes("backend/routes/supplier.js", "adminMiddleware", "Supplier routes must require Admin auth.");
    includes("backend/routes/supplier.js", "requireAdminPermission(PERMISSIONS.SUPPLIERS_MANAGE", "Supplier mutation routes must enforce permissions.");
    includes("backend/routes/supplier.js", "requireAdminPermission(PERMISSIONS.FULFILLMENT_EXECUTE", "Fulfillment execution routes must enforce permissions.");
    includes("backend/routes/supplier.js", "startManualAdminFulfillment(req.params.fulfillmentId", "Existing MANUAL_ADMIN attempts must delegate to the fulfillment domain start authority.");
    includes("backend/services/fulfillmentService.js", "async function startManualAdminFulfillment", "MANUAL_ADMIN start authority must exist.");
    includes("backend/services/fulfillmentService.js", "FULFILLMENT_ROUTE_MISMATCH", "Supplier attempts must remain outside MANUAL_ADMIN start semantics.");
    includes("backend/services/fulfillmentService.js", "FULFILLMENT_NOT_STARTABLE", "Resolved attempts must be rejected by the start authority.");
    includes("backend/services/fulfillmentService.js", "idempotent: true", "Duplicate active MANUAL_ADMIN start must be idempotent.");
    includes("backend/services/fulfillmentService.js", 'String(order.paymentStatus || order.payment?.status || "") !== "paid"', "Unpaid Commerce orders must be rejected.");
    includes("backend/services/fulfillmentService.js", "session.withTransaction", "MANUAL_ADMIN attempt and CommerceOrder start transitions must be atomic.");
    includes("backend/services/fulfillmentService.js", 'toStatus: "processing"', "MANUAL_ADMIN start must transition Commerce fulfillment/order to processing.");
    includes("backend/routes/supplier.js", "requireAdminPermission(PERMISSIONS.FULFILLMENT_RESOLVE", "Fulfillment resolve routes must enforce permissions.");
    includes("backend/routes/supplier.js", "MOCK_SUPPLIER_DISABLED", "Legacy mock supplier route must be disabled.");
    includes("backend/routes/order.js", "router.get(\"/admin/orders/:id\"", "Admin must expose a single-order detail refresh endpoint.");
    includes("backend/routes/order.js", "projectAdminOrder(order, attempts)", "Single-order detail refresh must use canonical fulfillment projection.");
    includes("backend/server.js", '["supplier", "wallet", "support", "settings", "paymentMethods"]', "Supplier routes must be included in the mounted API route set.");
    includes("backend/server.js", 'app.use("/api", require(`./routes/${route}`))', "The supplier route set must be mounted under /api.");
}

function verifyOrderIntegration() {
    includes("backend/routes/order.js", "getOrderFulfillmentSummary", "Admin orders must project fulfillment state.");
    includes("backend/routes/order.js", "FULFILLMENT_ACTIVE", "Direct completion must be guarded during active fulfillment.");
    includes("frontend/js/admin-orders.js", "renderOrderFulfillment", "Admin Order detail must expose Fulfillment section.");
    includes("frontend/js/admin-orders.js", "bindOrderFulfillment", "Admin Order detail must bind fulfillment actions.");
    includes("frontend/js/admin-orders.js", "!activeFulfillment", "Direct Complete action must be hidden during active fulfillment.");
}

async function verifyFrontend() {
    const frontend = read("frontend/js/admin-fulfillment.js");
    const adminSecurity = read("frontend/js/admin-security.js");
    const adminHtml = read("frontend/admin.html");
    includes("frontend/admin.html", "section-fulfillment", "Fulfillment Admin module must exist.");
    includes("frontend/admin.html", "data-section=\"fulfillment\"", "Fulfillment navigation must exist.");
    includes("frontend/js/admin-fulfillment.js", "fulfillmentState", "Fulfillment UI must have canonical active-view state.");
    includes("frontend/js/admin-fulfillment.js", "activeView", "Fulfillment active view must be explicit.");
    includes("frontend/js/admin-fulfillment.js", "FULFILLMENT_VIEW_PANELS", "Fulfillment tab-to-panel ownership must be explicit.");
    includes("frontend/js/admin-fulfillment.js", "syncFulfillmentViewVisibility", "Fulfillment visibility must have one explicit owner.");
    includes("frontend/js/admin-fulfillment.js", "openFulfillmentView", "Tab switching must use a controller function.");
    includes("frontend/js/admin-fulfillment.js", "loadFulfillmentData({ view", "Tab switching must invoke view-specific load/render behavior.");
    includes("frontend/js/admin-fulfillment.js", "refreshActiveFulfillmentView", "Refresh must use the active fulfillment view.");
    includes("frontend/js/admin-fulfillment.js", "fulfillmentReferenceState", "Fulfillment reference data must have explicit lifecycle ownership.");
    includes("frontend/js/admin-fulfillment.js", "packageInFlight", "Fulfillment package requests must coalesce identical in-flight product contexts.");
    includes("frontend/js/admin-fulfillment.js", "packageCache", "Fulfillment package data must be reused during the controller lifecycle.");
    includes("frontend/js/admin-fulfillment.js", "loadFulfillmentProductPackages", "Package loading must have one controller-owned function.");
    includes("frontend/js/admin-fulfillment.js", "coalesceKey", "Fulfillment request gates must coalesce identical in-flight requests.");
    includes("frontend/js/admin-fulfillment.js", "view === \"suppliers\"", "Suppliers tab must own a real load path.");
    includes("frontend/js/admin-fulfillment.js", "view === \"mappings\"", "Mappings tab must own a real load path.");
    includes("frontend/js/admin-fulfillment.js", "view === \"attempts\"", "Attempts tab must own a real load path.");
    includes("frontend/js/admin-fulfillment.js", "/api/admin/suppliers", "Frontend must use supplier APIs.");
    includes("frontend/js/admin-fulfillment.js", "/api/admin/supplier-mappings", "Frontend must use mapping APIs.");
    includes("frontend/js/admin-fulfillment.js", "/api/admin/fulfillments", "Frontend must use fulfillment APIs.");
    includes("frontend/js/admin-fulfillment.js", "renderFulfillmentLoadingState", "Fulfillment views must render loading states.");
    includes("frontend/js/admin-fulfillment.js", "renderFulfillmentEmptyState", "Fulfillment views must render empty states.");
    includes("frontend/js/admin-fulfillment.js", "renderFulfillmentErrorState", "Fulfillment views must render scoped error states.");
    includes("frontend/js/admin-fulfillment.js", "bindFulfillmentRetry", "Fulfillment error states must expose retry behavior.");
    includes("frontend/js/admin-fulfillment.js", "no_supplier_mappings_yet", "Empty mappings array must render a real empty state.");
    includes("frontend/js/admin-fulfillment.js", "mapping_empty_hint", "Mappings empty state must explain dependency.");
    includes("frontend/js/admin-fulfillment.js", "no_suppliers_available", "Mappings view must show no-supplier dependency state.");
    includes("frontend/js/admin-fulfillment.js", "no_fulfillment_attempts_yet", "Empty attempts array must render a real empty state.");
    includes("frontend/js/admin-fulfillment.js", "attempts_empty_hint", "Attempts empty state must explain when attempts appear.");
    includes("frontend/js/admin-fulfillment.js", "unable_load_mappings", "Mappings API failure must render a scoped state.");
    includes("frontend/js/admin-fulfillment.js", "unable_load_attempts", "Attempts API failure must render a scoped state.");
    includes("frontend/js/admin-fulfillment.js", "showAdminToast", "API failures must not be silently swallowed.");
    includes("frontend/js/admin-fulfillment.js", "normalizeSupplierRegionsInput", "Supplier supported regions must be normalized by the admin payload path.");
    includes("frontend/js/admin-fulfillment.js", "normalizeSupplierCodeField", "Supplier code UX must normalize obvious casing/invalid characters.");
    includes("frontend/js/admin-fulfillment.js", "supportedRegions: regions", "Supplier payload must include supportedRegions.");
    includes("frontend/js/admin-fulfillment.js", "openSupplierEditor", "Supplier cards must expose a real edit lifecycle.");
    includes("frontend/js/admin-fulfillment.js", "saveSupplierEditor", "Supplier edit must persist through the canonical update route.");
    includes("frontend/js/admin-fulfillment.js", "createFulfillmentStartIdempotencyKey", "Retry starts must use a per-start idempotency key.");
    includes("frontend/js/admin-fulfillment.js", "isActiveFulfillmentAttempt", "Frontend must verify the backend returned an active attempt before success.");
    includes("frontend/js/admin-fulfillment.js", "refreshAdminOrderDetail", "Start fulfillment must refresh selected order detail from backend truth.");
    includes("frontend/js/admin-fulfillment.js", "fulfillment_start_not_active", "Non-active retry response must not show success.");
    includes("frontend/js/admin-fulfillment.js", "data-edit-supplier", "Supplier card must expose an Edit action.");
    includes("frontend/js/admin-fulfillment.js", "editSupplierCodeInput", "Supplier editor must show supplierCode.");
    includes("frontend/js/admin-fulfillment.js", "readonly", "Supplier code must be readonly in the normal edit path.");
    includes("frontend/js/admin-fulfillment.js", "`/api/admin/suppliers/${encodeURIComponent(supplierId)}`", "Supplier edit must use the canonical supplier PATCH route.");
    assert(!frontend.includes("idempotencyKey: `admin-ui:${order.orderId}:${selected.id}`"), "Retry idempotency key must not be fixed to order + mapping only.");
    includes("frontend/js/admin-orders.js", "refreshAdminOrderDetail", "Orders controller must expose a selected-detail backend refresh.");
    includes("frontend/js/admin-orders.js", "selectedAdminOrderSnapshot", "Orders detail must survive current queue filter changes after retry start.");
    includes("backend/services/fulfillmentService.js", 'String(order.status || "") !== "paid"', "Manual Admin fulfillment must require the canonical paid top-level order state.");
    assert(!read("backend/services/fulfillmentService.js").includes('currentStatus === "pending_payment"'), "Fulfillment start must not repair a skipped payment-to-order transition.");
    includes("frontend/js/admin-fulfillment.js", "startFulfillmentForAdminOrder", "Paid Orders must be able to start fulfillment.");
    includes("frontend/js/admin-fulfillment.js", "markFulfillmentSucceeded", "Mark Fulfilled must be explicit.");
    includes("frontend/js/admin-fulfillment.js", "markFulfillmentFailed", "Mark Failed must be explicit.");
    includes("frontend/js/admin-fulfillment.js", "No supplier mapping available", "No mapping state must be visible.");
    includes("frontend/js/admin-fulfillment.js", "data-admin-permission", "Frontend permissions must remain UX visibility only.");
    includes("frontend/admin.html", "fulfillmentSuppliersView", "Suppliers view panel must exist.");
    includes("frontend/admin.html", "fulfillmentMappingsView", "Mappings view panel must exist.");
    includes("frontend/admin.html", "fulfillmentAttemptsView", "Attempts view panel must exist.");
    includes("frontend/admin.html", "data-fulfillment-panel=\"suppliers\"", "Suppliers panel must declare its fulfillment view key.");
    includes("frontend/admin.html", "data-fulfillment-panel=\"mappings\"", "Mappings panel must declare its fulfillment view key.");
    includes("frontend/admin.html", "data-fulfillment-panel=\"attempts\"", "Attempts panel must declare its fulfillment view key.");
    assert(!/id="fulfillment(?:Suppliers|Mappings|Attempts)View"\s+class="[^"]*admin-security-view/.test(adminHtml), "Fulfillment panels must not reuse Admin Security panel ownership class.");
    includes("frontend/admin.html", "saveMappingBtn", "Add Mapping action must remain in Mappings workspace.");
    includes("frontend/admin.html", "fulfillmentAttemptFilter", "Attempt filters must remain in Attempts workspace.");
    includes("frontend/admin.html", "mappingProductInput", "Mapping product selector must exist.");
    includes("frontend/admin.html", "mappingPackageInput", "Mapping package selector must exist.");
    includes("frontend/js/admin-fulfillment.js", "renderSupplierOptions", "Mapping selector must use real Supplier truth.");
    includes("frontend/js/admin-fulfillment.js", "renderProductOptions", "Mapping product selector must use real Catalog truth.");
    includes("frontend/js/admin-fulfillment.js", "renderMappingPackageOptions", "Package selector must filter by product.");
    assert(!/if\s*\(!fulfillmentMappings\.length\)\s*\{\s*return;/.test(frontend), "Empty mappings must not return without rendering.");
    assert(!/if\s*\(!fulfillmentAttempts\.length\)\s*\{\s*return;/.test(frontend), "Empty attempts must not return without rendering.");
    includes("frontend/css/admin/admin-design-system.css", ".fulfillment-form-grid", "Fulfillment UI must be styled.");
    includes("frontend/css/admin/admin-design-system.css", ".fulfillment-state", "Fulfillment empty/error states must be styled.");
    includes("frontend/css/admin/admin-design-system.css", ".fulfillment-view-panel.active", "Fulfillment panels must have their own active display rule.");
    includes("frontend/css/admin/admin-design-system.css", "#section-fulfillment [hidden]", "Fulfillment hidden ownership must be scoped.");
    matches("frontend/css/admin/admin-design-system.css", /@media\s*\(max-width:\s*767px\)[\s\S]*\.fulfillment-form-grid/, "Fulfillment phone rules must use the established max-width 767px breakpoint.");
    matches("frontend/css/admin/admin-design-system.css", /\.fulfillment-view-panel\.active\s*\{\s*display:\s*grid;/, "Active fulfillment views must not remain display:none.");
    includes("frontend/js/admin-security.js", "#section-admin-security [data-admin-security-view]", "Admin Security tab binding must be scoped away from Fulfillment tabs.");
    assert(!/querySelectorAll\("\.admin-security-tab"\)/.test(adminSecurity), "Admin Security must not bind every admin-security-tab globally.");
    assert(!/querySelectorAll\("\.admin-security-view"\)/.test(adminSecurity), "Admin Security must not clear every admin-security-view globally.");
    includes("frontend/lang/admin/en.js", "fulfillment_attempts", "English fulfillment labels must exist.");
    includes("frontend/lang/admin/my.js", "fulfillment_attempts", "Myanmar fulfillment labels must exist.");
    includes("frontend/lang/admin/en.js", "no_supplier_mappings_yet", "English mappings empty-state label must exist.");
    includes("frontend/lang/admin/my.js", "no_supplier_mappings_yet", "Myanmar mappings empty-state label must exist.");
    includes("frontend/lang/admin/en.js", "no_fulfillment_attempts_yet", "English attempts empty-state label must exist.");
    includes("frontend/lang/admin/my.js", "no_fulfillment_attempts_yet", "Myanmar attempts empty-state label must exist.");
    includes("frontend/lang/admin/en.js", "invalid_supplier_region", "English invalid supplier region label must exist.");
    includes("frontend/lang/admin/my.js", "invalid_supplier_region", "Myanmar invalid supplier region label must exist.");
    includes("frontend/lang/admin/en.js", "supplier_updated", "English supplier update label must exist.");
    includes("frontend/lang/admin/my.js", "supplier_updated", "Myanmar supplier update label must exist.");
    includes("frontend/lang/admin/en.js", "fulfillment_start_not_active", "English inactive fulfillment start label must exist.");
    includes("frontend/lang/admin/my.js", "fulfillment_start_not_active", "Myanmar inactive fulfillment start label must exist.");
    await verifyFulfillmentDomBehavior();
}

class FakeClassList {
    constructor(element) {
        this.element = element;
        this.values = new Set(String(element.className || "").split(/\s+/).filter(Boolean));
    }

    add(value) {
        this.values.add(value);
        this.sync();
    }

    remove(value) {
        this.values.delete(value);
        this.sync();
    }

    toggle(value, force) {
        const shouldAdd = force === undefined ? !this.values.has(value) : Boolean(force);
        if (shouldAdd) this.values.add(value);
        else this.values.delete(value);
        this.sync();
        return shouldAdd;
    }

    contains(value) {
        return this.values.has(value);
    }

    sync() {
        this.element.className = Array.from(this.values).join(" ");
    }
}

class FakeElement {
    constructor(id = "", options = {}) {
        this.id = id;
        this.tagName = options.tagName || "DIV";
        this.dataset = options.dataset || {};
        this.value = options.value || "";
        this.innerHTML = options.innerHTML || "";
        this.hidden = Boolean(options.hidden);
        this.className = options.className || "";
        this.selectedOptions = options.selectedOptions || [];
        this.listeners = {};
        this.attributes = {};
        this.classList = new FakeClassList(this);
    }

    addEventListener(type, handler) {
        this.listeners[type] = handler;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    querySelectorAll() {
        return [];
    }
}

function createFulfillmentDomHarness() {
    const elements = new Map();
    const buttons = ["suppliers", "mappings", "attempts"].map(view => new FakeElement("", {
        tagName: "BUTTON",
        dataset: { fulfillmentView: view },
        className: view === "suppliers" ? "admin-security-tab active" : "admin-security-tab"
    }));
    const panels = {
        suppliers: new FakeElement("fulfillmentSuppliersView", { className: "fulfillment-view-panel active", dataset: { fulfillmentPanel: "suppliers" } }),
        mappings: new FakeElement("fulfillmentMappingsView", { className: "fulfillment-view-panel", dataset: { fulfillmentPanel: "mappings" } }),
        attempts: new FakeElement("fulfillmentAttemptsView", { className: "fulfillment-view-panel", dataset: { fulfillmentPanel: "attempts" } })
    };

    [
        panels.suppliers,
        panels.mappings,
        panels.attempts,
        new FakeElement("suppliersList"),
        new FakeElement("mappingsList"),
        new FakeElement("fulfillmentAttemptsList"),
        new FakeElement("mappingSupplierInput", { tagName: "SELECT" }),
        new FakeElement("mappingProductInput", { tagName: "SELECT" }),
        new FakeElement("mappingPackageInput", { tagName: "SELECT" }),
        new FakeElement("mappingRegionInput", { tagName: "SELECT", value: "MM" }),
        new FakeElement("fulfillmentAttemptFilter", { tagName: "SELECT", value: "ACTIVE" }),
        new FakeElement("supplierNameInput", { tagName: "INPUT", value: "SEAGM" }),
        new FakeElement("supplierCodeInput", { tagName: "INPUT", value: "seagm" }),
        new FakeElement("supplierRegionsInput", { tagName: "TEXTAREA", value: "MM\nTH" }),
        new FakeElement("supplierModeInput", { tagName: "SELECT", value: "MANUAL" }),
        new FakeElement("supplierBalanceSourceInput", { tagName: "SELECT", value: "UNKNOWN" }),
        new FakeElement("supplierBalanceAmountInput", { tagName: "INPUT", value: "0" }),
        new FakeElement("supplierBalanceCurrencyInput", { tagName: "SELECT", value: "" }),
        new FakeElement("supplierEnabledInput", { tagName: "INPUT" }),
        new FakeElement("editSupplierNameInput", { tagName: "INPUT", value: "SEAGM" }),
        new FakeElement("editSupplierCodeInput", { tagName: "INPUT", value: "SEAGM" }),
        new FakeElement("editSupplierModeInput", { tagName: "SELECT", value: "MANUAL" }),
        new FakeElement("editSupplierRegionsInput", { tagName: "TEXTAREA", value: "" }),
        new FakeElement("editSupplierBalanceSourceInput", { tagName: "SELECT", value: "UNKNOWN" }),
        new FakeElement("editSupplierBalanceAmountInput", { tagName: "INPUT", value: "0" }),
        new FakeElement("editSupplierBalanceCurrencyInput", { tagName: "SELECT", value: "" }),
        new FakeElement("editSupplierEnabledInput", { tagName: "INPUT" }),
        new FakeElement("supplierEditorError"),
        new FakeElement("saveSupplierBtn", { tagName: "BUTTON" }),
        new FakeElement("saveMappingBtn", { tagName: "BUTTON" }),
        new FakeElement("saveSupplierEditBtn", { tagName: "BUTTON" }),
        new FakeElement("refreshFulfillmentBtn", { tagName: "BUTTON" })
    ].forEach(element => elements.set(element.id, element));

    elements.get("supplierEnabledInput").checked = true;
    elements.get("editSupplierEnabledInput").checked = true;

    const document = {
        addEventListener(type, handler) {
            if (type === "DOMContentLoaded") this.domReady = handler;
        },
        getElementById(id) {
            return elements.get(id) || null;
        },
        querySelectorAll(selector) {
            if (selector === "[data-fulfillment-view]" || selector === "#section-fulfillment [data-fulfillment-view]") return buttons;
            if (selector === "#section-fulfillment .fulfillment-view-panel") return Object.values(panels);
            return [];
        }
    };

    return { document, elements, buttons, panels };
}

function createRequestGateForVerifier() {
    let generation = 0;
    let currentSignature = "";
    const inFlight = new Map();

    return {
        begin(signature = "", options = {}) {
            const key = options.coalesceKey || "";
            if (key && inFlight.has(key)) {
                return {
                    coalesced: true,
                    promise: inFlight.get(key),
                    isCurrent: () => currentSignature === signature
                };
            }

            generation += 1;
            currentSignature = signature;
            const id = generation;
            return {
                coalesced: false,
                isCurrent: () => generation === id && currentSignature === signature,
                track(promise) {
                    if (!key) return promise;
                    inFlight.set(key, promise);
                    promise.finally(() => {
                        if (inFlight.get(key) === promise) inFlight.delete(key);
                    });
                    return promise;
                }
            };
        }
    };
}

async function verifyFulfillmentDomBehavior() {
    const harness = createFulfillmentDomHarness();
    let currentSupplier = {
        id: "supplier-1",
        name: "SEAGM",
        supplierCode: "SEAGM",
        mode: "MANUAL",
        enabled: true,
        supportedRegions: [],
        balanceSource: "UNKNOWN",
        balanceAmount: null,
        balanceCurrency: "",
        balanceLabel: "Balance unavailable"
    };
    const capturedPosts = [];
    const capturedPatches = [];
    const fulfillmentStartKeys = [];
    const toastEvents = [];
    const requestCounts = {
        suppliers: 0,
        products: 0,
        mappings: 0,
        attempts: 0,
        packages: new Map()
    };
    let returnInactiveStart = true;
    let orderDetailRefreshes = 0;
    let activeAttempt = null;
    let failBrokenPackageOnce = true;
    let slowFulfillmentRequests = false;
    const pendingFulfillmentRequests = [];
    const context = {
        document: harness.document,
        window: {
            addEventListener() {},
            dispatchEvent() {},
            confirm: () => true,
            crypto: {
                randomUUID: () => `verify-${fulfillmentStartKeys.length + 1}`
            },
            refreshAdminOrderDetail: async orderId => {
                orderDetailRefreshes += 1;
                return { _id: orderId, fulfillment: activeAttempt, fulfillmentAttempts: activeAttempt ? [activeAttempt] : [] };
            },
            AZIEL_UI: { button: { setLoading() {}, reset() {} } },
            AZIEL_ADMIN_AUTH: { applyPermissionVisibility() {} },
            AZIEL_ADMIN_UI: {
                request: { createRequestGate: createRequestGateForVerifier },
                pagination: {
                    createPaginatedState({ getId, limit }) {
                        return {
                            items: [],
                            limit,
                            nextCursor: "",
                            hasMore: false,
                            loadingMore: false,
                            replace(items = [], pagination = {}) {
                                this.items = items.slice();
                                this.hasMore = Boolean(pagination.hasMore);
                                this.nextCursor = pagination.nextCursor || "";
                            },
                            append(items = [], pagination = {}) {
                                const seen = new Set(this.items.map(item => String(getId(item) || "")));
                                items.forEach(item => {
                                    const id = String(getId(item) || "");
                                    if (id && seen.has(id)) return;
                                    if (id) seen.add(id);
                                    this.items.push(item);
                                });
                                this.hasMore = Boolean(pagination.hasMore);
                                this.nextCursor = pagination.nextCursor || "";
                            }
                        };
                    }
                }
            }
        },
        CustomEvent: function CustomEvent() {},
        URLSearchParams,
        console,
        adminT: (key, fallback) => fallback || key,
        showAdminToast(message, type) {
            toastEvents.push({ message, type });
        },
        adminFetch: async (url, options = {}) => {
            if (url === "/api/admin/suppliers" && options.method === "POST") {
                const payload = JSON.parse(options.body || "{}");
                capturedPosts.push(payload);
                if (payload.supplierCode === currentSupplier.supplierCode) {
                    return { success: false, code: "SUPPLIER_ALREADY_EXISTS", message: "Supplier code already exists." };
                }
                currentSupplier = { ...currentSupplier, ...payload, id: "supplier-2", balanceLabel: "Balance unavailable" };
                return { success: true, supplier: currentSupplier };
            }
            if (url === "/api/admin/suppliers/supplier-1" && options.method === "PATCH") {
                const payload = JSON.parse(options.body || "{}");
                capturedPatches.push(payload);
                assert(payload.supplierCode === undefined, "Supplier edit payload must not attempt supplierCode mutation.");
                currentSupplier = {
                    ...currentSupplier,
                    name: payload.name,
                    mode: payload.mode,
                    enabled: payload.enabled,
                    supportedRegions: payload.supportedRegions,
                    balanceSource: payload.balanceSource,
                    balanceAmount: payload.balanceSource === "MANUAL" ? Number(payload.balanceAmount || 0) : null,
                    balanceCurrency: payload.balanceSource === "MANUAL" ? payload.balanceCurrency || "" : "",
                    balanceLabel: "Balance unavailable"
                };
                return { success: true, supplier: currentSupplier };
            }
            if (url === "/api/admin/suppliers") {
                requestCounts.suppliers += 1;
                return { success: true, suppliers: [currentSupplier] };
            }
            if (url === "/api/admin/catalog/products") {
                requestCounts.products += 1;
                return {
                    success: true,
                    products: [
                        { productCode: "mlbb", name: "MLBB" },
                        { productCode: "pubg", name: "PUBG" }
                    ]
                };
            }
            if (url.startsWith("/api/admin/catalog/products/")) {
                const productCode = decodeURIComponent(url.split("/").slice(-2)[0]);
                requestCounts.packages.set(productCode, (requestCounts.packages.get(productCode) || 0) + 1);
                if (productCode === "broken" && failBrokenPackageOnce) {
                    failBrokenPackageOnce = false;
                    throw new Error("Simulated package failure");
                }
                return {
                    success: true,
                    packages: [
                        { packageCode: `${productCode}-small`, name: `${productCode} Small` }
                    ]
                };
            }
            if (url === "/api/admin/supplier-mappings") {
                requestCounts.mappings += 1;
                return { success: true, mappings: [] };
            }
            if (url === "/api/admin/orders/order-1/fulfillment-mappings") {
                return {
                    success: true,
                    mappings: [{
                        id: "mapping-1",
                        supplierCode: "SEAGM",
                        supplierProductCode: "MLBB",
                        supplierPackageCode: "WEEKLY_PASS"
                    }]
                };
            }
            if (url === "/api/admin/orders/order-1/fulfillments" && options.method === "POST") {
                const payload = JSON.parse(options.body || "{}");
                fulfillmentStartKeys.push(payload.idempotencyKey);
                if (returnInactiveStart) {
                    return {
                        success: true,
                        attempt: {
                            fulfillmentId: "FUL-OLD",
                            orderId: "order-1",
                            orderCode: "AZL-VERIFY",
                            supplierCode: "SEAGM",
                            productCode: "mlbb",
                            packageCode: "WEEKLY_PASS",
                            status: "FAILED",
                            failureReason: "Previous failure"
                        }
                    };
                }
                activeAttempt = {
                    fulfillmentId: "FUL-NEW",
                    orderId: "order-1",
                    orderCode: "AZL-VERIFY",
                    supplierCode: "SEAGM",
                    productCode: "mlbb",
                    packageCode: "WEEKLY_PASS",
                    status: "IN_PROGRESS",
                    createdAt: new Date().toISOString()
                };
                return { success: true, attempt: activeAttempt };
            }
            if (url.startsWith("/api/admin/fulfillments")) {
                requestCounts.attempts += 1;
                if (slowFulfillmentRequests) {
                    return new Promise(resolve => {
                        pendingFulfillmentRequests.push({ url, resolve });
                    });
                }
                return { success: true, attempts: activeAttempt ? [activeAttempt] : [] };
            }
            return { success: true };
        }
    };
    context.window.window = context.window;
    context.window.document = harness.document;

    vm.runInNewContext(read("frontend/js/admin-fulfillment.js"), context, { filename: "frontend/js/admin-fulfillment.js" });
    harness.document.domReady();

    async function assertOpenView(view, listId, expectedText) {
        await context.openFulfillmentView(view);
        const activePanels = Object.values(harness.panels).filter(panel => panel.classList.contains("active") && !panel.hidden);
        assert(activePanels.length === 1, `${view}: exactly one fulfillment panel must be visible.`);
        assert(activePanels[0].dataset.fulfillmentPanel === view, `${view}: active panel must match activeView.`);
        const target = harness.elements.get(listId);
        assert(target.innerHTML.trim().length > 0, `${view}: active render target must not be empty.`);
        assert(target.innerHTML.includes(expectedText), `${view}: expected visible state was not rendered.`);
    }

    await assertOpenView("suppliers", "suppliersList", "SEAGM");
    const suppliersList = harness.elements.get("suppliersList");
    assert(suppliersList.innerHTML.includes("data-edit-supplier"), "Supplier card must render Edit action.");
    assert(suppliersList.innerHTML.includes("Supported Regions") && suppliersList.innerHTML.includes(": -"), "Persisted empty supplier regions must render as Supported Regions: -, not fake defaults.");

    const createRegions = context.normalizeSupplierRegionsInput(harness.elements.get("supplierRegionsInput"));
    assert(JSON.stringify(createRegions) === JSON.stringify(["MM", "TH"]), "Create form may default multiline regions to [\"MM\",\"TH\"].");
    await context.createSupplierFromForm({ currentTarget: harness.elements.get("saveSupplierBtn") });
    assert(capturedPosts.length === 1, "Duplicate supplier create verifier must capture a POST payload.");
    assert(capturedPosts[0].supplierCode === "SEAGM", "Supplier code must be uppercased before duplicate create submit.");
    assert(JSON.stringify(currentSupplier.supportedRegions) === JSON.stringify([]), "Duplicate create must not mutate existing supplier supportedRegions truth.");

    const emptyEditorRegions = context.normalizeSupplierRegionsInput(harness.elements.get("editSupplierRegionsInput"));
    assert(JSON.stringify(emptyEditorRegions) === JSON.stringify([]), "Existing empty supportedRegions must remain empty in the edit form.");
    harness.elements.get("editSupplierRegionsInput").value = "MM\nTH";
    await context.saveSupplierEditor("supplier-1", harness.elements.get("saveSupplierEditBtn"));
    assert(capturedPatches.length === 1, "Supplier edit verifier must capture a PATCH payload.");
    assert(JSON.stringify(capturedPatches[0].supportedRegions) === JSON.stringify(["MM", "TH"]), "PATCH supportedRegions must normalize to [\"MM\",\"TH\"].");
    assert(JSON.stringify(currentSupplier.supportedRegions) === JSON.stringify(["MM", "TH"]), "Updated supplier projection must persist supportedRegions truth.");
    assert(harness.elements.get("suppliersList").innerHTML.includes("MM, TH"), "Updated supplier card must render Supported Regions: MM, TH.");

    await assertOpenView("mappings", "mappingsList", "No supplier mappings yet.");
    const countsAfterFirstMappingsOpen = {
        suppliers: requestCounts.suppliers,
        products: requestCounts.products,
        mappings: requestCounts.mappings,
        mlbbPackages: requestCounts.packages.get("mlbb") || 0,
        pubgPackages: requestCounts.packages.get("pubg") || 0,
        attempts: requestCounts.attempts
    };
    assert(countsAfterFirstMappingsOpen.products === 1, "Mappings first open must load Catalog products once.");
    assert(countsAfterFirstMappingsOpen.mappings === 1, "Mappings first open must load supplier mappings once.");
    assert(countsAfterFirstMappingsOpen.mlbbPackages === 1, "Mappings first open must load MLBB packages once.");
    assert(countsAfterFirstMappingsOpen.pubgPackages === 1, "Mappings first open must load PUBG packages once.");
    await assertOpenView("attempts", "fulfillmentAttemptsList", "No fulfillment attempts yet.");
    assert(requestCounts.suppliers === countsAfterFirstMappingsOpen.suppliers, "Attempts tab must not reload suppliers.");
    assert(requestCounts.products === countsAfterFirstMappingsOpen.products, "Attempts tab must not reload Catalog products.");
    assert(requestCounts.mappings === countsAfterFirstMappingsOpen.mappings, "Attempts tab must not reload supplier mappings.");
    await assertOpenView("mappings", "mappingsList", "No supplier mappings yet.");
    assert(requestCounts.suppliers === countsAfterFirstMappingsOpen.suppliers, "Returning to Mappings must reuse loaded suppliers.");
    assert(requestCounts.products === countsAfterFirstMappingsOpen.products, "Returning to Mappings must reuse loaded Catalog products.");
    assert(requestCounts.mappings === countsAfterFirstMappingsOpen.mappings, "Returning to Mappings must reuse loaded mappings.");
    assert((requestCounts.packages.get("mlbb") || 0) === countsAfterFirstMappingsOpen.mlbbPackages, "Returning to Mappings must not fan out duplicate MLBB package requests.");
    assert((requestCounts.packages.get("pubg") || 0) === countsAfterFirstMappingsOpen.pubgPackages, "Returning to Mappings must not fan out duplicate PUBG package requests.");

    await context.refreshActiveFulfillmentView();
    assert(requestCounts.products === countsAfterFirstMappingsOpen.products + 1, "Mappings Refresh must refresh Catalog products exactly once.");
    assert(requestCounts.mappings === countsAfterFirstMappingsOpen.mappings + 1, "Mappings Refresh must refresh supplier mappings exactly once.");
    assert((requestCounts.packages.get("mlbb") || 0) === countsAfterFirstMappingsOpen.mlbbPackages + 1, "Mappings Refresh must refresh MLBB packages exactly once.");
    assert((requestCounts.packages.get("pubg") || 0) === countsAfterFirstMappingsOpen.pubgPackages + 1, "Mappings Refresh must refresh PUBG packages exactly once.");

    const packageCountBeforeCoalesce = requestCounts.packages.get("mlbb") || 0;
    await Promise.all([
        context.loadFulfillmentProductPackages("mlbb", { force: true }),
        context.loadFulfillmentProductPackages("mlbb", { force: true })
    ]);
    assert((requestCounts.packages.get("mlbb") || 0) === packageCountBeforeCoalesce + 1, "Identical in-flight package requests must coalesce.");

    const brokenFirst = await context.loadFulfillmentProductPackages("broken", { force: true });
    const brokenSecond = await context.loadFulfillmentProductPackages("broken", { force: true });
    assert(Array.isArray(brokenFirst) && brokenFirst.length === 0, "Failed package load must resolve to an empty package list.");
    assert(brokenSecond.length === 1, "Failed package load must not poison the package cache against retry.");

    const attemptsBeforeSuppliers = requestCounts.attempts;
    await context.openFulfillmentView("suppliers");
    assert(harness.elements.get("suppliersList").innerHTML.includes("SEAGM"), "Suppliers tab must still render supplier truth.");
    assert(requestCounts.attempts === attemptsBeforeSuppliers, "Suppliers tab must not load fulfillment attempts.");

    await context.openFulfillmentView("attempts");
    const attemptsBeforeCoalesce = requestCounts.attempts;
    slowFulfillmentRequests = true;
    const firstAttemptsLoad = context.loadFulfillmentAttempts({ showLoading: true });
    const secondAttemptsLoad = context.loadFulfillmentAttempts({ showLoading: true });
    assert(requestCounts.attempts === attemptsBeforeCoalesce + 1, "Identical overlapping Attempts loads must coalesce into one request.");
    pendingFulfillmentRequests.shift().resolve({ success: true, attempts: [], pagination: { hasMore: false } });
    await Promise.all([firstAttemptsLoad, secondAttemptsLoad]);
    slowFulfillmentRequests = false;
    assert(!harness.elements.get("fulfillmentAttemptsList").innerHTML.includes("Loading"), "Coalesced Attempts load must clear Loading when current request settles.");

    slowFulfillmentRequests = true;
    const attemptFilter = harness.elements.get("fulfillmentAttemptFilter");
    attemptFilter.value = "ACTIVE";
    const staleActiveLoad = context.loadFulfillmentAttempts({ showLoading: true });
    attemptFilter.value = "FAILED";
    const currentFailedLoad = context.loadFulfillmentAttempts({ showLoading: true });
    assert(pendingFulfillmentRequests.length === 2, "Different Attempts filters must remain independent requests.");
    pendingFulfillmentRequests[1].resolve({
        success: true,
        attempts: [{
            fulfillmentId: "FUL-FAILED",
            orderCode: "AZL-FAILED",
            supplierCode: "SEAGM",
            productCode: "mlbb",
            packageCode: "WEEKLY_PASS",
            status: "FAILED",
            failureReason: "Verification failure"
        }],
        pagination: { hasMore: false }
    });
    await currentFailedLoad;
    pendingFulfillmentRequests[0].resolve({
        success: true,
        attempts: [{
            fulfillmentId: "FUL-STALE",
            orderCode: "AZL-STALE",
            supplierCode: "SEAGM",
            productCode: "mlbb",
            packageCode: "WEEKLY_PASS",
            status: "IN_PROGRESS"
        }],
        pagination: { hasMore: false }
    });
    await staleActiveLoad;
    slowFulfillmentRequests = false;
    assert(harness.elements.get("fulfillmentAttemptsList").innerHTML.includes("FUL-FAILED"), "Final current Attempts filter must render FAILED results.");
    assert(!harness.elements.get("fulfillmentAttemptsList").innerHTML.includes("FUL-STALE"), "Stale Attempts response must not overwrite current filter results.");
    assert(!harness.elements.get("fulfillmentAttemptsList").innerHTML.includes("Loading"), "Current Attempts request must clear Loading.");

    const order = {
        _id: "order-1",
        orderId: "AZL-VERIFY",
        status: "failed",
        paymentStatus: "paid",
        fulfillment: { fulfillmentId: "FUL-OLD", status: "FAILED" }
    };
    await context.openFulfillmentView("attempts");
    await context.startFulfillmentForAdminOrder(order, harness.elements.get("saveMappingBtn"));
    assert(toastEvents.some(event => event.type === "error" && event.message.includes("active attempt")), "Inactive retry response must render an error toast.");
    assert(!toastEvents.some(event => event.type === "success" && event.message === "Fulfillment started"), "Inactive retry response must not show Fulfillment started.");
    assert(orderDetailRefreshes === 0, "Inactive retry response must not refresh order detail as success.");

    returnInactiveStart = false;
    await context.startFulfillmentForAdminOrder(order, harness.elements.get("saveMappingBtn"));
    assert(fulfillmentStartKeys.length === 2, "Retry lifecycle verifier must capture both start requests.");
    assert(fulfillmentStartKeys[0] !== fulfillmentStartKeys[1], "Start retry idempotency keys must be distinct per start action.");
    assert(toastEvents.some(event => event.type === "success" && event.message === "Fulfillment started"), "Active retry response must show Fulfillment started.");
    assert(orderDetailRefreshes === 1, "Active retry response must refresh selected order detail from backend truth.");
    assert(harness.elements.get("fulfillmentAttemptsList").innerHTML.includes("FUL-NEW"), "Fulfillment Attempts active view must render the newly persisted active attempt.");
}

function verifyAuditAndBoundaries() {
    [
        "SUPPLIER_CREATED",
        "SUPPLIER_UPDATED",
        "SUPPLIER_ENABLED",
        "SUPPLIER_DISABLED",
        "SUPPLIER_BALANCE_UPDATED",
        "SUPPLIER_MAPPING_CREATED",
        "SUPPLIER_MAPPING_UPDATED",
        "SUPPLIER_MAPPING_DISABLED",
        "FULFILLMENT_STARTED",
        "FULFILLMENT_SUCCEEDED",
        "FULFILLMENT_FAILED",
        "FULFILLMENT_CANCELLED"
    ].forEach(action => includes("backend/services/adminAuditService.js", action, `${action} audit action must exist.`));

    notIncludes("frontend/home.html", "supplier", "Customers must not select suppliers from Home.");
    notIncludes("frontend/js/game-flow.js", "supplier", "Customer purchase flow must not expose supplier ownership.");
    notIncludes("backend/services/walletService.js", "FulfillmentAttempt", "Wallet ownership must not depend on fulfillment.");
    notIncludes("backend/services/promoCodeService.js", "Supplier", "Promo ownership must not depend on supplier.");
    notIncludes("backend/services/campaignService.js", "Supplier", "Campaign ownership must not depend on supplier.");
    notIncludes("backend/services/sitePlacementService.js", "Supplier", "SitePlacement ownership must not depend on supplier.");
}

async function main() {
    verifyModels();
    verifyServiceOwnership();
    verifyAdapterBoundary();
    verifyRoutesAndRbac();
    verifyOrderIntegration();
    await verifyFrontend();
    verifyAuditAndBoundaries();
    console.log("Admin fulfillment verification passed.");
}

main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
