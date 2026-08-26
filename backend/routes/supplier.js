const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const {
    FulfillmentError,
    createMapping,
    createSupplier,
    getAttempt,
    listAttempts,
    listEligibleMappingsForOrder,
    listMappings,
    listSuppliers,
    resolveFulfillment,
    setMappingProductionRole,
    startManualAdminFulfillment,
    startFulfillmentForOrder,
    updateMapping,
    updateSupplier
} = require("../services/fulfillmentService");

function sendFulfillmentError(res, error) {
    if (error instanceof FulfillmentError || error?.name === "FinancialIntegrityError") {
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    console.log("Supplier/Fulfillment error:", error?.code || error?.name || "FULFILLMENT_ERROR");
    return res.status(500).json({
        success: false,
        code: "FULFILLMENT_ERROR",
        message: "Fulfillment operation failed"
    });
}

router.post("/supplier/mock-topup/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.FULFILLMENT_EXECUTE), (req, res) => {
    return res.status(410).json({
        success: false,
        code: "MOCK_SUPPLIER_DISABLED",
        message: "Mock supplier execution is disabled. Use Admin Fulfillment instead."
    });
});

router.get("/admin/suppliers", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_READ), async (req, res) => {
    try {
        const suppliers = await listSuppliers();
        return res.json({ success: true, suppliers });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.post("/admin/suppliers", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_MANAGE), async (req, res) => {
    try {
        const supplier = await createSupplier(req.body, { admin: req.admin, req });
        return res.status(201).json({ success: true, supplier });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.patch("/admin/suppliers/:supplierId", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_MANAGE), async (req, res) => {
    try {
        const supplier = await updateSupplier(req.params.supplierId, req.body, { admin: req.admin, req });
        return res.json({ success: true, supplier });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.get("/admin/suppliers/:supplierId/mappings", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_READ), async (req, res) => {
    try {
        const mappings = await listMappings({ supplierId: req.params.supplierId });
        return res.json({ success: true, mappings });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.post("/admin/suppliers/:supplierId/mappings", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIER_MAPPINGS_MANAGE), async (req, res) => {
    try {
        const mapping = await createMapping(req.params.supplierId, req.body, { admin: req.admin, req });
        return res.status(201).json({ success: true, mapping });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.patch("/admin/suppliers/:supplierId/mappings/:mappingId", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIER_MAPPINGS_MANAGE), async (req, res) => {
    try {
        const mapping = await updateMapping(req.params.supplierId, req.params.mappingId, req.body, { admin: req.admin, req });
        return res.json({ success: true, mapping });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.get("/admin/supplier-mappings", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_READ), async (req, res) => {
    try {
        const mappings = await listMappings(req.query);
        return res.json({ success: true, mappings });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.patch("/admin/supplier-mappings/:mappingId/production-role", adminMiddleware, requireAdminPermission(PERMISSIONS.OWNER_ROUTING_MANAGE), async (req, res) => {
    try {
        const mapping = await setMappingProductionRole(req.params.mappingId, req.body?.productionRole, { admin: req.admin, req });
        return res.json({ success: true, mapping });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.get("/admin/orders/:orderId/fulfillment-mappings", adminMiddleware, requireAdminPermission(PERMISSIONS.FULFILLMENT_READ), async (req, res) => {
    try {
        const mappings = await listEligibleMappingsForOrder(req.params.orderId);
        return res.json({ success: true, mappings });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.post("/admin/orders/:orderId/fulfillments", adminMiddleware, requireAdminPermission(PERMISSIONS.FULFILLMENT_EXECUTE), async (req, res) => {
    try {
        const attempt = await startFulfillmentForOrder(req.params.orderId, req.body, { admin: req.admin, req });
        return res.status(201).json({ success: true, attempt });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.get("/admin/fulfillments", adminMiddleware, requireAdminPermission(PERMISSIONS.FULFILLMENT_READ), async (req, res) => {
    try {
        const result = await listAttempts(req.query);
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.get("/admin/fulfillments/:fulfillmentId", adminMiddleware, requireAdminPermission(PERMISSIONS.FULFILLMENT_READ), async (req, res) => {
    try {
        const attempt = await getAttempt(req.params.fulfillmentId);
        return res.json({ success: true, attempt });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.post("/admin/fulfillments/:fulfillmentId/start", adminMiddleware, requireAdminPermission(PERMISSIONS.FULFILLMENT_EXECUTE), async (req, res) => {
    try {
        const attempt = await startManualAdminFulfillment(req.params.fulfillmentId, req.body, { admin: req.admin, req });
        return res.json({ success: true, attempt });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.post("/admin/fulfillments/:fulfillmentId/succeed", adminMiddleware, requireAdminPermission(PERMISSIONS.FULFILLMENT_RESOLVE), async (req, res) => {
    try {
        const attempt = await resolveFulfillment(req.params.fulfillmentId, "succeed", req.body, { admin: req.admin, req });
        return res.json({ success: true, attempt });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.post("/admin/fulfillments/:fulfillmentId/fail", adminMiddleware, requireAdminPermission(PERMISSIONS.FULFILLMENT_RESOLVE), async (req, res) => {
    try {
        const attempt = await resolveFulfillment(req.params.fulfillmentId, "fail", req.body, { admin: req.admin, req });
        return res.json({ success: true, attempt });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

router.post("/admin/fulfillments/:fulfillmentId/cancel", adminMiddleware, requireAdminPermission(PERMISSIONS.FULFILLMENT_RESOLVE), async (req, res) => {
    try {
        const attempt = await resolveFulfillment(req.params.fulfillmentId, "cancel", req.body, { admin: req.admin, req });
        return res.json({ success: true, attempt });
    } catch (error) {
        return sendFulfillmentError(res, error);
    }
});

module.exports = router;
