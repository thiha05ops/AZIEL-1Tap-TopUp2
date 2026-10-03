"use strict";

const mongoose = require("mongoose");
const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const Supplier = require("../models/Supplier");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("./adminAuditService");
const { candidateBlockers, costProjection, normalizeCustomerMarket } = require("./packageSupplierCandidateService");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");

class PackageSupplierSelectionError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = "PackageSupplierSelectionError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();
const objectId = value => clean(value?._id || value);

function projectSelection(selection) {
    if (!selection) return null;
    return {
        productCode: lower(selection.productCode),
        packageCode: upper(selection.packageCode),
        customerMarket: upper(selection.customerMarket),
        supplierMappingId: objectId(selection.supplierMappingId),
        decisionVersion: Number(selection.decisionVersion),
        selectedAt: selection.selectedAt,
        selectedBy: clean(selection.selectedByUsernameSnapshot)
    };
}

function marginAssessment(pkg = {}, customerMarket = "", cost = {}) {
    const price = pkg.prices?.[customerMarket];
    const customerPrice = Number(price?.amount);
    const customerCurrency = upper(price?.currency || (customerMarket === "MM" ? "MMK" : "THB"));
    const supplierCost = Number(cost.amount);
    const supplierCurrency = upper(cost.currency);
    if (!price || price.enabled === false || !Number.isFinite(customerPrice) || customerPrice <= 0 || !Number.isFinite(supplierCost) || supplierCost < 0) {
        return { state: "UNAVAILABLE", customerPrice: Number.isFinite(customerPrice) ? customerPrice : null, currency: customerCurrency, supplierCost: Number.isFinite(supplierCost) ? supplierCost : null, supplierCurrency, estimatedMarginAmount: null, estimatedMarginPercent: null };
    }
    let comparableCost = null;
    let evidence = "";
    if (supplierCurrency === customerCurrency) {
        comparableCost = supplierCost;
        evidence = "SAME_CURRENCY_SUPPLIER_COST";
    } else {
        const fxRate = Number(price.fxRate);
        const fxExpiresAt = price.fxRateExpiresAt ? new Date(price.fxRateExpiresAt).getTime() : null;
        const fxCurrent = !fxExpiresAt || fxExpiresAt > Date.now();
        if (upper(price.rawSupplierCurrency || price.supplierCurrency) === supplierCurrency && Number.isFinite(fxRate) && fxRate > 0 && fxCurrent) {
            comparableCost = supplierCost * fxRate;
            evidence = "CURRENT_PUBLISHED_FX_RATE";
        }
    }
    if (!Number.isFinite(comparableCost)) {
        return { state: "UNKNOWN", customerPrice, currency: customerCurrency, supplierCost, supplierCurrency, estimatedMarginAmount: null, estimatedMarginPercent: null, evidence: "NO_COMPARABLE_COST_AUTHORITY" };
    }
    const marginAmount = customerPrice - comparableCost;
    const marginPercent = customerPrice > 0 ? (marginAmount / customerPrice) * 100 : null;
    return {
        state: marginAmount < 0 ? "BELOW_COST" : "HEALTHY",
        customerPrice,
        currency: customerCurrency,
        supplierCost,
        supplierCurrency,
        comparableCost: Number(comparableCost.toFixed(6)),
        estimatedMarginAmount: Number(marginAmount.toFixed(6)),
        estimatedMarginPercent: Number(marginPercent.toFixed(2)),
        evidence
    };
}

function stableSelectionError(blockers = []) {
    if (blockers.includes("CUSTOMER_MARKET_NOT_ELIGIBLE")) return new PackageSupplierSelectionError("CUSTOMER_MARKET_NOT_ELIGIBLE", "Supplier mapping is not eligible for this customer market.", 409, { blockerCodes: blockers });
    if (blockers.includes("SUPPLIER_AVAILABILITY_NOT_CONFIRMED") || blockers.includes("SUPPLIER_OFFER_NOT_ACTIVE")) return new PackageSupplierSelectionError("SUPPLIER_NOT_AVAILABLE", "Supplier offer is not currently available.", 409, { blockerCodes: blockers });
    return new PackageSupplierSelectionError("SUPPLIER_MAPPING_NOT_READY", "Supplier mapping is not ready for selection.", 409, { blockerCodes: blockers });
}

