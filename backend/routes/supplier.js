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
const {
    AdminSupplierCatalogReadError,
    getOffer: getAdminSupplierCatalogOffer,
    getProduct: getAdminSupplierCatalogProduct,
    listOffers: listAdminSupplierCatalogOffers,
    listRuns: listAdminSupplierCatalogRuns
} = require("../services/adminSupplierCatalogReadService");
const {
    ReconciliationError,
    reviewContext: getSupplierCatalogReconciliation,
    decide: decideSupplierCatalogReconciliation,
    reopen: reopenSupplierCatalogReconciliation
} = require("../services/supplierCatalog/supplierCatalogReconciliationService");
const { SupplierCostAuthorityError, getCostAuthorityReview, promoteObservedCost } = require("../services/supplierCatalog/supplierCostAuthorityService");
const { SupplierCatalogIngestionError, runSupplierCatalogIngestion } = require("../services/supplierCatalog/supplierCatalogIngestionOrchestrator");
const { getSupplierCatalogIngestionHealth } = require("../services/supplierCatalog/supplierCatalogIngestionHealthService");
const { listCostCoverage, listCostCoverageOptions, approveSelectedCosts } = require("../services/supplierCatalog/supplierCostCoverageService");
const {
    AdminProductActivationError,
    getWorkspace: getProductActivationWorkspace,
    publishSelectedPackage,
    publishSelectedPackages
} = require("../services/adminProductActivationService");
const {
    ProductSourcePreparationError,
    generatePlan: generateProductSourcePreparationPlan,
    applyPlan: applyProductSourcePreparationPlan
} = require("../services/productSourcePreparationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const { StoreCatalogSelectionError, listStoreCatalogSelections, saveStoreCatalogSelection, removeStoreCatalogPackage, setStoreCatalogRegionVisibility } = require("../services/storeCatalogSelectionService");
const { StorePackageActivationError, inspectStorePackageActivation, activateStorePackage } = require("../services/storePackageActivationService");
const { SupplierInputContractReviewError, context: getInputContractReview, approve: approveInputContract } = require("../services/supplierCatalog/supplierInputContractReviewService");

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

function sendSupplierCatalogReadError(res, error) {
    if (error instanceof AdminSupplierCatalogReadError) {
        return res.status(error.statusCode || 400).json({ success: false, code: error.code, message: error.message });
    }
    console.log("Admin supplier catalog read error:", error?.code || error?.name || "SUPPLIER_CATALOG_READ_FAILED");
    return res.status(500).json({ success: false, code: "SUPPLIER_CATALOG_READ_FAILED", message: "Supplier catalog data unavailable" });
}
function sendInputContractError(res,error){if(error instanceof SupplierInputContractReviewError)return res.status(error.statusCode||400).json({success:false,code:error.code,message:error.message});console.log("Supplier input contract error:",error?.code||error?.name||"INPUT_CONTRACT_REVIEW_FAILED");return res.status(500).json({success:false,code:"INPUT_CONTRACT_REVIEW_FAILED",message:"Supplier input contract review failed."})}

function sendReconciliationError(res, error) {
    if (error instanceof ReconciliationError) return res.status(error.statusCode || 400).json({ success: false, code: error.code, message: error.message, details: error.details || {} });
    if (error?.code === 11000) return res.status(409).json({ success: false, code: "RECONCILIATION_CONFLICT", message: "A concurrent reconciliation decision already exists." });
    console.log("Supplier reconciliation error:", error?.code || error?.name || "RECONCILIATION_FAILED");
    return res.status(500).json({ success: false, code: "RECONCILIATION_FAILED", message: "Supplier reconciliation failed." });
}
function sendCostAuthorityError(res,error){if(error instanceof SupplierCostAuthorityError||error?.statusCode)return res.status(error.statusCode||400).json({success:false,code:error.code,message:error.message,details:error.details||{}});if(error?.code===11000)return res.status(409).json({success:false,code:"COST_AUTHORITY_CONFLICT",message:"A concurrent cost-authority operation already completed."});console.log("Supplier cost authority error:",error?.code||error?.name||"SUPPLIER_COST_AUTHORITY_FAILED");return res.status(500).json({success:false,code:"SUPPLIER_COST_AUTHORITY_FAILED",message:"Supplier cost-authority operation failed."})}
function sendIngestionError(res,error){if(error instanceof SupplierCatalogIngestionError||String(error?.code||"").startsWith("SUPPLIER_CATALOG_"))return res.status(error.statusCode||409).json({success:false,code:error.code,message:error.message,details:error.details||{}});console.log("Supplier catalog ingestion error:",error?.code||error?.name||"SUPPLIER_CATALOG_INGESTION_FAILED");return res.status(500).json({success:false,code:"SUPPLIER_CATALOG_INGESTION_FAILED",message:"Supplier catalog ingestion failed."})}
function sendActivationError(res,error){if(error instanceof AdminProductActivationError)return res.status(error.statusCode||400).json({success:false,code:error.code,message:error.message,details:error.details||{}});console.log("Product activation error:",error?.code||error?.name||"PRODUCT_ACTIVATION_FAILED");return res.status(500).json({success:false,code:"PRODUCT_ACTIVATION_FAILED",message:"Product activation operation failed."})}
function sendStorePackageActivationError(res,error){if(error instanceof StorePackageActivationError)return res.status(error.statusCode||400).json({success:false,code:error.code,message:error.message,details:error.details||{}});console.log("Store package activation error:",error?.code||error?.name||"STORE_PACKAGE_ACTIVATION_FAILED");return res.status(500).json({success:false,code:"STORE_PACKAGE_ACTIVATION_FAILED",message:"Store package activation failed."})}
function sendSourcePreparationError(res,error){if(error instanceof ProductSourcePreparationError)return res.status(error.statusCode||400).json({success:false,code:error.code,message:error.message,details:error.details||{}});console.log("Product source preparation error:",error?.code||error?.name||"PRODUCT_SOURCE_PREPARATION_FAILED");return res.status(500).json({success:false,code:"PRODUCT_SOURCE_PREPARATION_FAILED",message:"Product source preparation failed."})}
function sanitizeStoreSelectionErrorMessage(message) {
    return String(message || "")
        .replace(/(mongodb(?:\+srv)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@")
        .replace(/\b(password|passwd|secret|token|authorization|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
        .slice(0, 500);
}
function storeSelectionErrorDiagnostics(error) {
    return {
        name: String(error?.name || "Error").slice(0, 100),
        code: error?.code == null ? "" : String(error.code).slice(0, 100),
        codeName: String(error?.codeName || "").slice(0, 100),
        message: sanitizeStoreSelectionErrorMessage(error?.message)
    };
}
function sendStoreSelectionError(res,error){if(error instanceof StoreCatalogSelectionError)return res.status(error.statusCode||400).json({success:false,code:error.code,message:error.message,details:error.details||{}});console.log("Store Catalog selection error:",storeSelectionErrorDiagnostics(error));return res.status(500).json({success:false,code:"STORE_SELECTION_FAILED",message:"Store Catalog operation failed."})}
async function recordStoreSelectionAudit({ result, actor, req }, dependencies = {}) {
    const auditWriter = dependencies.auditWriter || writeAdminAudit;
    const logger = dependencies.logger || console.log;
    try {
        await auditWriter({actor,req,action:ADMIN_AUDIT_ACTIONS.STORE_CATALOG_SELECTION_SAVED,resourceType:"StoreCatalogSelection",resourceId:String(result.selection._id),metadata:{productCode:result.selection.productCode,supplierMarket:result.selection.supplierMarket,sellingRegions:result.selection.sellingRegions,packageCount:result.selection.packages.length}});
        return { auditRecorded: true, auditWarning: "" };
    } catch (error) {
        logger("Store Catalog selection audit error:", storeSelectionErrorDiagnostics(error));
        return { auditRecorded: false, auditWarning: "STORE_SELECTION_AUDIT_LOG_FAILED" };
    }
}

router.get("/admin/product-activation", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_READ), async (req,res)=>{
    try { res.set("Cache-Control","no-store"); return res.json({success:true,...await getProductActivationWorkspace(req.query)}); }
    catch(error){ return sendActivationError(res,error); }
});
router.get("/admin/store-catalog-selections",adminMiddleware,requireAdminPermission(PERMISSIONS.CATALOG_READ),async(req,res)=>{try{res.set("Cache-Control","no-store");return res.json({success:true,selections:await listStoreCatalogSelections(req.query)})}catch(error){return sendStoreSelectionError(res,error)}});
router.get("/admin/store-catalog-selections/:selectionId/packages/:mappingId/activation",adminMiddleware,requireAdminPermission(PERMISSIONS.SUPPLIERS_READ),async(req,res)=>{try{res.set("Cache-Control","no-store");return res.json({success:true,...await inspectStorePackageActivation({selectionId:req.params.selectionId,mappingId:req.params.mappingId,customerMarket:req.query.customerMarket})})}catch(error){return sendStorePackageActivationError(res,error)}});
router.post("/admin/store-catalog-selections/:selectionId/packages/:mappingId/activation",adminMiddleware,requireAdminPermission(PERMISSIONS.OWNER_ROUTING_MANAGE),async(req,res)=>{try{return res.json({success:true,...await activateStorePackage({...req.body,selectionId:req.params.selectionId,mappingId:req.params.mappingId},{actor:req.admin,req})})}catch(error){return sendStorePackageActivationError(res,error)}});
router.post("/admin/store-catalog-selections",adminMiddleware,requireAdminPermission(PERMISSIONS.CATALOG_MANAGE),async(req,res)=>{try{const result=await saveStoreCatalogSelection(req.body,{actor:req.admin});const audit=await recordStoreSelectionAudit({result,actor:req.admin,req});return res.json({success:true,...result,...audit})}catch(error){return sendStoreSelectionError(res,error)}});
router.delete("/admin/store-catalog-selections/:selectionId/packages/:packageCode",adminMiddleware,requireAdminPermission(PERMISSIONS.CATALOG_MANAGE),async(req,res)=>{try{const result=await removeStoreCatalogPackage({selectionId:req.params.selectionId,packageCode:req.params.packageCode,expectedDecisionVersion:req.body?.expectedDecisionVersion,confirmed:req.body?.confirmed===true},{actor:req.admin});await writeAdminAudit({actor:req.admin,req,action:ADMIN_AUDIT_ACTIONS.STORE_CATALOG_PACKAGE_REMOVED,resourceType:"StoreCatalogSelection",resourceId:req.params.selectionId,metadata:{packageCode:req.params.packageCode,wasLive:result.wasLive}});return res.json({success:true,...result})}catch(error){return sendStoreSelectionError(res,error)}});
router.patch("/admin/store-catalog-selections/:selectionId/regions/:region/visibility",adminMiddleware,requireAdminPermission(PERMISSIONS.CATALOG_MANAGE),async(req,res)=>{try{const result=await setStoreCatalogRegionVisibility({selectionId:req.params.selectionId,region:req.params.region,visible:req.body?.visible,expectedDecisionVersion:req.body?.expectedDecisionVersion},{actor:req.admin});await writeAdminAudit({actor:req.admin,req,action:ADMIN_AUDIT_ACTIONS.STORE_CATALOG_REGION_VISIBILITY_CHANGED,resourceType:"StoreCatalogSelection",resourceId:req.params.selectionId,metadata:{region:req.params.region,visible:req.body?.visible}});return res.json({success:true,...result})}catch(error){return sendStoreSelectionError(res,error)}});

router.post("/admin/product-activation/source-preparation/plan", adminMiddleware, requireAdminPermission(PERMISSIONS.OWNER_ROUTING_MANAGE), async(req,res)=>{
    try {
        const plan=await generateProductSourcePreparationPlan(req.body);
        await writeAdminAudit({actor:req.admin,req,action:ADMIN_AUDIT_ACTIONS.PRODUCT_SOURCE_PREPARATION_PLANNED,resourceType:"ProductSourcePreparation",resourceId:plan.planHash,metadata:{productCode:plan.selection.productCode,supplierId:plan.selection.supplierId,supplierCode:plan.selection.supplierCode,supplierMarket:plan.selection.supplierMarket,customerMarket:plan.selection.customerMarket,mappingIds:plan.selection.selectedMappingIds,planHash:plan.planHash,summary:plan.summary}});
        return res.json({success:true,plan});
    } catch(error){return sendSourcePreparationError(res,error)}
});

router.post("/admin/product-activation/source-preparation/apply", adminMiddleware, requireAdminPermission(PERMISSIONS.OWNER_ROUTING_MANAGE), async(req,res)=>{
    try{return res.json({success:true,...await applyProductSourcePreparationPlan(req.body?.plan,{actor:req.admin})})}
    catch(error){return sendSourcePreparationError(res,error)}
});

router.get("/admin/supplier-cost-coverage",adminMiddleware,requireAdminPermission(PERMISSIONS.SUPPLIERS_READ),async(req,res)=>{try{res.set("Cache-Control","no-store");return res.json({success:true,...await listCostCoverage(req.query)})}catch(error){return sendCostAuthorityError(res,error)}});
router.get("/admin/supplier-cost-coverage/options",adminMiddleware,requireAdminPermission(PERMISSIONS.SUPPLIERS_READ),async(req,res)=>{try{res.set("Cache-Control","private, max-age=60");return res.json({success:true,...await listCostCoverageOptions(req.query)})}catch(error){return sendCostAuthorityError(res,error)}});
router.post("/admin/supplier-cost-coverage/approve",adminMiddleware,requireAdminPermission(PERMISSIONS.SUPPLIER_COST_MANAGE),async(req,res)=>{try{return res.json({success:true,...await approveSelectedCosts(req.body,{actor:req.admin,requestId:req.id||req.headers["x-request-id"]||""})})}catch(error){return sendCostAuthorityError(res,error)}});

router.post("/admin/product-activation/products/:productCode/packages/:packageCode/publication", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async(req,res)=>{
    try { return res.json({success:true,...await publishSelectedPackage({...req.body,productCode:req.params.productCode,packageCode:req.params.packageCode,actor:req.admin?.username||"admin"})}); }
    catch(error){ return sendActivationError(res,error); }
});
router.post("/admin/product-activation/products/:productCode/publication", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async(req,res)=>{
    try { return res.json({success:true,...await publishSelectedPackages({...req.body,productCode:req.params.productCode,actor:req.admin?.username||"admin"})}); }
    catch(error){ return sendActivationError(res,error); }
});

router.get("/admin/supplier-catalog", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_READ), async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ success: true, ...(await listAdminSupplierCatalogOffers(req.query)) }); }
    catch (error) { return sendSupplierCatalogReadError(res, error); }
});

