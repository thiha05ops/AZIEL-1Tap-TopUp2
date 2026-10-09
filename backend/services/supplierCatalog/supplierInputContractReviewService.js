"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const Product = require("../../models/SupplierCatalogProduct");
const Supplier = require("../../models/Supplier");
const { writeAdminAudit, ADMIN_AUDIT_ACTIONS } = require("../adminAuditService");
const { normalizedFields } = require("../suppliers/fazercardsFulfillmentContractService");

const clean = value => String(value == null ? "" : value).trim();
const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
class SupplierInputContractReviewError extends Error { constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; } }

function sourceLock(product) { return { productId: clean(product._id), sourceHash: clean(product.rawSnapshotHash), sourceRevision: clean(product.sourceRevision), updatedAt: product.updatedAt ? new Date(product.updatedAt).toISOString() : "" }; }
function actor(admin = {}) { return { adminId: clean(admin._id || admin.id), username: clean(admin.username), role: clean(admin.role) }; }
function sourceInstructions(product) { return clean(product.rawSnapshot?.note || product.rawSnapshot?.instructions || product.rawSnapshot?.description || product.metadata?.instructions); }
function reviewedContract(product, input, reviewer, now) {
    const fields = normalizedFields({ normalizedInputContract: { fields: input.fields } });
    if (!fields.length) throw new SupplierInputContractReviewError("INPUT_CONTRACT_FIELDS_INVALID", "At least one valid customer/provider field pair is required.");
    const evidenceReference = clean(input.evidenceReference);
    const evidenceExcerpt = clean(input.evidenceExcerpt);
    if (!evidenceReference || !evidenceExcerpt) throw new SupplierInputContractReviewError("INPUT_CONTRACT_EVIDENCE_REQUIRED", "Authoritative source reference and evidence excerpt are required.");
    for (const field of fields) {
        if (!evidenceExcerpt.toLowerCase().includes(field.providerField.toLowerCase())) throw new SupplierInputContractReviewError("PROVIDER_FIELD_NOT_EVIDENCED", `Authoritative evidence does not contain provider field ${field.providerField}.`);
    }
    const base = { version: 1, fields: fields.map(field => ({ ...field, evidenceReference })), authority: "OWNER_REVIEWED_PROVIDER_EVIDENCE", review: { status: "OWNER_REVIEWED", sourceHash: product.rawSnapshotHash, sourceRevision: product.sourceRevision || "", evidenceReference, evidenceExcerpt, reviewedBy: reviewer, reviewedAt: now } };
    return { ...base, fingerprint: sha({ sourceHash: product.rawSnapshotHash, fields: base.fields, authority: base.authority }) };
}
async function context(productId) {
    if (!mongoose.isValidObjectId(productId)) throw new SupplierInputContractReviewError("INVALID_PRODUCT_ID", "Invalid supplier catalog product ID.");
    const product = await Product.findById(productId).lean();
    if (!product) throw new SupplierInputContractReviewError("SUPPLIER_CATALOG_PRODUCT_NOT_FOUND", "Supplier catalog product not found.", 404);
    const supplier = await Supplier.findById(product.supplierId).lean();
    if (clean(supplier?.supplierCode).toUpperCase() !== "FAZERCARDS") throw new SupplierInputContractReviewError("INPUT_CONTRACT_PROTOCOL_UNSUPPORTED", "This review workflow supports the FazerCards top-up protocol only.", 409);
    return { product: { id: clean(product._id), supplierCode: clean(supplier?.supplierCode), supplierName: clean(supplier?.name), supplierProductCode: product.supplierProductCode, supplierMarket: product.supplierMarketCode, displayName: product.displayName, instructions: sourceInstructions(product), rawSnapshot: product.rawSnapshot || {}, normalizedInputContract: product.normalizedInputContract || {} }, sourceLock: sourceLock(product), approvable: Boolean(sourceInstructions(product)), warning: "Do not enter or approve a provider field key unless it appears in authoritative supplier evidence." };
}
async function approve(productId, input, ctx = {}) {
    if (input.confirmed !== true) throw new SupplierInputContractReviewError("INPUT_CONTRACT_CONFIRMATION_REQUIRED", "Explicit Owner confirmation is required.");
    const session = await mongoose.startSession();
    try { return await session.withTransaction(async () => {
        const product = await Product.findById(productId).session(session);
        if (!product) throw new SupplierInputContractReviewError("SUPPLIER_CATALOG_PRODUCT_NOT_FOUND", "Supplier catalog product not found.", 404);
        const supplier = await Supplier.findById(product.supplierId).session(session).lean();
        if (clean(supplier?.supplierCode).toUpperCase() !== "FAZERCARDS") throw new SupplierInputContractReviewError("INPUT_CONTRACT_PROTOCOL_UNSUPPORTED", "This review workflow supports the FazerCards top-up protocol only.", 409);
        const expected = input.sourceLock || {};
        if (clean(expected.sourceHash) !== clean(product.rawSnapshotHash) || clean(expected.sourceRevision) !== clean(product.sourceRevision) || (expected.updatedAt && new Date(expected.updatedAt).getTime() !== new Date(product.updatedAt).getTime())) throw new SupplierInputContractReviewError("INPUT_CONTRACT_SOURCE_STALE", "Supplier input evidence changed; reopen and review the latest source.", 409);
        const now = new Date(), reviewer = actor(ctx.actor), before = product.normalizedInputContract || {}, contract = reviewedContract(product, input, reviewer, now);
        product.normalizedInputContract = contract;
        product.requiredFields = contract.fields;
        await product.save({ session });
        await writeAdminAudit({ actor: ctx.actor, req: ctx.req, action: ADMIN_AUDIT_ACTIONS.SUPPLIER_INPUT_CONTRACT_APPROVED, resourceType: "SupplierCatalogProduct", resourceId: productId, metadata: { supplierProductCode: product.supplierProductCode, supplierMarket: product.supplierMarketCode, previousFingerprint: before.fingerprint || "", fingerprint: contract.fingerprint, sourceHash: product.rawSnapshotHash, fields: contract.fields.map(x => ({ customerField: x.customerField, providerField: x.providerField, required: x.required })) }, session });
        return { contract, sourceLock: sourceLock(product) };
    }); } finally { await session.endSession(); }
}

module.exports = Object.freeze({ SupplierInputContractReviewError, context, approve, reviewedContract, sourceLock });
