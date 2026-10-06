"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const Product = require("../../models/SupplierCatalogProduct");
const Offer = require("../../models/SupplierCatalogOffer");
const Supplier = require("../../models/Supplier");
const { writeAdminAudit, ADMIN_AUDIT_ACTIONS } = require("../adminAuditService");
const { PROTOCOLS } = require("./supplierSellabilityContractCoverageService");

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const id = value => clean(value?._id || value);
const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const CUSTOMER_MARKETS = new Set(["TH", "MM"]);
const AUTHORITY_TYPES = new Set(["MARKET", "EXECUTION"]);

class SupplierBusinessAuthorityError extends Error {
    constructor(code, message, statusCode = 400) { super(message); this.name = "SupplierBusinessAuthorityError"; this.code = code; this.statusCode = statusCode; }
}

function sourceLock(product, offer, authority = {}) {
    return { productId: id(product), sourceHash: clean(product.rawSnapshotHash), sourceRevision: clean(product.sourceRevision || product.rawSnapshotHash), offerId: id(offer), offerSourceHash: clean(offer?.rawSnapshotHash), expectedDecisionVersion: Number(authority.decisionVersion || 0) };
}

function scopedAuthorityFor(product = {}, offer = null, type = "") {
    const key = upper(type) === "MARKET" ? "marketAuthority" : "executionAuthority";
    return (offer ? offer?.metadata?.businessAuthority?.[key] : product.metadata?.businessAuthority?.[key]) || null;
}

function authorityFor(product = {}, offer = null, type = "") {
    return scopedAuthorityFor(product, offer, type) || (offer ? scopedAuthorityFor(product, null, type) : null);
}

function resolvedAuthorities(product = {}, offer = null) {
    return { market: authorityFor(product, offer, "MARKET"), execution: authorityFor(product, offer, "EXECUTION") };
}

async function load(productId, offerId = "", session = null) {
    if (!mongoose.isValidObjectId(productId)) throw new SupplierBusinessAuthorityError("INVALID_PRODUCT_ID", "Invalid supplier product.");
    const bind = query => session ? query.session(session) : query;
    const product = await bind(Product.findById(productId)).lean();
    if (!product) throw new SupplierBusinessAuthorityError("SUPPLIER_CATALOG_PRODUCT_NOT_FOUND", "Supplier product was not found.", 404);
    const supplier = await bind(Supplier.findById(product.supplierId)).lean();
    if (!supplier) throw new SupplierBusinessAuthorityError("SUPPLIER_NOT_FOUND", "Supplier was not found.", 404);
    const offer = offerId ? await bind(Offer.findOne({ _id: offerId, supplierCatalogProductId: product._id })).lean() : null;
    if (offerId && !offer) throw new SupplierBusinessAuthorityError("SUPPLIER_CATALOG_OFFER_NOT_FOUND", "Supplier package was not found.", 404);
    return { product, supplier, offer };
}

async function review(productId, { offerId = "", type = "" } = {}) {
    const authorityType = upper(type);
    if (!AUTHORITY_TYPES.has(authorityType)) throw new SupplierBusinessAuthorityError("AUTHORITY_TYPE_INVALID", "Choose market or supplier execution authority.");
    const { product, supplier, offer } = await load(productId, offerId);
    const current = scopedAuthorityFor(product, offer, authorityType) || {};
    const inherited = offer ? scopedAuthorityFor(product, null, authorityType) : null;
    return {
        authorityType, authorityScope: offer ? "OFFER" : "PRODUCT", current, inherited,
        supplier: { id: id(supplier), code: upper(supplier.supplierCode), name: clean(supplier.name) },
        product: { id: id(product), namespace: upper(product.catalogNamespace), nativeCode: clean(product.supplierProductCode), name: clean(product.displayName || product.rawName), nativeMarket: upper(product.supplierMarketCode), sourceMetadata: { restrictions: product.restrictions || [], marketEvidence: product.metadata?.marketEvidence || null, executionEvidence: product.metadata?.executionEvidence || null } },
        offer: offer ? { id: id(offer), nativeCode: clean(offer.supplierOfferCode), name: clean(offer.supplierOfferName || offer.rawName) } : null,
        protocol: PROTOCOLS[upper(supplier.supplierCode)]?.family || "",
        sourceLock: sourceLock(product, offer, current),
        allowedCustomerMarkets: [...CUSTOMER_MARKETS],
        warning: "Approve only information verified in supplier metadata, documentation, dashboard, or support evidence."
    };
}