router.get("/admin/supplier-catalog/products/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_READ), async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ success: true, ...(await getAdminSupplierCatalogProduct(req.params.id)) }); }
    catch (error) { return sendSupplierCatalogReadError(res, error); }
});
router.get("/admin/supplier-catalog/products/:id/input-contract",adminMiddleware,requireAdminPermission(PERMISSIONS.SUPPLIERS_READ),async(req,res)=>{try{res.set("Cache-Control","no-store");return res.json({success:true,review:await getInputContractReview(req.params.id)})}catch(error){return sendInputContractError(res,error)}});
router.post("/admin/supplier-catalog/products/:id/input-contract/approve",adminMiddleware,requireAdminPermission(PERMISSIONS.OWNER_ROUTING_MANAGE),async(req,res)=>{try{return res.status(201).json({success:true,...await approveInputContract(req.params.id,req.body,{actor:req.admin,req})})}catch(error){return sendInputContractError(res,error)}});

router.get("/admin/supplier-catalog/offers/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_READ), async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ success: true, ...(await getAdminSupplierCatalogOffer(req.params.id)) }); }
    catch (error) { return sendSupplierCatalogReadError(res, error); }
});

router.get("/admin/supplier-catalog/runs", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_READ), async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ success: true, ...(await listAdminSupplierCatalogRuns(req.query)) }); }
    catch (error) { return sendSupplierCatalogReadError(res, error); }
});

