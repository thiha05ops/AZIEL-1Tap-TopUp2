"use strict";

const Models = {
    SupplierCatalogProduct: require("../models/SupplierCatalogProduct"), SupplierCatalogOffer: require("../models/SupplierCatalogOffer"),
    Mapping: require("../models/SupplierProductMapping"), Package: require("../models/CatalogPackage"), Publication: require("../models/PackageMarketPublication"),
    Selection: require("../models/PackageSupplierSelection")
};
const clean = value => String(value?._id || value || "").trim();
const key = value => `${String(value.productCode || "").toLowerCase()}|${String(value.packageCode || "").toUpperCase()}`;

function buildSupplierLifecycleAudit({ products = [], offers = [], mappings = [], packages = [], publications = [], selections = [] } = {}) {
    const mappedOfferIds = new Set(mappings.map(row => clean(row.supplierCatalogOfferId)).filter(Boolean));
    const mappedProductIds = new Set(offers.filter(row => mappedOfferIds.has(clean(row))).map(row => clean(row.supplierCatalogProductId)));
    const mappingsByPackage = new Map();
    for (const mapping of mappings) { const rows = mappingsByPackage.get(key(mapping)) || []; rows.push(mapping); mappingsByPackage.set(key(mapping), rows); }
    const selectionByIdentity = new Map(selections.map(row => [`${key(row)}|${String(row.customerMarket).toUpperCase()}`, row]));
    const publicRows = publications.filter(row => row.published === true).map(publication => {
        const rows = mappingsByPackage.get(key(publication)) || [];
        const usable = rows.filter(row => row.enabled === true && !row.archivedAt && row.mappingMetadata?.readiness?.supplierMapped === true && row.mappingMetadata?.readiness?.inputReady === true && row.mappingMetadata?.readiness?.fulfillmentReady === true);
        return { productCode: publication.productCode, packageCode: publication.packageCode, customerMarket: publication.customerMarket, usableMappingCount: usable.length };
    });
    const duplicateGroups = [...packages.reduce((map, pkg) => { const signature = `${String(pkg.productCode).toLowerCase()}|${String(pkg.name).trim().toLowerCase()}`; const rows = map.get(signature) || []; rows.push(pkg); map.set(signature, rows); return map; }, new Map()).values()].filter(rows => rows.length > 1).map(rows => rows.map(row => ({ id: clean(row), productCode: row.productCode, packageCode: row.packageCode, name: row.name })));
    return Object.freeze({
        readOnly: true,
        supplierProductsWithZeroMappings: products.filter(row => !mappedProductIds.has(clean(row))).map(row => ({ id: clean(row), supplierProductCode: row.supplierProductCode, displayName: row.displayName })),
        supplierOffersWithZeroMappings: offers.filter(row => !mappedOfferIds.has(clean(row))).map(row => ({ id: clean(row), supplierOfferCode: row.supplierOfferCode, reconciliationState: row.reconciliationState })),
        unresolvedReconciliation: offers.filter(row => !mappedOfferIds.has(clean(row)) && !["INTENTIONALLY_UNSUPPORTED"].includes(row.reconciliationState)),
        packagesWithMultipleMappings: [...mappingsByPackage.entries()].filter(([, rows]) => rows.length > 1).map(([packageIdentity, rows]) => ({ packageIdentity, mappingIds: rows.map(clean) })),
        blockedMappings: mappings.filter(row => row.enabled !== true || row.archivedAt || row.mappingMetadata?.readiness?.supplierMapped !== true || row.mappingMetadata?.readiness?.inputReady !== true || row.mappingMetadata?.readiness?.fulfillmentReady !== true).map(row => ({ mappingId: clean(row), productCode: row.productCode, packageCode: row.packageCode })),
        publicPackages: { zero: publicRows.filter(row => row.usableMappingCount === 0), one: publicRows.filter(row => row.usableMappingCount === 1), multiple: publicRows.filter(row => row.usableMappingCount > 1) },
        selectionCoverage: ["TH", "MM"].map(customerMarket => ({ customerMarket, selected: selections.filter(row => row.customerMarket === customerMarket).length, publicMissingSelection: publicRows.filter(row => row.customerMarket === customerMarket && !selectionByIdentity.has(`${key(row)}|${customerMarket}`)) })),
        selectedMappingsNoLongerReady: selections.filter(selection => { const mapping = mappings.find(row => clean(row) === clean(selection.supplierMappingId)); return !mapping || mapping.enabled !== true || Boolean(mapping.archivedAt) || mapping.mappingMetadata?.readiness?.fulfillmentReady !== true; }),
        pricingVsFulfillment: selections.map(selection => { const pkg = packages.find(row => key(row) === key(selection)); const mapping = mappings.find(row => clean(row) === clean(selection.supplierMappingId)); const price = pkg?.prices?.[selection.customerMarket] || {}; return { ...selection, pricingSupplierCode: price.supplierCode || "", fulfillmentSupplierCode: mapping?.supplierCode || "", differs: Boolean(price.supplierCode && mapping?.supplierCode && price.supplierCode !== mapping.supplierCode) }; }),
        likelyDuplicateCanonicalPackages: duplicateGroups,
        ambiguousEquivalenceCandidates: offers.filter(row => ["AMBIGUOUS", "SEMANTIC_REVIEW_REQUIRED", "NO_CANONICAL_PACKAGE"].includes(row.reconciliationState)),
        automaticMutation: false
    });
}

async function auditSupplierLifecycle(models = Models) {
    const [products, offers, mappings, packages, publications, selections] = await Promise.all([
        models.SupplierCatalogProduct.find().lean(), models.SupplierCatalogOffer.find().lean(), models.Mapping.find().lean(),
        models.Package.find({ deletedAt: null }).lean(), models.Publication.find().lean(), models.Selection.find().lean()
    ]);
    return buildSupplierLifecycleAudit({ products, offers, mappings, packages, publications, selections });
}

module.exports = Object.freeze({ auditSupplierLifecycle, buildSupplierLifecycleAudit });
