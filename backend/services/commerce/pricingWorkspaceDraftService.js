"use strict";

const mongoose = require("mongoose");
const PricingWorkspaceDraft = require("../../models/PricingWorkspaceDraft");
const CatalogPackage = require("../../models/CatalogPackage");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const { SUPPLIER_CURRENCY, REGION } = require("../../constants/commerce");
const { normalizePackageCode, normalizeProductCode, normalizeRegion } = require("../../catalog/catalogProjection");
const { CANONICAL_PRODUCT_CODES, isCanonicalProductCode } = require("../../catalog/canonicalOperationalCatalog");
const { resolvePricingSupplier } = require("./pricingSupplierService");

function text(value) {
    return String(value || "").trim();
}

function upper(value) {
    return text(value).toUpperCase();
}

function canonicalPricingProductCode(value) {
    const exact = text(value).toLowerCase();
    if (isCanonicalProductCode(exact)) return exact;
    const compact = normalizeProductCode(exact);
    return CANONICAL_PRODUCT_CODES.find(code => normalizeProductCode(code) === compact) || exact;
}

function amount(value) {
    if (value == null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(6)) : null;
}

function actorName(admin = {}) {
    return text(admin.username || admin.email || admin.id || admin._id || "admin");
}

function actorOwner(admin = {}) {
    return {
        adminId: admin._id || admin.id ? String(admin._id || admin.id) : "",
        username: text(admin.username || admin.email || ""),
        role: upper(admin.role || "")
    };
}

function normalizeSupplierCurrency(value, region) {
    const currency = upper(value || (region === "MM" ? "THB" : "THB"));
    if (!SUPPLIER_CURRENCY.includes(currency)) return "THB";
    return currency;
}

function normalizeDraftRows(rows = [], region = "ALL", supplier = {}) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const normalizedRegion = upper(region || "ALL") === "ALL" ? "ALL" : normalizeRegion(region);
    if (![...REGION, "ALL"].includes(normalizedRegion)) {
        throw new Error("Unsupported Pricing Workspace draft region.");
    }
    return (Array.isArray(rows) ? rows : []).map((row, index) => {
        const productId = canonicalPricingProductCode(row.productCode || row.productId);
        const packageCode = normalizePackageCode(row.packageCode);
        const stagedSupplierCost = amount(row.newSupplierCost ?? row.supplierCost ?? row.stagedSupplierCost);
        const supplierCurrency = normalizeSupplierCurrency(supplier.supplierCurrency, normalizedRegion);
        if (!productId || !packageCode || stagedSupplierCost == null) return null;
        return {
            rowId: text(row.rowId) || `${text(row.mappingId)}:${productId}:${packageCode}`,
            mappingId: text(row.mappingId),
            productId,
            region: normalizedRegion,
            supplierCurrency,
            supplierId: supplier.supplierId,
            supplierCode: supplier.supplierCode,
            supplierName: supplier.supplierName,
            supplierVersion: text(row.supplierVersion),
            packageId: text(row.packageId),
            packageCode,
            stagedSupplierCost,
            rawSupplierCost: stagedSupplierCost,
            supplierCostCapturedAt: row.supplierCostTimestamp || null,
            supplierCostSource: text(row.supplierCostSource),
            providerProductCode: text(row.providerProductCode || row.supplierProductCode),
            providerOfferCode: text(row.providerOfferCode || row.supplierPackageCode),
            fundingCost: amount(row.fundingCost) || 0,
            otherAcquisitionCost: amount(row.otherAcquisitionCost) || 0,
            expectedUpdatedAt: row.expectedUpdatedAt || null,
            pricingNote: text(row.pricingNote),
            selected: row.selected !== false,
            order: index
        };
    }).filter(Boolean);
}

function groupRows(rows = []) {
    const groups = new Map();
    rows.forEach(row => {
        const key = `${row.productId}:${row.region}:${row.supplierId}`;
        if (!groups.has(key)) {
            groups.set(key, {
                productId: row.productId,
                region: row.region,
                supplierCurrency: row.supplierCurrency,
                supplierId: row.supplierId,
                supplierCode: row.supplierCode,
                supplierName: row.supplierName,
                supplierVersion: row.supplierVersion,
                rows: []
            });
        }
        const group = groups.get(key);
        if (row.supplierName) group.supplierName = row.supplierName;
        if (row.supplierVersion) group.supplierVersion = row.supplierVersion;
        group.rows.push(row);
    });
    return [...groups.values()];
}

function validationError(message) {
    const error = new Error(message);
    error.name = "ValidationError";
    return error;
}

