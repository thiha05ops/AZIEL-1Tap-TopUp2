const mongoose = require("mongoose");

const Order = require("../models/Order");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { SUPPLIER_MODES, SUPPLIER_BALANCE_SOURCES, SUPPLIER_CONFIGURATION_STATUSES } = require("../models/Supplier");
const { SUPPLIER_EXECUTION_MODES } = require("../models/SupplierProductMapping");
const { ACTIVE_FULFILLMENT_STATUSES, FULFILLMENT_STATUSES } = require("../models/FulfillmentAttempt");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("./adminAuditService");
const { ORDER_STATES, getAllowedNextStatuses, transitionOrder } = require("./orderStateService");
const { getSupplierAdapter, normalizeSupplierResult } = require("./supplierAdapterRegistry");
const {
    FINANCIAL_OUTCOMES,
    acquireFinancialOutcome,
    assertFulfillmentStartAllowed,
    assertFulfillmentSuccessAllowed,
    listFinancialFulfillmentAttempts
} = require("./financialIntegrityService");
const {
    applyCursorFilter,
    pageResult,
    parseLimit
} = require("./paginationService");

const REGIONS = Object.freeze(["MM", "TH"]);
const CODE_PATTERN = /^[A-Z0-9_-]{2,40}$/;

class FulfillmentError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "FulfillmentError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function cleanText(value = "", max = 160) {
    return String(value || "").trim().slice(0, max);
}

function normalizeSupplierCode(value = "") {
    return cleanText(value, 40).toUpperCase();
}

function normalizeProductCode(value = "") {
    return cleanText(value, 80).toLowerCase();
}

function normalizePackageCode(value = "") {
    return cleanText(value, 120).toUpperCase();
}

function normalizeRegion(value = "") {
    const region = cleanText(value, 2).toUpperCase();
    if (!REGIONS.includes(region)) {
        throw new FulfillmentError("INVALID_REGION", "Invalid supplier region.");
    }
    return region;
}

function normalizeSupplierMode(value = "") {
    const mode = cleanText(value, 20).toUpperCase() || SUPPLIER_MODES.MANUAL;
    if (!Object.values(SUPPLIER_MODES).includes(mode)) {
        throw new FulfillmentError("INVALID_SUPPLIER_MODE", "Invalid supplier mode.");
    }
    return mode;
}

function normalizeBalanceSource(value = "") {
    const source = cleanText(value, 20).toUpperCase() || SUPPLIER_BALANCE_SOURCES.UNKNOWN;
    if (!Object.values(SUPPLIER_BALANCE_SOURCES).includes(source)) {
        throw new FulfillmentError("INVALID_BALANCE_SOURCE", "Invalid supplier balance source.");
    }
    return source;
}

function normalizeBalanceAmount(value = 0) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new FulfillmentError("INVALID_BALANCE_AMOUNT", "Invalid supplier balance amount.");
    }
    return amount;
}

function normalizeBalanceCurrency(value = "") {
    const currency = cleanText(value, 3).toUpperCase();
    if (!["", "MMK", "THB"].includes(currency)) {
        throw new FulfillmentError("INVALID_BALANCE_CURRENCY", "Invalid supplier balance currency.");
    }
    return currency;
}

function normalizeRegions(values = []) {
    const input = Array.isArray(values) ? values : [values];
    const tokens = input
        .flatMap(value => String(value || "").split(/[\n,]+/))
        .map(value => value.trim())
        .filter(Boolean);
    return [...new Set(tokens.map(normalizeRegion))];
}

function makeFulfillmentId() {
    const stamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `FUL-${stamp}-${random}`;
}

function adminId(admin = {}) {
    return admin.id || admin.adminId || admin._id || null;
}