router.get("/admin/supplier-catalog/automation/health", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_READ), async (req,res)=>{
    try { res.set("Cache-Control","no-store"); return res.json({success:true, ...(await getSupplierCatalogIngestionHealth())}); }
    catch(error){ return sendIngestionError(res,error); }
});

router.post("/admin/supplier-catalog/automation/:supplierCode/run", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIER_CATALOG_INGEST), async(req,res)=>{
    try { const result=await runSupplierCatalogIngestion({supplierCode:req.params.supplierCode,trigger:"ADMIN_MANUAL",actor:{adminId:req.admin?._id||req.admin?.id,username:req.admin?.username||"",role:req.admin?.role||""},reason:req.body?.reason||"Admin requested catalog refresh"}); return res.status(202).json({success:true,result}); }
    catch(error){ return sendIngestionError(res,error); }
});

router.get("/admin/supplier-catalog/offers/:id/reconciliation", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIERS_READ), async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ success: true, reconciliation: await getSupplierCatalogReconciliation(req.params.id) }); }
    catch (error) { return sendReconciliationError(res, error); }
});

router.get("/admin/supplier-catalog/offers/:id/cost-authority",adminMiddleware,requireAdminPermission(PERMISSIONS.SUPPLIERS_READ),async(req,res)=>{try{res.set("Cache-Control","no-store");return res.json({success:true,costAuthority:await getCostAuthorityReview(req.params.id,{mappingId:req.query.mappingId})})}catch(error){return sendCostAuthorityError(res,error)}});
router.post("/admin/supplier-catalog/offers/:id/cost-authority/promote",adminMiddleware,requireAdminPermission(PERMISSIONS.SUPPLIER_COST_MANAGE),async(req,res)=>{try{return res.status(201).json({success:true,...await promoteObservedCost({...req.body,supplierCatalogOfferId:req.params.id},{actor:req.admin,requestId:req.id||req.headers["x-request-id"]||""})})}catch(error){return sendCostAuthorityError(res,error)}});

router.post("/admin/supplier-catalog/offers/:id/reconciliation", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIER_CATALOG_RECONCILE), async (req, res) => {
    try { return res.status(201).json({ success: true, ...(await decideSupplierCatalogReconciliation({ ...req.body, supplierCatalogOfferId: req.params.id }, { actor: req.admin, requestId: req.id || req.headers["x-request-id"] || "" })) }); }
    catch (error) { return sendReconciliationError(res, error); }
});

router.post("/admin/supplier-catalog/offers/:id/reconciliation/reopen", adminMiddleware, requireAdminPermission(PERMISSIONS.SUPPLIER_CATALOG_RECONCILE), async (req, res) => {
    try { return res.status(201).json({ success: true, ...(await reopenSupplierCatalogReconciliation({ ...req.body, supplierCatalogOfferId: req.params.id }, { actor: req.admin, requestId: req.id || req.headers["x-request-id"] || "" })) }); }
    catch (error) { return sendReconciliationError(res, error); }
});

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
module.exports._test = { sanitizeStoreSelectionErrorMessage, storeSelectionErrorDiagnostics, recordStoreSelectionAudit };
