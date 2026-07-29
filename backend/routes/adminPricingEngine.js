"use strict";

const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const {
    AdminPricingEngineError,
    getPricingConsoleState,
    publishPricing,
    runPricingEngineDiagnostics,
    saveDraftPricing,
    withBootstrapDeadline
} = require("../services/commerce/adminPricingEngineService");
const {
    batchPreviewDailyPricing,
    publishDailyPricing
} = require("../services/commerce/adminPricingControlCenterService");

const PRICING_ENGINE_REQUEST_TIMEOUT_MS = 8000;

function createRequestId() {
    return `pricing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPricingTrace(req, res) {
    const startedAt = Date.now();
    const requestId = req.headers["x-request-id"] || req.headers["x-render-request-id"] || createRequestId();
    let completed = false;
    const trace = {
        requestId,
        get completed() {
            return completed || res.headersSent || req.aborted;
        },
        markCompleted() {
            completed = true;
        },
        lastCheckpoint: "created",
        log(checkpoint, metadata = {}) {
            this.lastCheckpoint = checkpoint;
            console.log("[PRICING_ENGINE_TRACE]", {
                requestId,
                checkpoint,
                elapsedMs: Date.now() - startedAt,
                adminId: req.admin?._id ? String(req.admin._id).slice(0, 8) : req.admin?.id ? String(req.admin.id).slice(0, 8) : "",
                adminRole: req.admin?.role || "",
                reqAborted: Boolean(req.aborted),
                headersSent: Boolean(res.headersSent),
                ...metadata
            });
        }
    };
    req.pricingTrace = trace;
    req.pricingRequestId = requestId;
    trace.log("PRICING_REQUEST_RECEIVED", { method: req.method, path: req.originalUrl || req.url });
    req.on("aborted", () => {
        trace.log("REQUEST_ABORTED");
        completed = true;
    });
    res.on("close", () => {
        if (!res.writableEnded && !completed) trace.log("REQUEST_ABORTED", { close: true });
        completed = true;
    });
    return trace;
}

function startPricingDeadline(req, res) {
    const trace = req.pricingTrace || createPricingTrace(req, res);
    const timer = setTimeout(() => {
        if (res.headersSent || req.aborted) return;
        trace.log("REQUEST_ERROR", {
            code: "PRICING_WORKSPACE_BOOTSTRAP_TIMEOUT",
            message: "Pricing workspace data could not be loaded in time.",
            stage: trace.lastCheckpoint || "unknown"
        });
        trace.markCompleted();
        return res.status(503).json({
            success: false,
            code: "PRICING_WORKSPACE_BOOTSTRAP_TIMEOUT",
            message: "Pricing workspace data could not be loaded in time.",
            stage: trace.lastCheckpoint || "unknown",
            requestId: trace.requestId
        });
    }, PRICING_ENGINE_REQUEST_TIMEOUT_MS);
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    return timer;
}

function pricingLifecycle(req, res, next) {
    createPricingTrace(req, res);
    startPricingDeadline(req, res);
    next();
}

function traceCheckpoint(checkpoint, metadata = {}) {
    return (req, _res, next) => {
        req.pricingTrace?.log(checkpoint, metadata);
        return next();
    };
}

function pricingAuth(permission) {
    return [
        traceCheckpoint("AUTH_STARTED"),
        adminMiddleware,
        traceCheckpoint("AUTH_COMPLETED"),
        traceCheckpoint("RBAC_STARTED", { permission }),
        requireAdminPermission(permission),
        traceCheckpoint("RBAC_COMPLETED", { permission })
    ];
}

function sendPricingError(req, res, error) {
    const trace = req?.pricingTrace;
    trace?.log("REQUEST_ERROR", {
        errorName: error?.name || "Error",
        errorCode: error?.code || "",
        errorMessage: error?.message || "",
        ...(error?.stage ? { stage: error.stage } : {})
    });
    if (res.headersSent || req?.aborted) return;
    if (error instanceof AdminPricingEngineError) {
        trace?.markCompleted();
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code,
            message: error.message,
            ...(error.stage ? { stage: error.stage } : {}),
            requestId: trace?.requestId
        });
    }

    if (error?.name === "ValidationError") {
        trace?.markCompleted();
        return res.status(400).json({
            success: false,
            code: "PRICING_VALIDATION_ERROR",
            message: error.message || "Pricing validation failed.",
            requestId: trace?.requestId
        });
    }

    if (error?.code === 11000) {
        trace?.markCompleted();
        return res.status(409).json({
            success: false,
            code: "PRICING_VERSION_CONFLICT",
            message: "Pricing version already exists. Reload and try again.",
            requestId: trace?.requestId
        });
    }

    if (
        error?.name === "MongoServerError" ||
        error?.name === "MongooseError" ||
        /mongo|database|timed out|unavailable/i.test(error?.message || "")
    ) {
        console.log("Admin pricing engine data error:", error?.code || error?.name || "PRICING_DATA_UNAVAILABLE");
        trace?.markCompleted();
        return res.status(503).json({
            success: false,
            code: "PRICING_DATA_UNAVAILABLE",
            message: "Pricing data is temporarily unavailable. Please retry.",
            requestId: trace?.requestId
        });
    }

    console.log("Admin pricing engine error:", error?.code || error?.name || "PRICING_ENGINE_FAILED");
    trace?.markCompleted();
    return res.status(500).json({
        success: false,
        code: "PRICING_ENGINE_FAILED",
        message: "Pricing Engine request failed",
        requestId: trace?.requestId
    });
}

function requireOwner(req, res, next) {
    if (String(req.admin?.role || "").toUpperCase() === "OWNER") return next();
    return res.status(403).json({
        success: false,
        code: "OWNER_REQUIRED",
        message: "Only the OWNER can publish production pricing."
    });
}

router.get("/admin/pricing-engine", pricingLifecycle, ...pricingAuth(PERMISSIONS.CATALOG_READ), async (req, res) => {
    try {
        req.pricingTrace?.log("ROUTE_HANDLER_ENTERED");
        const state = await withBootstrapDeadline(getPricingConsoleState({ trace: req.pricingTrace }), req.pricingTrace);
        if (res.headersSent || req.aborted || req.pricingTrace?.completed) return;
        req.pricingTrace?.log("RESPONSE_SERIALIZATION_STARTED");
        const responseBody = { success: true, requestId: req.pricingTrace?.requestId, ...state };
        const serialized = JSON.stringify(responseBody);
        req.pricingTrace?.log("RESPONSE_SERIALIZATION_COMPLETED", {
            bytes: Buffer.byteLength(serialized)
        });
        req.pricingTrace?.log("RESPONSE_SENT", {
            products: Array.isArray(state.products) ? state.products.length : 0,
            policies: Array.isArray(state.policies) ? state.policies.length : 0
        });
        req.pricingTrace?.markCompleted();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.send(serialized);
    } catch (error) {
        return sendPricingError(req, res, error);
    }
});

router.get("/admin/pricing-engine/diagnostics", pricingLifecycle, ...pricingAuth(PERMISSIONS.CATALOG_MANAGE), requireOwner, async (req, res) => {
    try {
        req.pricingTrace?.log("ROUTE_HANDLER_ENTERED", { diagnostic: true });
        const diagnostics = await runPricingEngineDiagnostics(req.pricingTrace);
        if (res.headersSent || req.aborted || req.pricingTrace?.completed) return;
        req.pricingTrace?.log("RESPONSE_SENT", { diagnostic: true, checks: diagnostics.checks.length });
        req.pricingTrace?.markCompleted();
        return res.json({
            success: true,
            requestId: req.pricingTrace?.requestId,
            authReached: true,
            adminRole: req.admin?.role || "",
            ...diagnostics
        });
    } catch (error) {
        return sendPricingError(req, res, error);
    }
});

router.put("/admin/pricing-engine/draft", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async (req, res) => {
    try {
        const result = await saveDraftPricing(req.body || {}, req.admin || {});
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PRICING_DRAFT_SAVED,
            resourceType: "PricingPolicy",
            resourceId: "production-draft",
            metadata: {
                policies: result.saved.map(policy => ({
                    region: policy.region,
                    currency: policy.currency,
                    policyId: policy.id
                })),
                supplierCostDraftRows: result.workspaceDraft?.summary?.saved || 0,
                supplierCostDraftGroups: result.workspaceDraft?.summary?.groups || 0
            }
        });
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendPricingError(req, res, error);
    }
});

router.post("/admin/pricing-engine/publish", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), requireOwner, async (req, res) => {
    try {
        const result = await publishPricing(req.admin || {});
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PRICING_PUBLISHED,
            resourceType: "PriceVersion",
            resourceId: result.version.versionId,
            metadata: {
                pricingVersion: result.version.versionNumber,
                publishedAt: result.version.publishedAt,
                publishedBy: result.version.publishedBy,
                oldValues: result.oldValues,
                newValues: result.newValues
            }
        });
        return res.json({
            success: true,
            version: {
                versionId: result.version.versionId,
                versionNumber: result.version.versionNumber,
                status: result.version.status,
                publishedAt: result.version.publishedAt,
                publishedBy: result.version.publishedBy
            },
            state: result.state
        });
    } catch (error) {
        return sendPricingError(req, res, error);
    }
});

router.post("/admin/pricing-engine/workspace/preview", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_READ), async (req, res) => {
    try {
        const result = await batchPreviewDailyPricing({
            rows: req.body?.rows || [],
            couponCode: req.body?.couponCode || "",
            region: req.body?.region || "",
            actor: req.admin || null
        });
        return res.json(result);
    } catch (error) {
        return sendPricingError(req, res, error);
    }
});

router.post("/admin/pricing-engine/workspace/publish", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), requireOwner, async (req, res) => {
    try {
        const result = await publishDailyPricing({
            rows: req.body?.rows || [],
            publishAll: req.body?.publishAll === true,
            region: req.body?.region || "",
            actor: req.admin?.username || "admin",
            admin: req.admin || null
        });
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.CATALOG_PACKAGE_UPDATED,
            resourceType: "CatalogPackage",
            resourceId: "daily-pricing-workspace",
            metadata: {
                requested: result.summary.requested,
                published: result.summary.published,
                failed: result.summary.failed,
                skipped: result.summary.skipped
            }
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.json(result);
    } catch (error) {
        return sendPricingError(req, res, error);
    }
});

module.exports = router;