function safeSupplierProjection(supplier = {}) {
    const balanceSource = supplier.balanceSource || SUPPLIER_BALANCE_SOURCES.UNKNOWN;
    return {
        id: String(supplier._id || supplier.id || ""),
        supplierCode: supplier.supplierCode,
        name: supplier.name,
        mode: supplier.mode,
        enabled: Boolean(supplier.enabled),
        supportedRegions: supplier.supportedRegions || [],
        supplierCurrency: supplier.supplierCurrency || supplier.balanceCurrency || supplier.metadata?.supplierCurrency || "",
        capabilities: supplier.capabilities || [],
        balanceAmount: balanceSource === SUPPLIER_BALANCE_SOURCES.UNKNOWN ? null : supplier.balanceAmount,
        balanceCurrency: balanceSource === SUPPLIER_BALANCE_SOURCES.UNKNOWN ? "" : supplier.balanceCurrency,
        balanceSource,
        balanceLabel: balanceSource === SUPPLIER_BALANCE_SOURCES.UNKNOWN
            ? "Balance unavailable"
            : `${balanceSource === SUPPLIER_BALANCE_SOURCES.MANUAL ? "Manual balance" : "API balance"}: ${Number(supplier.balanceAmount || 0).toLocaleString()} ${supplier.balanceCurrency || ""}`.trim(),
        lastBalanceSyncAt: supplier.lastBalanceSyncAt,
        configurationStatus: supplier.configurationStatus,
        createdAt: supplier.createdAt,
        updatedAt: supplier.updatedAt
    };
}

function projectMapping(mapping = {}, supplier = null) {
    return {
        id: String(mapping._id || mapping.id || ""),
        supplierId: String(mapping.supplierId || ""),
        supplierCode: mapping.supplierCode,
        supplierName: supplier?.name || mapping.supplierCode,
        productCode: mapping.productCode,
        packageCode: mapping.packageCode,
        supplierProductCode: mapping.supplierProductCode,
        supplierPackageCode: mapping.supplierPackageCode,
        supplierDisplayName: mapping.supplierDisplayName || "",
        region: mapping.region,
        enabled: Boolean(mapping.enabled),
        executionMode: mapping.executionMode,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt
    };
}

function projectAttempt(attempt = {}, extras = {}) {
    return {
        id: String(attempt._id || attempt.id || ""),
        fulfillmentId: attempt.fulfillmentId,
        orderId: String(attempt.orderId || ""),
        orderCode: attempt.orderCode,
        supplierId: String(attempt.supplierId || ""),
        supplierCode: attempt.supplierCodeSnapshot,
        supplierMappingId: String(attempt.supplierMappingId || ""),
        productCode: attempt.productCode,
        packageCode: attempt.packageCode,
        region: attempt.region,
        mode: attempt.mode,
        status: attempt.status,
        startedByAdminId: attempt.startedByAdminId ? String(attempt.startedByAdminId) : null,
        startedByUsernameSnapshot: attempt.startedByUsernameSnapshot || "",
        supplierReference: attempt.supplierReference || "",
        supplierRequest: attempt.supplierRequest || {},
        supplierResult: attempt.supplierResult || {},
        failureCode: attempt.failureCode || "",
        failureReason: attempt.failureReason || "",
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        failedAt: attempt.failedAt,
        cancelledAt: attempt.cancelledAt,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
        ...extras
    };
}

async function createSupplier(payload = {}, context = {}) {
    const supplierCode = normalizeSupplierCode(payload.supplierCode);
    if (!CODE_PATTERN.test(supplierCode)) {
        throw new FulfillmentError("INVALID_SUPPLIER_CODE", "Supplier code must use A-Z, 0-9, underscore, or hyphen.");
    }

    const mode = normalizeSupplierMode(payload.mode);
    const balanceSource = normalizeBalanceSource(payload.balanceSource);
    const supplier = new Supplier({
        supplierCode,
        name: cleanText(payload.name, 120),
        mode,
        enabled: payload.enabled !== false,
        supportedRegions: normalizeRegions(payload.supportedRegions || []),
        supplierCurrency: normalizeBalanceCurrency(payload.supplierCurrency || payload.balanceCurrency || ""),
        capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.map(item => cleanText(item, 60)).filter(Boolean).slice(0, 20) : [],
        balanceSource,
        balanceAmount: balanceSource === SUPPLIER_BALANCE_SOURCES.MANUAL ? normalizeBalanceAmount(payload.balanceAmount) : null,
        balanceCurrency: balanceSource === SUPPLIER_BALANCE_SOURCES.MANUAL ? normalizeBalanceCurrency(payload.balanceCurrency) : "",
        lastBalanceSyncAt: balanceSource === SUPPLIER_BALANCE_SOURCES.MANUAL ? new Date() : null,
        configurationStatus: mode === SUPPLIER_MODES.API
            ? SUPPLIER_CONFIGURATION_STATUSES.NOT_CONFIGURED
            : SUPPLIER_CONFIGURATION_STATUSES.MANUAL_READY,
        metadata: {}
    });

    if (!supplier.name) throw new FulfillmentError("SUPPLIER_NAME_REQUIRED", "Supplier name is required.");

    try {
        await supplier.save();
    } catch (error) {
        if (error?.code === 11000) {
            throw new FulfillmentError("SUPPLIER_ALREADY_EXISTS", "Supplier code already exists.", 409);
        }
        throw error;
    }

    await writeAdminAudit({
        actor: context.admin,
        req: context.req,
        action: ADMIN_AUDIT_ACTIONS.SUPPLIER_CREATED,
        resourceType: "Supplier",
        resourceId: supplier.supplierCode,
        metadata: {
            supplierCode: supplier.supplierCode,
            mode: supplier.mode,
            supportedRegions: supplier.supportedRegions
        }
    }).catch(() => null);

    return safeSupplierProjection(supplier);
}