async function validateCatalogRows(rows = [], supplier = {}) {
    if (!rows.length) return rows;
    const productIds = [...new Set(rows.map(row => row.productId))];
    const packageCodes = [...new Set(rows.map(row => row.packageCode))];
    const packages = await CatalogPackage.find({
        productCode: { $in: productIds },
        packageCode: { $in: packageCodes },
        deletedAt: null
    }).select("productCode packageCode prices").lean();
    const mappingIds = rows.map(row => row.mappingId).filter(id => mongoose.Types.ObjectId.isValid(id));
    const mappings = mappingIds.length ? await SupplierProductMapping.find({
        _id: { $in: mappingIds },
        supplierId: supplier.supplierId,
        archivedAt: null
    }).select("_id productCode packageCode supplierProductCode supplierPackageCode").lean() : [];
    const mappingMap = new Map(mappings.map(mapping => [String(mapping._id), mapping]));
    const packageMap = new Map(packages.map(pkg => [`${canonicalPricingProductCode(pkg.productCode)}:${normalizePackageCode(pkg.packageCode)}`, pkg]));
    rows.forEach(row => {
        const pkg = packageMap.get(`${row.productId}:${row.packageCode}`);
        if (!pkg) {
            throw validationError(`Supplier-cost draft row references an unknown catalog package: ${row.productId}/${row.packageCode}.`);
        }
        const mapping = mappingMap.get(row.mappingId);
        if (!mapping || canonicalPricingProductCode(mapping.productCode) !== row.productId || normalizePackageCode(mapping.packageCode) !== row.packageCode || !text(mapping.supplierProductCode) || !text(mapping.supplierPackageCode)) {
            throw validationError(`Supplier-cost draft row does not resolve to an active exact supplier mapping: ${row.productId}/${row.packageCode}.`);
        }
    });
    return rows;
}

function publicDraftRow(doc, row) {
    return {
        draftId: doc._id ? String(doc._id) : "",
        productId: doc.productId,
        productCode: doc.productId,
        region: doc.region,
        supplierCurrency: doc.supplierCurrency,
        supplierId: row.supplierId ? String(row.supplierId) : (doc.supplierId ? String(doc.supplierId) : ""),
        supplierCode: row.supplierCode || doc.supplierCode || "",
        supplierName: row.supplierName || doc.supplierName || "Primary supplier",
        supplierVersion: doc.supplierVersion || "",
        packageId: row.packageId || "",
        mappingId: row.mappingId ? String(row.mappingId) : "",
        packageCode: row.packageCode,
        stagedSupplierCost: row.stagedSupplierCost,
        rawSupplierCost: row.rawSupplierCost ?? row.stagedSupplierCost,
        supplierCostCapturedAt: row.supplierCostCapturedAt || null,
        supplierCostSource: row.supplierCostSource || "",
        providerProductCode: row.providerProductCode || "",
        providerOfferCode: row.providerOfferCode || "",
        fundingCost: row.fundingCost || 0,
        otherAcquisitionCost: row.otherAcquisitionCost || 0,
        status: row.status || "DRAFT",
        version: row.version || doc.version || 1,
        expectedUpdatedAt: row.expectedUpdatedAt || null,
        pricingNote: row.pricingNote || "",
        updatedAt: row.updatedAt || doc.updatedAt || null,
        updatedBy: row.updatedBy || doc.updatedBy || ""
    };
}

function draftRowsFromDocs(docs = []) {
    return docs.flatMap(doc => (doc.packageRows || [])
        .filter(row => row?.status !== "PUBLISHED")
        .map(row => publicDraftRow(doc, row)));
}

async function listSupplierCostDraftRows() {
    const docs = await PricingWorkspaceDraft.find({ region: "ALL", status: "DRAFT" })
        .select("productId region supplierId supplierCode supplierCurrency supplierName supplierVersion packageRows status version updatedAt updatedBy")
        .sort({ updatedAt: -1 })
        .lean();
    return draftRowsFromDocs(docs);
}

function draftRowMap(rows = []) {
    const map = new Map();
    rows.forEach(row => {
        const key = `${row.productId}:${row.packageCode}`;
        if (!map.has(key)) map.set(key, row);
    });
    return map;
}

