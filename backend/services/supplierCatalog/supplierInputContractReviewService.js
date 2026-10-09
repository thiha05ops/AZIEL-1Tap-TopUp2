"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const Product = require("../../models/SupplierCatalogProduct");
const Offer = require("../../models/SupplierCatalogOffer");
const Supplier = require("../../models/Supplier");
const { writeAdminAudit, ADMIN_AUDIT_ACTIONS } = require("../adminAuditService");
const { normalizedFields, protocolForSupplier, providerDestinationAllowed } = require("../suppliers/fazercardsFulfillmentContractService");

const clean = value => String(value == null ? "" : value).trim();
const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
class SupplierInputContractReviewError extends Error { constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; } }

function sourceLock(product, offer = null) { const active=offer?.metadata?.normalizedInputContract||product.normalizedInputContract||{}; return { productId: clean(product._id), sourceHash: clean(product.rawSnapshotHash), sourceRevision: clean(product.sourceRevision), updatedAt: product.updatedAt ? new Date(product.updatedAt).toISOString() : "", offerId: clean(offer?._id), offerSourceHash: clean(offer?.rawSnapshotHash), expectedDecisionVersion: Number(active.decisionVersion||0) }; }
function actor(admin = {}) { return { adminId: clean(admin._id || admin.id), username: clean(admin.username), role: clean(admin.role) }; }
function sourceInstructions(product) { return clean(product.rawSnapshot?.note || product.rawSnapshot?.instructions || product.rawSnapshot?.description || product.metadata?.instructions); }
function reviewedContract(product, input, reviewer, now, protocol = "FAZERCARDS_TOPUPS_ORDER_V2", previous = {}) {
    const fields = normalizedFields({ normalizedInputContract: { fields: input.fields } });
    const noCustomerInput = input.noCustomerInput === true;
    if (!fields.length && !noCustomerInput) throw new SupplierInputContractReviewError("INPUT_CONTRACT_FIELDS_INVALID", "Add at least one valid customer field or explicitly approve that no customer information is required.");
    if (fields.some(field => !providerDestinationAllowed(protocol, field.providerField))) throw new SupplierInputContractReviewError("INPUT_CONTRACT_PROVIDER_DESTINATION_INVALID", "A provider destination is not supported by this supplier protocol.");
    const evidenceReference = clean(input.evidenceReference);
    const evidenceExcerpt = clean(input.evidenceExcerpt);
    const transactionalServiceCode = protocol === "WONDD_GAME_ID_TOPUP" ? clean(input.transactionalServiceCode || previous.transactionalServiceCode || product.metadata?.transactionalServiceCode) : "";
    if (protocol === "WONDD_GAME_ID_TOPUP" && !/^[A-Za-z0-9_-]{1,80}$/.test(transactionalServiceCode)) throw new SupplierInputContractReviewError("WONDD_TRANSACTIONAL_SERVICE_IDENTITY_REQUIRED", "Record the exact authoritative WonDD execution service code.");
    if (!evidenceReference || !evidenceExcerpt) throw new SupplierInputContractReviewError("INPUT_CONTRACT_EVIDENCE_REQUIRED", "Authoritative source reference and evidence excerpt are required.");
    for (const field of fields) {
        if (!evidenceExcerpt.toLowerCase().includes(field.providerField.toLowerCase())) throw new SupplierInputContractReviewError("PROVIDER_FIELD_NOT_EVIDENCED", `Authoritative evidence does not contain provider field ${field.providerField}.`);
    }
    const base = { version: 1, decisionVersion: Number(previous.decisionVersion || 0) + 1, protocol, transactionalServiceCode, noCustomerInput, fields: fields.map(field => ({ ...field, evidenceReference })), authority: "OWNER_REVIEWED_PROVIDER_EVIDENCE", review: { status: "OWNER_REVIEWED", sourceHash: product.rawSnapshotHash, sourceRevision: product.sourceRevision || "", evidenceReference, evidenceExcerpt, reviewedBy: reviewer, reviewedAt: now } };
    return { ...base, fingerprint: sha({ sourceHash: product.rawSnapshotHash, protocol, transactionalServiceCode, noCustomerInput, fields: base.fields, authority: base.authority }) };
}
async function context(productId, offerId = "") {
    if (!mongoose.isValidObjectId(productId)) throw new SupplierInputContractReviewError("INVALID_PRODUCT_ID", "Invalid supplier catalog product ID.");
    const product = await Product.findById(productId).lean();
    if (!product) throw new SupplierInputContractReviewError("SUPPLIER_CATALOG_PRODUCT_NOT_FOUND", "Supplier catalog product not found.", 404);
    const supplier = await Supplier.findById(product.supplierId).lean();
    const offer = offerId ? await Offer.findOne({ _id: offerId, supplierCatalogProductId: product._id }).lean() : null;
    if (offerId && !offer) throw new SupplierInputContractReviewError("SUPPLIER_CATALOG_OFFER_NOT_FOUND", "Supplier catalog offer not found for this product.", 404);
    const protocol = protocolForSupplier(supplier?.supplierCode);
    if (!protocol) throw new SupplierInputContractReviewError("INPUT_CONTRACT_PROTOCOL_UNSUPPORTED", "This supplier protocol does not support declarative customer information contracts.", 409);
    const activeContract = offer?.metadata?.normalizedInputContract || product.normalizedInputContract || {};
    return { product: { id: clean(product._id), supplierCode: clean(supplier?.supplierCode), supplierName: clean(supplier?.name), supplierProductCode: product.supplierProductCode, supplierMarket: product.supplierMarketCode, displayName: product.displayName, instructions: sourceInstructions(product), rawSnapshot: product.rawSnapshot || {}, normalizedInputContract: activeContract, protocol, transactionalServiceCode: clean(activeContract.transactionalServiceCode || product.metadata?.transactionalServiceCode) }, offer: offer ? { id: clean(offer._id), supplierOfferCode: offer.supplierOfferCode, supplierOfferName: offer.supplierOfferName } : null, authorityScope: offer ? "OFFER" : "PRODUCT", sourceLock: sourceLock(product, offer), approvable: true, allowedTransformations: ["DIRECT", "JOIN_WITH_SPACE", "JOIN_WITH_PIPE", "JOIN_WITH_COLON", "JOIN_WITH_DASH"], warning: "Record an authoritative provider reference. Customer fields are configuration; executable code is never accepted." };
}
async function approve(productId, input, ctx = {}) {
    if (input.confirmed !== true) throw new SupplierInputContractReviewError("INPUT_CONTRACT_CONFIRMATION_REQUIRED", "Explicit Owner confirmation is required.");
    if (clean(ctx.actor?.role).toUpperCase() !== "OWNER") throw new SupplierInputContractReviewError("OWNER_INPUT_CONTRACT_APPROVAL_REQUIRED", "Only the Owner can approve customer information requirements.", 403);
    const session = await mongoose.startSession();
    try { return await session.withTransaction(async () => {
        const product = await Product.findById(productId).session(session);
        if (!product) throw new SupplierInputContractReviewError("SUPPLIER_CATALOG_PRODUCT_NOT_FOUND", "Supplier catalog product not found.", 404);
        const supplier = await Supplier.findById(product.supplierId).session(session).lean();
        const offer = input.offerId ? await Offer.findOne({ _id: input.offerId, supplierCatalogProductId: product._id }).session(session) : null;
        if (input.offerId && !offer) throw new SupplierInputContractReviewError("SUPPLIER_CATALOG_OFFER_NOT_FOUND", "Supplier catalog offer not found for this product.", 404);
        const protocol = protocolForSupplier(supplier?.supplierCode);
        if (!protocol) throw new SupplierInputContractReviewError("INPUT_CONTRACT_PROTOCOL_UNSUPPORTED", "This supplier protocol does not support declarative customer information contracts.", 409);
        const expected = input.sourceLock || {};
        if (clean(expected.sourceHash) !== clean(product.rawSnapshotHash) || clean(expected.sourceRevision) !== clean(product.sourceRevision) || (expected.updatedAt && new Date(expected.updatedAt).getTime() !== new Date(product.updatedAt).getTime())) throw new SupplierInputContractReviewError("INPUT_CONTRACT_SOURCE_STALE", "Supplier input evidence changed; reopen and review the latest source.", 409);
        if (offer && (clean(expected.offerId) !== clean(offer._id) || clean(expected.offerSourceHash) !== clean(offer.rawSnapshotHash))) throw new SupplierInputContractReviewError("INPUT_CONTRACT_SOURCE_STALE", "Supplier offer evidence changed; reopen and review the latest source.", 409);
        const now = new Date(), reviewer = actor(ctx.actor), before = offer?.metadata?.normalizedInputContract || product.normalizedInputContract || {}, contract = reviewedContract(product, input, reviewer, now, protocol, before);
        if (clean(before.fingerprint) && clean(before.fingerprint) === clean(contract.fingerprint) && clean(before.review?.evidenceReference) === clean(contract.review.evidenceReference)) return { contract: before, sourceLock: sourceLock(product, offer), idempotentReplay: true };
        if (Number(expected.expectedDecisionVersion||0) !== Number(before.decisionVersion||0)) throw new SupplierInputContractReviewError("INPUT_CONTRACT_VERSION_CONFLICT", "Customer information authority changed; reopen and review the latest decision.", 409);
        if (offer) { offer.metadata = { ...(offer.metadata || {}), normalizedInputContract: contract }; await offer.save({ session }); }
        else { product.normalizedInputContract = contract; product.requiredFields = contract.fields; await product.save({ session }); }
        await writeAdminAudit({ actor: ctx.actor, req: ctx.req, action: ADMIN_AUDIT_ACTIONS.SUPPLIER_INPUT_CONTRACT_APPROVED, resourceType: offer ? "SupplierCatalogOffer" : "SupplierCatalogProduct", resourceId: clean(offer?._id || productId), metadata: { authorityScope: offer ? "OFFER" : "PRODUCT", supplierProductCode: product.supplierProductCode, supplierOfferCode: offer?.supplierOfferCode || "", protocol, transactionalServiceCode: contract.transactionalServiceCode || "", decisionVersion: contract.decisionVersion, supplierMarket: product.supplierMarketCode, previousFingerprint: before.fingerprint || "", fingerprint: contract.fingerprint, sourceHash: product.rawSnapshotHash, evidenceReference: contract.review.evidenceReference, fields: contract.fields.map(x => ({ customerField: x.customerField, providerField: x.providerField, required: x.required, transformationId: x.transformationId })) }, session });
        return { contract, sourceLock: sourceLock(product, offer), idempotentReplay: false };
    }); } finally { await session.endSession(); }
}

module.exports = Object.freeze({ SupplierInputContractReviewError, context, approve, reviewedContract, sourceLock });
