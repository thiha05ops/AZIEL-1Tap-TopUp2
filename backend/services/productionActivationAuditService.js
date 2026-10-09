"use strict";

const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const { READINESS_MODES, assessMappingReadiness } = require("./supplierMappingReadinessService");
const { assessProductionMappingFromContext, selectedRouteSnapshot } = require("./supplierProductionSelectionService");
const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const id = value => clean(value?._id || value);
const routeKey = (p, k, m) => `${clean(p).toLowerCase()}:${upper(k)}:${upper(m)}`;
const packageKey = (p, k) => `${clean(p).toLowerCase()}:${upper(k)}`;

function groupEnabledPackages(packages) {
    const packagesByProduct = new Map();
    for (const pkg of packages.filter(row => row.enabled === true)) {
        packagesByProduct.set(pkg.productCode, [...(packagesByProduct.get(pkg.productCode) || []), pkg]);
    }
    return packagesByProduct;
}

function indexAuthorities({ mappings, suppliers, offers, availabilityRows, packages, selections, successfulAttempts }) {
    const supplierById = new Map(suppliers.map(row => [id(row), row]));
    const offerById = new Map(offers.map(row => [id(row), row]));
    const availabilityByOffer = new Map(availabilityRows.map(row => [id(row.supplierCatalogOfferId), row]));
    const packageByKey = new Map(packages.map(row => [packageKey(row.productCode, row.packageCode), row]));
    const selectionByRoute = new Map(selections.map(row => [routeKey(row.productCode, row.packageCode, row.customerMarket), row]));
    const mappingsByPackage = new Map();
    const mappingById = new Map();
    for (const mapping of mappings) {
        mappingById.set(id(mapping), mapping);
        const key = packageKey(mapping.productCode, mapping.packageCode);
        mappingsByPackage.set(key, [...(mappingsByPackage.get(key) || []), mapping]);
    }
    return { supplierById, offerById, availabilityByOffer, packageByKey, selectionByRoute, mappingsByPackage, mappingById, successfulAttemptIds: new Set(successfulAttempts.map(row => id(row.supplierMappingId))) };
}

function assessRouteFromContext({ productCode, packageCode, region }, context) {
    const customerMarket = upper(region);
    const normalizedProduct = clean(productCode).toLowerCase();
    const normalizedPackage = upper(packageCode);
    const selection = context.selectionByRoute.get(routeKey(normalizedProduct, normalizedPackage, customerMarket)) || null;
    let candidates;
    let resolution;
    if (selection) {
        const mapping = context.mappingById.get(id(selection.supplierMappingId));
        if (!mapping || clean(mapping.productCode).toLowerCase() !== normalizedProduct || upper(mapping.packageCode) !== normalizedPackage) return { ready: false, blockers: ["SELECTED_MAPPING_INVALID"], routeSnapshot: null, resolution: "OWNER_SELECTION" };
        candidates = [mapping];
        resolution = "OWNER_SELECTION";
    } else {
        candidates = (context.mappingsByPackage.get(packageKey(normalizedProduct, normalizedPackage)) || []).filter(row => !row.archivedAt);
        resolution = "UNIQUE_EXECUTABLE_ROUTE";
    }
    if (!candidates.length) return { ready: false, blockers: ["NO_EXECUTABLE_SUPPLIER_ROUTE"], routeSnapshot: null, resolution: "NONE" };
    const assessed = candidates.map(mapping => {
        const supplier = context.supplierById.get(id(mapping.supplierId)) || null;
        return { mapping, assessment: assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping, supplier, offer: context.offerById.get(id(mapping.supplierCatalogOfferId)) || null, availability: context.availabilityByOffer.get(id(mapping.supplierCatalogOfferId)) || null, customerMarket, adapter: supplier ? getSupplierAdapter(supplier) : null }) };
    });
    const ready = assessed.filter(row => row.assessment.ready);
    if (selection && ready.length !== 1) return { ready: false, blockers: assessed[0].assessment.blockers, routeSnapshot: null, resolution };
    if (!selection && ready.length > 1) return { ready: false, blockers: ["AMBIGUOUS_EXECUTABLE_SUPPLIER_ROUTES"], routeSnapshot: null, resolution: "AMBIGUOUS" };
    if (ready.length !== 1) return { ready: false, blockers: [...new Set(assessed.flatMap(row => row.assessment.blockers))], routeSnapshot: null, resolution: "BLOCKED" };
    return { ready: true, blockers: [], routeSnapshot: selectedRouteSnapshot(ready[0].mapping, selection, customerMarket, resolution), resolution };
}

function auditProductionActivation({ mappings, suppliers, offers, availabilityRows, packages, selections, successfulAttempts, catalog }) {
    const context = indexAuthorities({ mappings, suppliers, offers, availabilityRows, packages, selections, successfulAttempts });
    const violations = [];
    const groups = new Map();
    for (const mapping of mappings) {
        const key = routeKey(mapping.productCode, mapping.packageCode, mapping.region);
        groups.set(key, [...(groups.get(key) || []), mapping]);
    }
    for (const [key, rows] of groups) {
        const primary = rows.filter(row => row.productionRole === "PRIMARY");
        if (primary.length > 1) violations.push({ key, code: "MULTIPLE_PRIMARY" });
        for (const mapping of primary) {
            const assessment = assessProductionMappingFromContext(mapping, { supplier: context.supplierById.get(id(mapping.supplierId)) || null, pkg: context.packageByKey.get(packageKey(mapping.productCode, mapping.packageCode)) || null, controlledTest: context.successfulAttemptIds.has(id(mapping)) ? { _id: true } : null });
            const blockers = [...assessment.blockers];
            if (mapping.archivedAt) blockers.push("ORPHAN_OR_ARCHIVED_PRIMARY");
            if (blockers.length) violations.push({ key, mappingId: id(mapping), supplier: mapping.supplierCode, blockers: [...new Set(blockers)] });
        }
    }
    for (const mapping of mappings.filter(row => row.archivedAt && (row.enabled || row.productionRole !== "DISABLED"))) violations.push({ mappingId: id(mapping), code: "ARCHIVED_MAPPING_ROUTABLE" });
    const sensitiveKeys = /supplierCost|landedCost|rawSupplier|providerOffer|supplierPackage|costAuthority|supplierProduct/i;
    const leaked = [];
    function scan(value, trail = "catalog") { if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) sensitiveKeys.test(key) ? leaked.push(`${trail}.${key}`) : scan(child, `${trail}.${key}`); }
    scan(catalog);
    if (leaked.length) violations.push({ code: "SUPPLIER_COST_PUBLIC_LEAKAGE", fields: leaked.slice(0, 20) });
    const publicPackages = catalog.flatMap(product => (product.packages || []).map(pkg => ({ productCode: product.productCode, packageCode: pkg.packageCode, regions: Object.keys(pkg.prices || {}) })));
    for (const pkg of publicPackages) for (const region of pkg.regions) {
        const route = assessRouteFromContext({ ...pkg, region }, context);
        if (!route.ready || !route.routeSnapshot) violations.push({ key: routeKey(pkg.productCode, pkg.packageCode, region), code: "PUBLIC_CHECKOUT_ROUTE_MISSING", blockers: route.blockers });
    }
    return { result: violations.length ? "FAIL" : "PASS", mappings: mappings.length, primaryMappings: mappings.filter(row => row.productionRole === "PRIMARY").length, archivedMappings: mappings.filter(row => row.archivedAt).length, publicProducts: catalog.length, publicPackages: publicPackages.length, violations };
}

module.exports = { auditProductionActivation, assessRouteFromContext, groupEnabledPackages, indexAuthorities };