async function updateSupplier(supplierId, payload = {}, context = {}) {
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) throw new FulfillmentError("SUPPLIER_NOT_FOUND", "Supplier not found.", 404);
    if (payload.supplierCode && normalizeSupplierCode(payload.supplierCode) !== supplier.supplierCode) {
        throw new FulfillmentError("SUPPLIER_CODE_IMMUTABLE", "Supplier code cannot be changed.");
    }

    const previous = supplier.toObject();
    if (payload.name !== undefined) supplier.name = cleanText(payload.name, 120);
    if (payload.mode !== undefined) supplier.mode = normalizeSupplierMode(payload.mode);
    if (payload.enabled !== undefined) supplier.enabled = Boolean(payload.enabled);
    if (payload.supportedRegions !== undefined) supplier.supportedRegions = normalizeRegions(payload.supportedRegions);
    if (payload.supplierCurrency !== undefined) supplier.supplierCurrency = normalizeBalanceCurrency(payload.supplierCurrency);

    if (payload.balanceSource !== undefined) {
        const nextSource = normalizeBalanceSource(payload.balanceSource);
        supplier.balanceSource = nextSource;
        if (nextSource === SUPPLIER_BALANCE_SOURCES.MANUAL) {
            supplier.balanceAmount = normalizeBalanceAmount(payload.balanceAmount);
            supplier.balanceCurrency = normalizeBalanceCurrency(payload.balanceCurrency);
            supplier.lastBalanceSyncAt = new Date();
        } else if (nextSource === SUPPLIER_BALANCE_SOURCES.UNKNOWN) {
            supplier.balanceAmount = null;
            supplier.balanceCurrency = "";
            supplier.lastBalanceSyncAt = null;
        }
    }

    supplier.configurationStatus = supplier.mode === SUPPLIER_MODES.API
        ? SUPPLIER_CONFIGURATION_STATUSES.NOT_CONFIGURED
        : SUPPLIER_CONFIGURATION_STATUSES.MANUAL_READY;

    await supplier.save();

    const action = previous.enabled !== supplier.enabled
        ? (supplier.enabled ? ADMIN_AUDIT_ACTIONS.SUPPLIER_ENABLED : ADMIN_AUDIT_ACTIONS.SUPPLIER_DISABLED)
        : previous.balanceSource !== supplier.balanceSource || previous.balanceAmount !== supplier.balanceAmount
            ? ADMIN_AUDIT_ACTIONS.SUPPLIER_BALANCE_UPDATED
            : ADMIN_AUDIT_ACTIONS.SUPPLIER_UPDATED;

    await writeAdminAudit({
        actor: context.admin,
        req: context.req,
        action,
        resourceType: "Supplier",
        resourceId: supplier.supplierCode,
        metadata: {
            supplierCode: supplier.supplierCode,
            mode: supplier.mode,
            enabled: supplier.enabled,
            supportedRegions: supplier.supportedRegions,
            balanceSource: supplier.balanceSource,
            balanceCurrency: supplier.balanceCurrency
        }
    }).catch(() => null);

    return safeSupplierProjection(supplier);
}

