"use strict";

const PricingWorkspaceDraft = require("../../models/PricingWorkspaceDraft");
const CatalogPackage = require("../../models/CatalogPackage");
const { CURRENCY, REGION } = require("../../constants/commerce");
const { normalizePackageCode, normalizeProductCode, normalizeRegion } = require("../../catalog/catalogProjection");

function text(value) {
    return String(value || "").trim();
}

function upper(value) {
    return text(value).toUpperCase();
}

function amount(value) {
    if (value == null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(2)) : null;
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
    if (!CURRENCY.includes(currency)) return region === "MM" ? "THB" : "THB";
    if (region === "TH") return "THB";
    return currency;
}

function normalizeDraftRows(rows = [], region = "TH") {
    if (!Array.isArray(rows) || !rows.length) return [];
    const normalizedRegion = normalizeRegion(region || "TH");
    if (!REGION.includes(normalizedRegion)) {
        throw new Error("Unsupported Pricing Workspace draft region.");
    }
    return (Array.isArray(rows) ? rows : []).map((row, index) => {
        const productId = normalizeProductCode(row.productCode || row.productId);
        const packageCode = normalizePackageCode(row.packageCode);
        const stagedSupplierCost = amount(row.newSupplierCost ?? row.supplierCost ?? row.stagedSupplierCost);
        const supplierCurrency = normalizeSupplierCurrency(row.supplierCurrency, normalizedRegion);
        if (!productId || !packageCode || stagedSupplierCost == null) return null;
        return {
            rowId: text(row.rowId) || `${productId}:${packageCode}`,
            productId,
            region: normalizedRegion,
            supplierCurrency,
            supplierName: text(row.supplierName) || "Primary supplier",
            supplierVersion: text(row.supplierVersion),
            packageId: text(row.packageId),
            packageCode,
            stagedSupplierCost,
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
        const key = `${row.productId}:${row.region}:${row.supplierCurrency}`;
        if (!groups.has(key)) {
            groups.set(key, {
                productId: row.productId,
                region: row.region,
                supplierCurrency: row.supplierCurrency,
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

async function validateCatalogRows(rows = []) {
    if (!rows.length) return rows;
    const productIds = [...new Set(rows.map(row => row.productId))];
    const packageCodes = [...new Set(rows.map(row => row.packageCode))];
    const packages = await CatalogPackage.find({
        productCode: { $in: productIds },
        packageCode: { $in: packageCodes },
        deletedAt: null
    }).select("productCode packageCode prices").lean();
    const packageMap = new Map(packages.map(pkg => [`${normalizeProductCode(pkg.productCode)}:${normalizePackageCode(pkg.packageCode)}`, pkg]));
    rows.forEach(row => {
        const pkg = packageMap.get(`${row.productId}:${row.packageCode}`);
        if (!pkg) {
            throw validationError(`Supplier-cost draft row references an unknown catalog package: ${row.productId}/${row.packageCode}.`);
        }
        if (!pkg.prices?.[row.region]) {
            throw validationError(`Supplier-cost draft row references a package without ${row.region} pricing: ${row.productId}/${row.packageCode}.`);
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
        supplierName: doc.supplierName || "Primary supplier",
        supplierVersion: doc.supplierVersion || "",
        packageId: row.packageId || "",
        packageCode: row.packageCode,
        stagedSupplierCost: row.stagedSupplierCost,
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
    const docs = await PricingWorkspaceDraft.find({ status: "DRAFT" })
        .select("productId region supplierCurrency supplierName supplierVersion packageRows status version updatedAt updatedBy")
        .sort({ updatedAt: -1 })
        .lean();
    return draftRowsFromDocs(docs);
}

function draftRowMap(rows = []) {
    const map = new Map();
    rows.forEach(row => {
        map.set(`${row.productId}:${row.region}:${row.packageCode}`, row);
    });
    return map;
}

async function saveSupplierCostDraftRows({ rows = [], region = "TH", admin = {} } = {}) {
    const normalizedRows = await validateCatalogRows(normalizeDraftRows(rows, region));
    const groups = groupRows(normalizedRows);
    const actor = actorName(admin);
    const now = new Date();
    const saved = [];

    for (const group of groups) {
        const current = await PricingWorkspaceDraft.findOne({
            productId: group.productId,
            region: group.region,
            supplierCurrency: group.supplierCurrency,
            status: "DRAFT"
        }).lean();
        const existingRows = new Map((current?.packageRows || [])
            .filter(row => row?.status !== "PUBLISHED")
            .map(row => [normalizePackageCode(row.packageCode), row]));
        group.rows.forEach(row => {
            const previous = existingRows.get(row.packageCode);
            existingRows.set(row.packageCode, {
                packageId: row.packageId || previous?.packageId || "",
                packageCode: row.packageCode,
                stagedSupplierCost: row.stagedSupplierCost,
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
                region: group.region,
                supplierCurrency: group.supplierCurrency,
                status: "DRAFT"
            },
            {
                $set: {
                    supplierName: group.supplierName || current?.supplierName || "Primary supplier",
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
                    version: 1,
                    createdBy: actor
                },
                $inc: { version: current ? 1 : 0 }
            },
            { new: true, upsert: true, runValidators: true }
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
    const normalizedRegion = normalizeRegion(region || "TH");
    const keys = new Set((Array.isArray(rows) ? rows : [])
        .filter(row => row?.published === true)
        .map(row => `${normalizeProductCode(row.productCode)}:${normalizePackageCode(row.packageCode)}`));
    if (!keys.size) return { cleared: 0 };

    const docs = await PricingWorkspaceDraft.find({ region: normalizedRegion, status: "DRAFT" });
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
    return { cleared };
}

module.exports = {
    clearPublishedSupplierCostDraftRows,
    draftRowMap,
    listSupplierCostDraftRows,
    normalizeDraftRows,
    saveSupplierCostDraftRows
};