function createPackageSupplierSelectionService(models = {}, dependencies = {}) {
    const M = {
        Product: models.Product || CatalogProduct,
        Package: models.Package || CatalogPackage,
        Selection: models.Selection || PackageSupplierSelection,
        Mapping: models.Mapping || SupplierProductMapping,
        Supplier: models.Supplier || Supplier,
        Offer: models.Offer || SupplierCatalogOffer,
        Availability: models.Availability || SupplierOfferAvailability
    };
    const adapterFor = dependencies.getSupplierAdapter || getSupplierAdapter;
    const audit = dependencies.writeAdminAudit || writeAdminAudit;
    const transaction = dependencies.transaction || (async callback => {
        const session = await mongoose.startSession();
        try {
            let result;
            await session.withTransaction(async () => { result = await callback(session); });
            return result;
        } finally {
            await session.endSession();
        }
    });
    const lean = (query, session) => (session && query.session ? query.session(session) : query).lean();

    return async function setPackageSupplierSelection(input = {}, context = {}) {
        const productCode = lower(input.productCode);
        const packageCode = upper(input.packageCode);
        const customerMarket = normalizeCustomerMarket(input.customerMarket);
        const supplierMappingId = clean(input.supplierMappingId);
        const reason = clean(input.reason).slice(0, 500);
        if (!productCode || !packageCode) throw new PackageSupplierSelectionError("PACKAGE_IDENTITY_REQUIRED", "Product and package are required.");
        if (!mongoose.Types.ObjectId.isValid(supplierMappingId)) throw new PackageSupplierSelectionError("SUPPLIER_MAPPING_NOT_FOUND", "Supplier mapping not found.", 404);

        return transaction(async session => {
            const [product, pkg, mapping, current] = await Promise.all([
                lean(M.Product.findOne({ productCode, deletedAt: null }), session),
                lean(M.Package.findOne({ productCode, packageCode, deletedAt: null }), session),
                lean(M.Mapping.findById(supplierMappingId), session),
                lean(M.Selection.findOne({ productCode, packageCode, customerMarket }), session)
            ]);
            if (!product) throw new PackageSupplierSelectionError("PRODUCT_NOT_FOUND", "Product not found.", 404);
            if (!pkg) throw new PackageSupplierSelectionError("PACKAGE_NOT_FOUND", "Package not found.", 404);
            if (!mapping) throw new PackageSupplierSelectionError("SUPPLIER_MAPPING_NOT_FOUND", "Supplier mapping not found.", 404);
            if (lower(mapping.productCode) !== productCode || upper(mapping.packageCode) !== packageCode) throw new PackageSupplierSelectionError("SUPPLIER_MAPPING_SCOPE_MISMATCH", "Supplier mapping does not belong to this package.", 409);

            const expected = input.expectedDecisionVersion;
            if (current) {
                if (!Number.isInteger(Number(expected)) || Number(expected) !== Number(current.decisionVersion)) throw new PackageSupplierSelectionError("PACKAGE_SUPPLIER_SELECTION_STALE", "Supplier selection changed elsewhere.", 409, { currentDecisionVersion: Number(current.decisionVersion) });
            } else if (!(expected == null || expected === "" || Number(expected) === 0)) {
                throw new PackageSupplierSelectionError("PACKAGE_SUPPLIER_SELECTION_STALE", "Supplier selection was created elsewhere.", 409, { currentDecisionVersion: null });
            }

            const supplier = await lean(M.Supplier.findById(mapping.supplierId), session);
            if (!supplier) throw new PackageSupplierSelectionError("SUPPLIER_NOT_AVAILABLE", "Supplier not found.", 409);
            if (supplier.enabled !== true) throw new PackageSupplierSelectionError("SUPPLIER_DISABLED", "Supplier is disabled.", 409);
            const [offer, availability] = await Promise.all([
                mapping.supplierCatalogOfferId ? lean(M.Offer.findById(mapping.supplierCatalogOfferId), session) : null,
                mapping.supplierCatalogOfferId ? lean(M.Availability.findOne({ supplierCatalogOfferId: mapping.supplierCatalogOfferId }), session) : null
            ]);
            const blockers = candidateBlockers({ mapping, supplier, offer, availability, customerMarket, adapter: adapterFor(supplier) });
            if (blockers.length) throw stableSelectionError(blockers);
            const proposedCost = costProjection(mapping, offer);
            const assessment = marginAssessment(pkg, customerMarket, proposedCost);
            const previousSelection = projectSelection(current);
            // The routing decision is the mapping identity. A reason-only edit is
            // intentionally idempotent: it neither rewrites history nor bumps version.
            if (current && objectId(current.supplierMappingId) === objectId(mapping)) {
                return { changed: false, selection: previousSelection, previousSelection, customerPriceChanged: false, publicationChanged: false, marginAssessment: assessment };
            }

            const actor = context.actor || {};
            const now = new Date();
            const nextVersion = Number(current?.decisionVersion || 0) + 1;
            const update = {
                supplierMappingId: mapping._id,
                selectedByAdminId: actor.id || actor.adminId || actor._id || null,
                selectedByUsernameSnapshot: clean(actor.username || "owner"),
                selectedAt: now,
                decisionVersion: nextVersion,
                reason
            };
            let saved;
            if (current) {
                saved = await M.Selection.findOneAndUpdate(
                    { _id: current._id, decisionVersion: current.decisionVersion },
                    { $set: update },
                    { new: true, runValidators: true, session }
                ).lean();
                if (!saved) throw new PackageSupplierSelectionError("PACKAGE_SUPPLIER_SELECTION_STALE", "Supplier selection changed elsewhere.", 409);
            } else {
                try {
                    saved = (await M.Selection.create([{ productCode, packageCode, customerMarket, ...update }], { session }))[0].toObject();
                } catch (error) {
                    if (error?.code === 11000) throw new PackageSupplierSelectionError("PACKAGE_SUPPLIER_SELECTION_STALE", "Supplier selection was created elsewhere.", 409);
                    throw error;
                }
            }

            let oldMapping = null;
            if (current?.supplierMappingId) oldMapping = await lean(M.Mapping.findById(current.supplierMappingId), session);
            await audit({
                actor,
                req: context.req || null,
                action: current ? ADMIN_AUDIT_ACTIONS.PACKAGE_SUPPLIER_SELECTION_CHANGED : ADMIN_AUDIT_ACTIONS.PACKAGE_SUPPLIER_SELECTION_CREATED,
                resourceType: "PackageSupplierSelection",
                resourceId: `${productCode}/${packageCode}/${customerMarket}`,
                session,
                metadata: {
                    productCode, packageCode, customerMarket,
                    oldSupplierMappingId: objectId(current?.supplierMappingId),
                    newSupplierMappingId: objectId(mapping),
                    oldSupplierId: objectId(oldMapping?.supplierId),
                    newSupplierId: objectId(mapping.supplierId),
                    oldSupplierCode: upper(oldMapping?.supplierCode),
                    newSupplierCode: upper(mapping.supplierCode || supplier.supplierCode),
                    oldSupplierMarket: upper(oldMapping?.region),
                    newSupplierMarket: upper(mapping.region),
                    reason,
                    previousDecisionVersion: current ? Number(current.decisionVersion) : null,
                    decisionVersion: nextVersion,
                    customerPriceChanged: false,
                    publicationChanged: false
                }
            });
            return { changed: true, selection: projectSelection(saved), previousSelection, customerPriceChanged: false, publicationChanged: false, marginAssessment: assessment };
        });
    };
}

const setPackageSupplierSelection = createPackageSupplierSelectionService();

module.exports = { PackageSupplierSelectionError, createPackageSupplierSelectionService, marginAssessment, projectSelection, setPackageSupplierSelection };