async function listSuppliers() {
    const suppliers = await Supplier.find().sort({ supplierCode: 1 }).lean();
    return suppliers.map(safeSupplierProjection);
}

async function validateCatalogPackage(productCode, packageCode) {
    const [product, pkg] = await Promise.all([
        CatalogProduct.findOne({ productCode }).lean(),
        CatalogPackage.findOne({ productCode, packageCode }).lean()
    ]);
    if (!product) throw new FulfillmentError("CATALOG_PRODUCT_NOT_FOUND", "Catalog product not found.", 404);
    if (!pkg) throw new FulfillmentError("CATALOG_PACKAGE_NOT_FOUND", "Catalog package not found.", 404);
    return { product, pkg };
}

async function createMapping(supplierId, payload = {}, context = {}) {
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) throw new FulfillmentError("SUPPLIER_NOT_FOUND", "Supplier not found.", 404);
    if (!supplier.enabled) throw new FulfillmentError("SUPPLIER_DISABLED", "Disabled supplier cannot receive new mappings.");

    const productCode = normalizeProductCode(payload.productCode);
    const packageCode = normalizePackageCode(payload.packageCode);
    const region = normalizeRegion(payload.region);
    if (!supplier.supportedRegions.includes(region)) {
        throw new FulfillmentError("SUPPLIER_REGION_UNSUPPORTED", "Supplier does not support this region.");
    }
    await validateCatalogPackage(productCode, packageCode);

    const mapping = new SupplierProductMapping({
        supplierId: supplier._id,
        supplierCode: supplier.supplierCode,
        productCode,
        packageCode,
        supplierProductCode: cleanText(payload.supplierProductCode, 120),
        supplierPackageCode: cleanText(payload.supplierPackageCode, 120),
        supplierDisplayName: cleanText(payload.supplierDisplayName, 160),
        region,
        enabled: payload.enabled !== false,
        executionMode: supplier.mode === SUPPLIER_MODES.API ? SUPPLIER_EXECUTION_MODES.API : SUPPLIER_EXECUTION_MODES.MANUAL,
        mappingMetadata: {}
    });

    if (!mapping.supplierProductCode || !mapping.supplierPackageCode) {
        throw new FulfillmentError("SUPPLIER_MAPPING_CODES_REQUIRED", "Supplier product and package codes are required.");
    }

    try {
        await mapping.save();
    } catch (error) {
        if (error?.code === 11000) {
            throw new FulfillmentError("SUPPLIER_MAPPING_ALREADY_EXISTS", "Supplier mapping already exists.", 409);
        }
        throw error;
    }

    await writeAdminAudit({
        actor: context.admin,
        req: context.req,
        action: ADMIN_AUDIT_ACTIONS.SUPPLIER_MAPPING_CREATED,
        resourceType: "SupplierProductMapping",
        resourceId: String(mapping._id),
        metadata: {
            supplierCode: mapping.supplierCode,
            productCode,
            packageCode,
            region
        }
    }).catch(() => null);

    return projectMapping(mapping, supplier);
}