function validateLock(expected, product, offer, current) {
    if (id(expected?.productId) !== id(product) || clean(expected?.sourceHash) !== clean(product.rawSnapshotHash) || clean(expected?.sourceRevision) !== clean(product.sourceRevision || product.rawSnapshotHash) || id(expected?.offerId) !== id(offer) || clean(expected?.offerSourceHash) !== clean(offer?.rawSnapshotHash)) throw new SupplierBusinessAuthorityError("STALE_SOURCE", "Supplier information changed. Reopen and review the latest evidence.", 409);
    if (Number(expected?.expectedDecisionVersion || 0) !== Number(current?.decisionVersion || 0)) throw new SupplierBusinessAuthorityError("AUTHORITY_VERSION_CONFLICT", "This authority was changed by another Owner. Reopen it.", 409);
}

function buildAuthority(type, input, state, current, actor) {
    const evidenceDescription = clean(input.evidenceDescription);
    if (!evidenceDescription) throw new SupplierBusinessAuthorityError("AUTHORITY_EVIDENCE_REQUIRED", "Describe the authoritative supplier evidence.");
    const common = { authorityType: type, scope: state.offer ? "OFFER" : "PRODUCT", supplierId: id(state.supplier), supplierCode: upper(state.supplier.supplierCode), supplierCatalogProductId: id(state.product), supplierCatalogOfferId: id(state.offer), catalogNamespace: upper(state.product.catalogNamespace), supplierProductCode: clean(state.product.supplierProductCode), supplierOfferCode: clean(state.offer?.supplierOfferCode), protocol: PROTOCOLS[upper(state.supplier.supplierCode)]?.family || "", evidenceDescription, sourceHash: clean(state.product.rawSnapshotHash), sourceRevision: clean(state.product.sourceRevision || state.product.rawSnapshotHash), offerSourceHash: clean(state.offer?.rawSnapshotHash), decisionVersion: Number(current?.decisionVersion || 0) + 1, approvedBy: { adminId: id(actor), username: clean(actor?.username), role: upper(actor?.role) }, approvedAt: new Date() };
    if (type === "MARKET") {
        const nativeMarketEvidence = upper(input.nativeMarketEvidence);
        const allowedCustomerMarkets = [...new Set((input.allowedCustomerMarkets || []).map(upper).filter(value => CUSTOMER_MARKETS.has(value)))].sort();
        if (!nativeMarketEvidence || ["UNKNOWN", "UNSPECIFIED"].includes(nativeMarketEvidence) || !allowedCustomerMarkets.length) throw new SupplierBusinessAuthorityError("MARKET_AUTHORITY_INCOMPLETE", "Record exact supplier market evidence and at least one verified customer market.");
        return { ...common, nativeMarketEvidence, fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets, evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: evidenceDescription, verifiedAt: common.approvedAt, version: common.decisionVersion } };
    }
    const fields = input.executionIdentity && typeof input.executionIdentity === "object" && !Array.isArray(input.executionIdentity) ? Object.fromEntries(Object.entries(input.executionIdentity).map(([key, value]) => [clean(key), clean(value)]).filter(([key, value]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && /^[A-Za-z0-9_.:-]{1,160}$/.test(value))) : {};
    if (!Object.keys(fields).length) throw new SupplierBusinessAuthorityError("EXECUTION_IDENTITY_INCOMPLETE", "Record at least one exact supplier execution identity field.");
    return { ...common, executionIdentity: fields };
}

function exactReplay(type, input, current = {}, product, offer) {
    if (!current.fingerprint || clean(current.sourceHash) !== clean(product.rawSnapshotHash) || clean(current.sourceRevision) !== clean(product.sourceRevision || product.rawSnapshotHash) || clean(current.offerSourceHash) !== clean(offer?.rawSnapshotHash) || clean(current.evidenceDescription) !== clean(input.evidenceDescription)) return false;
    if (type === "MARKET") return upper(current.nativeMarketEvidence) === upper(input.nativeMarketEvidence) && JSON.stringify(current.fulfillmentEligibility?.allowedCustomerMarkets || []) === JSON.stringify([...new Set((input.allowedCustomerMarkets || []).map(upper).filter(value => CUSTOMER_MARKETS.has(value)))].sort());
    const requested = input.executionIdentity && typeof input.executionIdentity === "object" ? Object.fromEntries(Object.entries(input.executionIdentity).map(([key, value]) => [clean(key), clean(value)]).filter(([key, value]) => key && value)) : {};
    return JSON.stringify(current.executionIdentity || {}) === JSON.stringify(requested);
}