async function saveSupplierCostDraftRows({ rows = [], region = "ALL", supplierId = "", admin = {} } = {}) {
    if (!Array.isArray(rows) || !rows.length) return { saved: [], summary: { requested: 0, saved: 0, groups: 0 } };
    const supplier = await resolvePricingSupplier({ supplierId, region: "ALL" });
    const normalizedRows = await validateCatalogRows(normalizeDraftRows(rows, "ALL", supplier), supplier);
    const groups = groupRows(normalizedRows);
    const actor = actorName(admin);
    const now = new Date();
    const saved = [];

    for (const group of groups) {
        const current = await PricingWorkspaceDraft.findOne({
            productId: group.productId,
            region: "ALL",
            supplierCurrency: group.supplierCurrency,
            status: "DRAFT"
        }).lean();
        const existingRows = new Map((current?.packageRows || [])
            .filter(row => row?.status !== "PUBLISHED")
            .map(row => [text(row.mappingId) || normalizePackageCode(row.packageCode), row]));
        group.rows.forEach(row => {
            const identity = row.mappingId || row.packageCode;
            const previous = existingRows.get(identity);
            existingRows.set(identity, {
                mappingId: row.mappingId || previous?.mappingId || null,
                supplierId: row.supplierId || previous?.supplierId || null,
                supplierCode: row.supplierCode || previous?.supplierCode || "",
                supplierName: row.supplierName || previous?.supplierName || "",
                packageId: row.packageId || previous?.packageId || "",
                packageCode: row.packageCode,
                stagedSupplierCost: row.stagedSupplierCost,
                rawSupplierCost: row.rawSupplierCost,
                supplierCostCapturedAt: row.supplierCostCapturedAt,
                supplierCostSource: row.supplierCostSource,
                providerProductCode: row.providerProductCode,
                providerOfferCode: row.providerOfferCode,
                fundingCost: row.fundingCost,
                otherAcquisitionCost: row.otherAcquisitionCost,
                expectedUpdatedAt: row.expectedUpdatedAt || previous?.expectedUpdatedAt || null,
                pricingNote: row.pricingNote || previous?.pricingNote || "",
                status: "DRAFT",
                version: Number(previous?.version || 0) + 1,
                updatedBy: actor,
                updatedAt: now
            });
        });
        const packageRows = [...existingRows.values()].sort((a, b) => a.packageCode.localeCompare(b.packageCode));
        const draft = await PricingWorkspaceDraft.findOneAndUpdate(
            {
                productId: group.productId,
                region: "ALL",
                supplierCurrency: group.supplierCurrency,
                status: "DRAFT"
            },
            {
                $set: {
                    supplierName: group.supplierName || current?.supplierName || "Primary supplier",
                    supplierId: group.supplierId,
                    supplierCode: group.supplierCode,
                    supplierVersion: group.supplierVersion || current?.supplierVersion || "",
                    packageRows,
                    owner: actorOwner(admin),
                    updatedBy: actor
                },
                $setOnInsert: {
                    productId: group.productId,
                    region: group.region,
                    supplierCurrency: group.supplierCurrency,
                    status: "DRAFT",
                    ...(!current ? { version: 1 } : {}),
                    createdBy: actor
                },
                ...(current ? { $inc: { version: 1 } } : {})
            },
            { returnDocument: "after", upsert: true, runValidators: true }
        ).lean();
        saved.push(...draftRowsFromDocs([draft]));
    }

    return {
        saved,
        summary: {
            requested: normalizedRows.length,
            saved: saved.length,
            groups: groups.length
        }
    };
}

async function clearPublishedSupplierCostDraftRows({ rows = [], region = "" } = {}) {
    const publishedRows = (Array.isArray(rows) ? rows : []).filter(row => row?.published === true);
    const candidateKeys = new Set(publishedRows.map(row => `${canonicalPricingProductCode(row.productCode)}:${normalizePackageCode(row.packageCode)}`));
    if (!candidateKeys.size) return { cleared: 0, clearedKeys: [] };
    const packages = await CatalogPackage.find({
        $or: publishedRows.map(row => ({ productCode: canonicalPricingProductCode(row.productCode), packageCode: normalizePackageCode(row.packageCode) })),
        deletedAt: null
    }).select("productCode packageCode prices").lean();
    const keys = new Set(packages.filter(pkg => {
        const result = publishedRows.find(row => canonicalPricingProductCode(row.productCode) === canonicalPricingProductCode(pkg.productCode) && normalizePackageCode(row.packageCode) === normalizePackageCode(pkg.packageCode));
        const activePrices = REGION.map(region => pkg.prices?.[region]).filter(price => price?.enabled !== false && price?.currency);
        return activePrices.length > 0 && activePrices.every(price => (
            price.publishedPriceMode === "POLICY_DERIVED" &&
            price.supplierCost != null &&
            Number(price.supplierCost) === Number(result?.supplierCost)
        ));
    }).map(pkg => `${canonicalPricingProductCode(pkg.productCode)}:${normalizePackageCode(pkg.packageCode)}`));
    if (!keys.size) return { cleared: 0, clearedKeys: [] };

    const docs = await PricingWorkspaceDraft.find({ region: "ALL", status: "DRAFT" });
    let cleared = 0;
    for (const doc of docs) {
        const before = doc.packageRows.length;
        doc.packageRows = doc.packageRows.filter(row => !keys.has(`${doc.productId}:${normalizePackageCode(row.packageCode)}`));
        cleared += before - doc.packageRows.length;
        if (!doc.packageRows.length) {
            doc.status = "PUBLISHED";
        }
        await doc.save();
    }
    return { cleared, clearedKeys: [...keys] };
}

module.exports = {
    clearPublishedSupplierCostDraftRows,
    draftRowMap,
    listSupplierCostDraftRows,
    normalizeDraftRows,
    saveSupplierCostDraftRows
};