async function updateMapping(supplierId, mappingId, payload = {}, context = {}) {
    const mapping = await SupplierProductMapping.findOne({ _id: mappingId, supplierId });
    if (!mapping) throw new FulfillmentError("SUPPLIER_MAPPING_NOT_FOUND", "Supplier mapping not found.", 404);
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) throw new FulfillmentError("SUPPLIER_NOT_FOUND", "Supplier not found.", 404);

    if (payload.productCode !== undefined || payload.packageCode !== undefined || payload.region !== undefined) {
        const productCode = normalizeProductCode(payload.productCode || mapping.productCode);
        const packageCode = normalizePackageCode(payload.packageCode || mapping.packageCode);
        const region = normalizeRegion(payload.region || mapping.region);
        if (!supplier.supportedRegions.includes(region)) {
            throw new FulfillmentError("SUPPLIER_REGION_UNSUPPORTED", "Supplier does not support this region.");
        }
        await validateCatalogPackage(productCode, packageCode);
        mapping.productCode = productCode;
        mapping.packageCode = packageCode;
        mapping.region = region;
    }

    if (payload.supplierProductCode !== undefined) mapping.supplierProductCode = cleanText(payload.supplierProductCode, 120);
    if (payload.supplierPackageCode !== undefined) mapping.supplierPackageCode = cleanText(payload.supplierPackageCode, 120);
    if (payload.supplierDisplayName !== undefined) mapping.supplierDisplayName = cleanText(payload.supplierDisplayName, 160);
    if (payload.enabled !== undefined) mapping.enabled = Boolean(payload.enabled);
    mapping.executionMode = supplier.mode === SUPPLIER_MODES.API ? SUPPLIER_EXECUTION_MODES.API : SUPPLIER_EXECUTION_MODES.MANUAL;

    try {
        await mapping.save();
    } catch (error) {
        if (error?.code === 11000) {
            throw new FulfillmentError("SUPPLIER_MAPPING_ALREADY_EXISTS", "Supplier mapping already exists.", 409);
        }
        throw error;
    }

    await writeAdminAudit({
        actor: context.admin,
        req: context.req,
        action: mapping.enabled ? ADMIN_AUDIT_ACTIONS.SUPPLIER_MAPPING_UPDATED : ADMIN_AUDIT_ACTIONS.SUPPLIER_MAPPING_DISABLED,
        resourceType: "SupplierProductMapping",
        resourceId: String(mapping._id),
        metadata: {
            supplierCode: mapping.supplierCode,
            productCode: mapping.productCode,
            packageCode: mapping.packageCode,
            region: mapping.region,
            enabled: mapping.enabled
        }
    }).catch(() => null);

    return projectMapping(mapping, supplier);
}

async function listMappings(query = {}) {
    const filter = {};
    if (query.supplierId) filter.supplierId = query.supplierId;
    if (query.productCode) filter.productCode = normalizeProductCode(query.productCode);
    if (query.packageCode) filter.packageCode = normalizePackageCode(query.packageCode);
    if (query.region) filter.region = normalizeRegion(query.region);
    if (query.enabledOnly) filter.enabled = true;

    const [mappings, suppliers] = await Promise.all([
        SupplierProductMapping.find(filter).sort({ supplierCode: 1, productCode: 1, packageCode: 1 }).lean(),
        Supplier.find().lean()
    ]);
    const supplierById = new Map(suppliers.map(supplier => [String(supplier._id), supplier]));
    return mappings.map(mapping => projectMapping(mapping, supplierById.get(String(mapping.supplierId))));
}

async function listEligibleMappingsForOrder(orderId) {
    const order = await Order.findById(orderId).lean();
    if (!order) throw new FulfillmentError("ORDER_NOT_FOUND", "Order not found.", 404);
    const productCode = normalizeProductCode(order.productCode);
    const packageCode = normalizePackageCode(order.packageCode);
    const region = normalizeRegion(order.region || "MM");
    if (!productCode || !packageCode) return [];

    const mappings = await listMappings({ productCode, packageCode, region, enabledOnly: true });
    const suppliers = await Supplier.find({ _id: { $in: mappings.map(item => item.supplierId) }, enabled: true }).lean();
    const enabledSupplierIds = new Set(suppliers.map(supplier => String(supplier._id)));
    return mappings.filter(mapping => enabledSupplierIds.has(String(mapping.supplierId)));
}

async function getOrderFulfillmentSummary(orderIds = []) {
    const ids = orderIds.filter(Boolean);
    if (!ids.length) return new Map();
    const attempts = await FulfillmentAttempt.find({ orderId: { $in: ids } }).sort({ createdAt: -1 }).lean();
    const byOrder = new Map();
    attempts.forEach(attempt => {
        const key = String(attempt.orderId);
        if (!byOrder.has(key)) byOrder.set(key, []);
        byOrder.get(key).push(projectAttempt(attempt));
    });
    return byOrder;
}

async function listAttempts(query = {}) {
    const filter = {};
    const statusFilter = cleanText(query.status, 20).toUpperCase();
    if (statusFilter === "ACTIVE") filter.status = { $in: ACTIVE_FULFILLMENT_STATUSES };
    else if (Object.values(FULFILLMENT_STATUSES).includes(statusFilter)) filter.status = statusFilter;

    const limit = parseLimit(query.limit, { defaultLimit: 50, maxLimit: 100 });
    const attempts = await FulfillmentAttempt.find(applyCursorFilter(filter, query.cursor))
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();
    const { page, pagination } = pageResult(attempts, limit);
    const items = page.map(attempt => projectAttempt(attempt));
    return { attempts: items, items, pagination };
}