async function approve(productId, input = {}, context = {}) {
    const type = upper(input.type);
    if (!AUTHORITY_TYPES.has(type)) throw new SupplierBusinessAuthorityError("AUTHORITY_TYPE_INVALID", "Choose market or supplier execution authority.");
    if (input.confirmed !== true) throw new SupplierBusinessAuthorityError("AUTHORITY_CONFIRMATION_REQUIRED", "Explicit Owner confirmation is required.");
    if (upper(context.actor?.role) !== "OWNER") throw new SupplierBusinessAuthorityError("OWNER_REQUIRED", "Only the Owner can approve supplier authority.", 403);
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            const state = await load(productId, clean(input.offerId), session);
            const current = scopedAuthorityFor(state.product, state.offer, type) || {};
            if (exactReplay(type, input, current, state.product, state.offer)) { result = { authority: current, sourceLock: sourceLock(state.product, state.offer, current), idempotentReplay: true }; return; }
            validateLock(input.sourceLock || {}, state.product, state.offer, current);
            const authority = buildAuthority(type, input, state, current, context.actor);
            authority.fingerprint = sha({ ...authority, approvedAt: undefined, approvedBy: undefined });
            if (clean(current.fingerprint) === authority.fingerprint) { result = { authority: current, sourceLock: sourceLock(state.product, state.offer, current), idempotentReplay: true }; return; }
            const key = type === "MARKET" ? "marketAuthority" : "executionAuthority";
            const Model = state.offer ? Offer : Product;
            const targetId = state.offer?._id || state.product._id;
            const versionPath = `metadata.businessAuthority.${key}.decisionVersion`;
            const filter = { _id: targetId, ...(state.offer ? { rawSnapshotHash: state.offer.rawSnapshotHash } : { rawSnapshotHash: state.product.rawSnapshotHash }), $or: [{ [versionPath]: Number(current.decisionVersion || 0) }, ...(Number(current.decisionVersion || 0) === 0 ? [{ [versionPath]: { $exists: false } }] : [])] };
            const updated = await Model.updateOne(filter, { $set: { [`metadata.businessAuthority.${key}`]: authority } }, { session, runValidators: true });
            if (Number(updated.modifiedCount ?? updated.nModified ?? 0) !== 1) throw new SupplierBusinessAuthorityError("AUTHORITY_VERSION_CONFLICT", "This authority changed concurrently. Reopen it.", 409);
            await writeAdminAudit({ actor: context.actor, req: context.req, action: type === "MARKET" ? ADMIN_AUDIT_ACTIONS.SUPPLIER_MARKET_AUTHORITY_APPROVED : ADMIN_AUDIT_ACTIONS.SUPPLIER_EXECUTION_AUTHORITY_APPROVED, resourceType: state.offer ? "SupplierCatalogOffer" : "SupplierCatalogProduct", resourceId: id(targetId), metadata: { authorityScope: state.offer ? "OFFER" : "PRODUCT", supplierId: id(state.supplier), supplierCode: upper(state.supplier.supplierCode), catalogNamespace: state.product.catalogNamespace, supplierProductCode: state.product.supplierProductCode, supplierOfferCode: state.offer?.supplierOfferCode || "", decisionVersion: authority.decisionVersion, sourceHash: state.product.rawSnapshotHash, evidenceDescription: authority.evidenceDescription, nativeMarketEvidence: authority.nativeMarketEvidence || "", allowedCustomerMarkets: authority.fulfillmentEligibility?.allowedCustomerMarkets || [], executionIdentityFields: Object.keys(authority.executionIdentity || {}).sort() }, session });
            result = { authority, sourceLock: sourceLock(state.product, state.offer, authority), idempotentReplay: false };
        });
        return result;
    } catch (error) {
        if (error instanceof SupplierBusinessAuthorityError) throw error;
        const retryableConflict = [112, 251].includes(Number(error?.code)) || error?.hasErrorLabel?.("TransientTransactionError") === true || error?.hasErrorLabel?.("UnknownTransactionCommitResult") === true;
        if (!retryableConflict) throw error;
        const committed = await load(productId, clean(input.offerId));
        const current = scopedAuthorityFor(committed.product, committed.offer, type) || {};
        if (exactReplay(type, input, current, committed.product, committed.offer)) return { authority: current, sourceLock: sourceLock(committed.product, committed.offer, current), idempotentReplay: true, concurrentReplay: true };
        throw new SupplierBusinessAuthorityError("AUTHORITY_VERSION_CONFLICT", "This authority changed concurrently. Reopen it.", 409);
    } finally { await session.endSession(); }
}

module.exports = Object.freeze({ SupplierBusinessAuthorityError, scopedAuthorityFor, authorityFor, resolvedAuthorities, sourceLock, review, approve });
