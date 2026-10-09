"use strict";

const { setPackageSupplierSelection } = require("./packageSupplierSelectionService");
const { getProductPackageSupplierOverview, normalizeCustomerMarket } = require("./packageSupplierCandidateService");

class BulkPackageSupplierSelectionError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "BulkPackageSupplierSelectionError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();
const objectId = value => clean(value?._id || value);

function createBulkPackageSupplierSelectionService(dependencies = {}) {
    const loadOverview = dependencies.getProductPackageSupplierOverview || getProductPackageSupplierOverview;
    const selectPackage = dependencies.setPackageSupplierSelection || setPackageSupplierSelection;

    return async function setBulkPackageSupplierSelection(input = {}, context = {}) {
        const productCode = lower(input.productCode);
        const customerMarket = normalizeCustomerMarket(input.customerMarket);
        const supplierId = objectId(input.supplierId);
        const reason = clean(input.reason).slice(0, 500);
        const requested = Array.isArray(input.packages) ? input.packages : [];
        if (!productCode || !supplierId) throw new BulkPackageSupplierSelectionError("BULK_SELECTION_SCOPE_REQUIRED", "Product and supplier are required.");
        if (!requested.length || requested.length > 200) throw new BulkPackageSupplierSelectionError("BULK_SELECTION_SIZE_INVALID", "Select between 1 and 200 packages.");
        const seen = new Set();
        const packages = requested.map(item => ({ packageCode: upper(item?.packageCode), expectedDecisionVersion: item?.expectedDecisionVersion ?? null })).filter(item => item.packageCode && !seen.has(item.packageCode) && seen.add(item.packageCode));
        if (!packages.length) throw new BulkPackageSupplierSelectionError("BULK_SELECTION_PACKAGES_REQUIRED", "At least one valid package is required.");

        const overview = await loadOverview({ productCode, customerMarket });
        const packageByCode = new Map((overview.packages || []).map(item => [upper(item.package?.packageCode), item]));
        const results = [];

        // Each package uses the accepted single-package authority and its own
        // transaction. Sequential execution avoids same-session parallel work
        // while allowing independent package decisions to succeed safely.
        for (const request of packages) {
            const state = packageByCode.get(request.packageCode);
            if (!state) {
                results.push({ packageCode: request.packageCode, status: "BLOCKED", code: "PACKAGE_NOT_FOUND", blockerCodes: ["PACKAGE_NOT_FOUND"] });
                continue;
            }
            const sameSupplier = (state.candidates || []).filter(candidate => objectId(candidate.supplier?.supplierId) === supplierId);
            const eligible = sameSupplier.filter(candidate => candidate.readiness?.selectable === true);
            if (eligible.length !== 1) {
                const blockerCodes = eligible.length > 1
                    ? ["AMBIGUOUS_SUPPLIER_MAPPING_IDENTITY"]
                    : sameSupplier.length
                        ? [...new Set(sameSupplier.flatMap(candidate => candidate.readiness?.blockerCodes || ["SUPPLIER_MAPPING_NOT_READY"]))]
                        : ["NO_EXACT_SUPPLIER_MAPPING"];
                results.push({ packageCode: request.packageCode, status: "BLOCKED", code: blockerCodes[0], blockerCodes });
                continue;
            }
            const candidate = eligible[0];
            try {
                const selected = await selectPackage({
                    productCode,
                    packageCode: request.packageCode,
                    customerMarket,
                    supplierMappingId: candidate.supplierMappingId,
                    expectedDecisionVersion: request.expectedDecisionVersion,
                    reason
                }, context);
                results.push({
                    packageCode: request.packageCode,
                    supplierMappingId: candidate.supplierMappingId,
                    status: selected.changed ? "ASSIGNED" : "UNCHANGED",
                    selection: selected.selection,
                    previousSelection: selected.previousSelection,
                    customerPriceChanged: false,
                    publicationChanged: false
                });
            } catch (error) {
                const conflict = error?.code === "PACKAGE_SUPPLIER_SELECTION_STALE";
                results.push({
                    packageCode: request.packageCode,
                    supplierMappingId: candidate.supplierMappingId,
                    status: conflict ? "CONFLICTED" : "BLOCKED",
                    code: error?.code || "PACKAGE_SUPPLIER_SELECTION_FAILED",
                    blockerCodes: error?.details?.blockerCodes || [error?.code || "PACKAGE_SUPPLIER_SELECTION_FAILED"]
                });
            }
        }

        const count = status => results.filter(item => item.status === status).length;
        return {
            productCode,
            customerMarket,
            supplierId,
            results,
            summary: {
                selected: packages.length,
                assigned: count("ASSIGNED"),
                unchanged: count("UNCHANGED"),
                conflicted: count("CONFLICTED"),
                blocked: count("BLOCKED")
            },
            commercialSideEffects: { customerPricesChanged: 0, publicationsChanged: 0, supplierMappingsChanged: 0 }
        };
    };
}

const setBulkPackageSupplierSelection = createBulkPackageSupplierSelectionService();

module.exports = { BulkPackageSupplierSelectionError, createBulkPackageSupplierSelectionService, setBulkPackageSupplierSelection };