async function getAttempt(fulfillmentId) {
    const attempt = await FulfillmentAttempt.findOne({ fulfillmentId: cleanText(fulfillmentId, 80).toUpperCase() }).lean();
    if (!attempt) throw new FulfillmentError("FULFILLMENT_NOT_FOUND", "Fulfillment attempt not found.", 404);
    return projectAttempt(attempt);
}

async function assertOrderEligible(order) {
    if (!order) throw new FulfillmentError("ORDER_NOT_FOUND", "Order not found.", 404);
    if (![ORDER_STATES.PAID, ORDER_STATES.FAILED, ORDER_STATES.REFUND_REJECTED].includes(String(order.status))) {
        throw new FulfillmentError("ORDER_NOT_FULFILLMENT_ELIGIBLE", "Order is not eligible for fulfillment.");
    }
    if (String(order.paymentStatus || "") !== "paid") {
        throw new FulfillmentError("ORDER_NOT_PAID", "Order payment is not confirmed.");
    }
}

async function startFulfillmentForOrder(orderId, payload = {}, context = {}) {
    const mappingId = cleanText(payload.mappingId || payload.supplierMappingId, 80);
    if (!mappingId) throw new FulfillmentError("SUPPLIER_MAPPING_REQUIRED", "Supplier mapping is required.");

    const [order, mapping] = await Promise.all([
        Order.findById(orderId),
        SupplierProductMapping.findById(mappingId)
    ]);

    await assertOrderEligible(order);
    const financialAttempts = await listFinancialFulfillmentAttempts(order._id);
    assertFulfillmentStartAllowed(order, financialAttempts);
    if (!mapping || !mapping.enabled) throw new FulfillmentError("SUPPLIER_MAPPING_NOT_FOUND", "Supplier mapping not found.", 404);

    const supplier = await Supplier.findById(mapping.supplierId);
    if (!supplier) throw new FulfillmentError("SUPPLIER_NOT_FOUND", "Supplier not found.", 404);
    if (!supplier.enabled) throw new FulfillmentError("SUPPLIER_DISABLED", "Supplier is disabled.");

    if (
        mapping.productCode !== normalizeProductCode(order.productCode) ||
        mapping.packageCode !== normalizePackageCode(order.packageCode) ||
        mapping.region !== normalizeRegion(order.region || "MM")
    ) {
        throw new FulfillmentError("SUPPLIER_MAPPING_MISMATCH", "Supplier mapping does not match this order.");
    }

    const adapter = getSupplierAdapter(supplier);
    if (supplier.mode === SUPPLIER_MODES.API && !adapter.isConfigured()) {
        throw new FulfillmentError("SUPPLIER_ADAPTER_NOT_CONFIGURED", "Supplier API adapter is not configured.", 409);
    }

    const existingActive = await FulfillmentAttempt.findOne({ orderId: order._id, status: { $in: ACTIVE_FULFILLMENT_STATUSES } }).lean();
    if (existingActive) throw new FulfillmentError("FULFILLMENT_ALREADY_ACTIVE", "Fulfillment is already active for this order.", 409);
    const existingSucceeded = await FulfillmentAttempt.findOne({ orderId: order._id, status: FULFILLMENT_STATUSES.SUCCEEDED }).lean();
    if (existingSucceeded) throw new FulfillmentError("ORDER_ALREADY_FULFILLED", "Order already has a successful fulfillment.", 409);

    const idempotencyKey = cleanText(payload.idempotencyKey, 120) || `fulfillment:start:${order.orderId}:${String(mapping._id)}`;
    const existingIdempotent = await FulfillmentAttempt.findOne({ idempotencyKey }).lean();
    if (existingIdempotent) {
        throw new FulfillmentError("FULFILLMENT_IDEMPOTENCY_REUSED", "Fulfillment start request was already used.", 409);
    }

    const attempt = new FulfillmentAttempt({
        fulfillmentId: makeFulfillmentId(),
        orderId: order._id,
        orderCode: order.orderId,
        supplierId: supplier._id,
        supplierCodeSnapshot: supplier.supplierCode,
        supplierMappingId: mapping._id,
        productCode: mapping.productCode,
        packageCode: mapping.packageCode,
        region: mapping.region,
        mode: supplier.mode,
        status: FULFILLMENT_STATUSES.IN_PROGRESS,
        idempotencyKey,
        startedByAdminId: adminId(context.admin),
        assignedAdminId: adminId(context.admin),
        startedByUsernameSnapshot: context.admin?.username || "",
        supplierRequest: {
            executionMode: mapping.executionMode,
            supplierProductCode: mapping.supplierProductCode,
            supplierPackageCode: mapping.supplierPackageCode
        },
        supplierResult: normalizeSupplierResult({
            status: "PENDING",
            supplierCode: supplier.supplierCode,
            providerStatus: supplier.mode === SUPPLIER_MODES.MANUAL ? "MANUAL_IN_PROGRESS" : "API_PENDING",
            safeMessage: supplier.mode === SUPPLIER_MODES.MANUAL
                ? "Admin must complete fulfillment in the supplier system and record the result."
                : "Awaiting configured supplier adapter."
        }),
        startedAt: new Date()
    });

    try {
        await attempt.save();
    } catch (error) {
        if (error?.code === 11000) {
            throw new FulfillmentError("FULFILLMENT_ALREADY_ACTIVE", "Fulfillment is already active for this order.", 409);
        }
        throw error;
    }

    if (getAllowedNextStatuses(order.status).includes(ORDER_STATES.PROCESSING)) {
        await transitionOrder(order, ORDER_STATES.PROCESSING, {
            source: "fulfillment",
            actorType: "admin",
            actor: context.admin?.username || "admin",
            reason: `Fulfillment started ${attempt.fulfillmentId}`,
            idempotencyKey: `fulfillment:start:order:${attempt.fulfillmentId}`
        });
    }

    await writeAdminAudit({
        actor: context.admin,
        req: context.req,
        action: ADMIN_AUDIT_ACTIONS.FULFILLMENT_STARTED,
        resourceType: "FulfillmentAttempt",
        resourceId: attempt.fulfillmentId,
        metadata: {
            fulfillmentId: attempt.fulfillmentId,
            orderId: order.orderId,
            supplierCode: supplier.supplierCode,
            productCode: mapping.productCode,
            packageCode: mapping.packageCode
        }
    }).catch(() => null);

    return projectAttempt(attempt);
}

