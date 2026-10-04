"use strict";

const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");

async function planCatalogPackageConsolidation({ survivorId, duplicateId } = {}, models = {}) {
    const M = { Package: models.Package || CatalogPackage, Mapping: models.Mapping || SupplierProductMapping, Selection: models.Selection || PackageSupplierSelection, Publication: models.Publication || PackageMarketPublication, StoreSelection: models.StoreSelection || StoreCatalogSelection };
    const survivor = await M.Package.findById(survivorId).select("_id productCode packageCode aliases prices iconAssetId").lean();
    const duplicate = await M.Package.findById(duplicateId).select("_id productCode packageCode aliases prices iconAssetId").lean();
    if (!survivor || !duplicate || survivor.productCode !== duplicate.productCode || String(survivor._id) === String(duplicate._id)) throw Object.assign(new Error("A distinct survivor and duplicate from the same product are required."), { code: "PACKAGE_CONSOLIDATION_SCOPE_INVALID" });
    const [mappings, selections, publications, storeSelections] = await Promise.all([
        M.Mapping.find({ productCode: duplicate.productCode, packageCode: duplicate.packageCode }).select("_id supplierId supplierCode supplierProductCode supplierPackageCode region enabled productionRole archivedAt").lean(),
        M.Selection.find({ productCode: duplicate.productCode, packageCode: duplicate.packageCode }).select("_id customerMarket supplierMappingId decisionVersion").lean(),
        M.Publication.find({ productCode: duplicate.productCode, packageCode: duplicate.packageCode }).select("_id customerMarket published decisionVersion").lean(),
        M.StoreSelection.find({ productCode: duplicate.productCode, "packages.packageCode": duplicate.packageCode }).select("_id supplierId supplierMarket sellingRegions visibleRegions packages.packageCode packages.supplierProductMappingId").lean()
    ]);
    return Object.freeze({ readOnly: true, requiresExplicitAdminConfirmation: true, survivor: { id: String(survivor._id), packageCode: survivor.packageCode }, duplicate: { id: String(duplicate._id), packageCode: duplicate.packageCode }, aliasesSufficientForLookup: false, aliasCoverageState: "UNKNOWN_REFERENCE_COVERAGE", references: { SAFE_REFERENCE: { mappings, selections, publications, storeSelections }, CONFLICT: [...(survivor.prices && duplicate.prices ? ["PRICING_CONFLICT_REQUIRES_EXPLICIT_RESOLUTION"] : []), ...(survivor.iconAssetId && duplicate.iconAssetId && survivor.iconAssetId !== duplicate.iconAssetId ? ["MEDIA_CONFLICT_REQUIRES_EXPLICIT_RESOLUTION"] : [])], HISTORICAL_IMMUTABLE: ["CommerceOrder", "PricingQuote", "FulfillmentAttempt", "AdminAuditLog"], UNKNOWN_REFERENCE_COVERAGE: ["PackagePricingOverride", "PackageInventoryState", "promotion/current catalog references not proven alias-aware"] }, applyAvailable: false });
}

module.exports = Object.freeze({ planCatalogPackageConsolidation });