async function resolveFulfillment(fulfillmentId, action, payload = {}, context = {}) {
    const attempt = await FulfillmentAttempt.findOne({ fulfillmentId: cleanText(fulfillmentId, 80).toUpperCase() });
    if (!attempt) throw new FulfillmentError("FULFILLMENT_NOT_FOUND", "Fulfillment attempt not found.", 404);
    if (!ACTIVE_FULFILLMENT_STATUSES.includes(attempt.status)) {
        throw new FulfillmentError("FULFILLMENT_NOT_ACTIVE", "Fulfillment attempt is not active.", 409);
    }

    const order = await Order.findById(attempt.orderId);
    if (!order) throw new FulfillmentError("ORDER_NOT_FOUND", "Order not found.", 404);

    if (action === "succeed") {
        const supplierReference = cleanText(payload.supplierReference, 160);
        if (!supplierReference) throw new FulfillmentError("SUPPLIER_REFERENCE_REQUIRED", "Supplier reference is required.");
        const financialAttempts = await listFinancialFulfillmentAttempts(order._id);
        assertFulfillmentSuccessAllowed(order, financialAttempts.filter(item => item.fulfillmentId !== attempt.fulfillmentId));
        const lockedOrder = await acquireFinancialOutcome(order._id, FINANCIAL_OUTCOMES.FULFILLMENT_SUCCEEDED);
        order.financialOutcome = lockedOrder.financialOutcome;
        order.financialOutcomeAt = lockedOrder.financialOutcomeAt;

        attempt.status = FULFILLMENT_STATUSES.SUCCEEDED;
        attempt.supplierReference = supplierReference;
        attempt.supplierResult = normalizeSupplierResult({
            status: "SUCCEEDED",
            supplierReference,
            supplierCode: attempt.supplierCodeSnapshot,
            providerStatus: "MANUAL_CONFIRMED",
            safeMessage: "Manual fulfillment confirmed by Admin."
        });
        attempt.completedAt = new Date();
        await attempt.save();

        if (getAllowedNextStatuses(order.status).includes(ORDER_STATES.COMPLETED)) {
            await transitionOrder(order, ORDER_STATES.COMPLETED, {
                source: "fulfillment",
                actorType: "admin",
                actor: context.admin?.username || "admin",
                reason: `Fulfillment succeeded ${attempt.fulfillmentId}`,
                idempotencyKey: `fulfillment:success:order:${attempt.fulfillmentId}`
            });
        }

        await writeAdminAudit({
            actor: context.admin,
            req: context.req,
            action: ADMIN_AUDIT_ACTIONS.FULFILLMENT_SUCCEEDED,
            resourceType: "FulfillmentAttempt",
            resourceId: attempt.fulfillmentId,
            metadata: {
                fulfillmentId: attempt.fulfillmentId,
                orderId: order.orderId,
                supplierCode: attempt.supplierCodeSnapshot,
                supplierReference
            }
        }).catch(() => null);

        return projectAttempt(attempt);
    }

    if (action === "fail") {
        const failureReason = cleanText(payload.failureReason || payload.reason, 500);
        if (!failureReason) throw new FulfillmentError("FAILURE_REASON_REQUIRED", "Failure reason is required.");

        attempt.status = FULFILLMENT_STATUSES.FAILED;
        attempt.failureReason = failureReason;
        attempt.failureCode = cleanText(payload.failureCode, 80) || "MANUAL_FAILURE";
        attempt.supplierReference = cleanText(payload.supplierReference, 160);
        attempt.supplierResult = normalizeSupplierResult({
            status: "FAILED",
            supplierReference: attempt.supplierReference,
            supplierCode: attempt.supplierCodeSnapshot,
            providerStatus: "MANUAL_FAILED",
            failureCode: attempt.failureCode,
            safeMessage: failureReason
        });
        attempt.failedAt = new Date();
        await attempt.save();

        if (getAllowedNextStatuses(order.status).includes(ORDER_STATES.FAILED)) {
            await transitionOrder(order, ORDER_STATES.FAILED, {
                source: "fulfillment",
                actorType: "admin",
                actor: context.admin?.username || "admin",
                reason: `Fulfillment failed: ${failureReason}`,
                idempotencyKey: `fulfillment:failure:order:${attempt.fulfillmentId}`
            });
        }

        await writeAdminAudit({
            actor: context.admin,
            req: context.req,
            action: ADMIN_AUDIT_ACTIONS.FULFILLMENT_FAILED,
            resourceType: "FulfillmentAttempt",
            resourceId: attempt.fulfillmentId,
            metadata: {
                fulfillmentId: attempt.fulfillmentId,
                orderId: order.orderId,
                supplierCode: attempt.supplierCodeSnapshot,
                failureCode: attempt.failureCode,
                failureReason
            }
        }).catch(() => null);

        return projectAttempt(attempt);
    }

    if (action === "cancel") {
        attempt.status = FULFILLMENT_STATUSES.CANCELLED;
        attempt.cancelledAt = new Date();
        attempt.failureReason = cleanText(payload.reason, 500);
        await attempt.save();

        await writeAdminAudit({
            actor: context.admin,
            req: context.req,
            action: ADMIN_AUDIT_ACTIONS.FULFILLMENT_CANCELLED,
            resourceType: "FulfillmentAttempt",
            resourceId: attempt.fulfillmentId,
            metadata: {
                fulfillmentId: attempt.fulfillmentId,
                orderId: order.orderId,
                supplierCode: attempt.supplierCodeSnapshot
            }
        }).catch(() => null);

        return projectAttempt(attempt);
    }

    throw new FulfillmentError("INVALID_FULFILLMENT_ACTION", "Invalid fulfillment action.");
}

module.exports = {
    ACTIVE_FULFILLMENT_STATUSES,
    FULFILLMENT_STATUSES,
    FulfillmentError,
    createMapping,
    createSupplier,
    getAttempt,
    getOrderFulfillmentSummary,
    listAttempts,
    listEligibleMappingsForOrder,
    listMappings,
    listSuppliers,
    projectAttempt,
    resolveFulfillment,
    safeSupplierProjection,
    startFulfillmentForOrder,
    updateMapping,
    updateSupplier
};
