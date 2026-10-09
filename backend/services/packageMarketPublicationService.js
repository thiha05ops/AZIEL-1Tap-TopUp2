const CatalogPackage = require("../models/CatalogPackage");
const PackageMarketPublication = require("../models/PackageMarketPublication");

const PUBLICATION_MODES = Object.freeze(["LEGACY", "SHADOW", "EXPLICIT"]);

class PackageMarketPublicationError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "PackageMarketPublicationError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function normalizeCustomerMarket(value = "TH") {
    const market = String(value || "").trim().toUpperCase();
    if (!["MM", "TH"].includes(market)) {
        throw new PackageMarketPublicationError("PUBLICATION_MARKET_INVALID", "Customer market is not supported.");
    }
    return market;
}

function publicationMode(env = process.env) {
    const mode = String(env.PACKAGE_MARKET_PUBLICATION_MODE || "EXPLICIT").trim().toUpperCase();
    return PUBLICATION_MODES.includes(mode) ? mode : "EXPLICIT";
}

function publicationKey(productCode, packageCode, customerMarket = "TH") {
    return `${String(productCode || "").trim().toLowerCase()}:${String(packageCode || "").trim().toUpperCase()}:${normalizeCustomerMarket(customerMarket)}`;
}

function publicationMap(records = []) {
    return new Map(records.map(record => [publicationKey(record.productCode, record.packageCode, record.customerMarket), record]));
}

function publicationPackageKey(productCode, packageCode) {
    return `${String(productCode || "").trim().toLowerCase()}:${String(packageCode || "").trim().toUpperCase()}`;
}

function publicationPackageMap(records = []) {
    const grouped = new Map();
    for (const record of records || []) {
        const key = publicationPackageKey(record.productCode, record.packageCode);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(record);
    }
    return grouped;
}

function suppressionReasons(pkg = {}, customerMarket = "TH") {
    normalizeCustomerMarket(customerMarket);
    return [];
}

function projectPackagePublication(pkg, recordOrRecords, customerMarket = "TH") {
    const records = Array.isArray(recordOrRecords)
        ? recordOrRecords
        : (recordOrRecords ? [recordOrRecords] : []);

    const market = normalizeCustomerMarket(customerMarket);

    const record = records.find(
        item =>
            String(item?.customerMarket || "")
                .trim()
                .toUpperCase() === market
    ) || null;

    const published = record?.published === true;
    const reasons = published ? suppressionReasons(pkg, market) : [];
    return {
        customerMarket: normalizeCustomerMarket(customerMarket),
        published,
        state: !published ? "PRIVATE" : reasons.length ? "SUPPRESSED" : "PUBLISHED",
        currentlyPurchasable: published && reasons.length === 0,
        suppressionReasons: reasons,
        decisionVersion: Number(record?.decisionVersion || 0),
        decisionNote: String(record?.decisionNote || ""),
        publishedAt: record?.publishedAt || null,
        publishedBy: record?.publishedBy || "",
        unpublishedAt: record?.unpublishedAt || null,
        unpublishedBy: record?.unpublishedBy || "",
        missing: !record
    };
}

function applyPublicationMetadata(projection, records = [], customerMarket = "TH") {
    const recordsByPackage = publicationPackageMap(records);
    for (const pkg of projection?.packages || []) {
        const packageRecords = recordsByPackage.get(publicationPackageKey(projection.productCode, pkg.packageCode)) || [];
        pkg.publication = projectPackagePublication(pkg, packageRecords, customerMarket);
    }
    return projection;
}

function stripPublicationMetadata(projection) {
    for (const pkg of projection?.packages || []) delete pkg.publication;
    return projection;
}

function explicitPublishedPackages(projection) {
    // This record owns only the Admin's package Selling ON/OFF decision.
    // Price, product intent and route readiness are evaluated by the shared
    // effective-sales projection and never mutate this intent.
    return (projection?.packages || []).filter(pkg => pkg.publication?.published === true);
}

function comparePublicationSets(legacyProducts = [], proposedProducts = [], customerMarket = "TH") {
    const identities = products => new Set(products.flatMap(product => (product.packages || []).map(pkg => publicationKey(product.productCode, pkg.packageCode, customerMarket))));
    const legacy = identities(legacyProducts);
    const proposed = identities(proposedProducts);
    return {
        customerMarket: normalizeCustomerMarket(customerMarket),
        legacyCount: legacy.size,
        proposedCount: proposed.size,
        added: [...proposed].filter(key => !legacy.has(key)).sort(),
        removed: [...legacy].filter(key => !proposed.has(key)).sort()
    };
}

async function setPackageMarketPublication({ productCode, packageCode, customerMarket = "TH", published, actor = "admin", decisionNote = "", session = null }) {
    if (typeof published !== "boolean") throw new PackageMarketPublicationError("PUBLICATION_DECISION_INVALID", "published must be true or false.");
    const market = normalizeCustomerMarket(customerMarket);
    const normalizedProduct = String(productCode || "").trim().toLowerCase();
    const normalizedPackage = String(packageCode || "").trim().toUpperCase();
    const packageQuery = CatalogPackage.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, deletedAt: null });
    if (session) packageQuery.session(session);
    const pkg = await packageQuery.lean();
    if (!pkg) throw new PackageMarketPublicationError("CATALOG_PACKAGE_NOT_FOUND", "Package not found.", 404);
    const previousQuery = PackageMarketPublication.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, customerMarket: market });
    if (session) previousQuery.session(session);
    const previous = await previousQuery;
    const normalizedNote = String(decisionNote || "").trim().slice(0, 500);
    if (previous && previous.published === published && String(previous.decisionNote || "") === normalizedNote) {
        return { publication: previous.toObject(), changed: false };
    }
    const now = new Date();
    const update = {
        productCode: normalizedProduct,
        packageCode: normalizedPackage,
        customerMarket: market,
        published,
        decisionVersion: Number(previous?.decisionVersion || 0) + 1,
        decisionNote: normalizedNote,
        provenance: { ...(previous?.provenance?.toObject?.() || previous?.provenance || {}), source: "ADMIN" }
    };
    if (published) Object.assign(update, { publishedAt: now, publishedBy: actor, unpublishedAt: null, unpublishedBy: "" });
    else Object.assign(update, { unpublishedAt: now, unpublishedBy: actor });
    const publication = await PackageMarketPublication.findOneAndUpdate(
        { productCode: normalizedProduct, packageCode: normalizedPackage, customerMarket: market },
        { $set: update },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, session }
    ).lean();
    return { publication, changed: true };
}

async function publishPackageMarketBatch({ productCode, customerMarket = "TH", packages = [], actor = "admin", decisionNote = "", session = null, model = PackageMarketPublication } = {}) {
    const market = normalizeCustomerMarket(customerMarket);
    const normalizedProduct = String(productCode || "").trim().toLowerCase();
    const normalizedActor = String(actor || "admin").trim().slice(0, 120);
    const normalizedNote = String(decisionNote || "").trim().slice(0, 500);
    const rows = [...new Map((packages || []).map(item => {
        const packageCode = String(item?.packageCode || "").trim().toUpperCase();
        return [packageCode, { packageCode, expectedDecisionVersion: Number(item?.expectedDecisionVersion || 0) }];
    }).filter(([packageCode]) => packageCode)).values()];
    if (!normalizedProduct) throw new PackageMarketPublicationError("PUBLICATION_PRODUCT_REQUIRED", "Product is required.");
    if (!rows.length) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0, packageCodes: [] };
    const now = new Date();
    const operations = rows.map(row => ({
        updateOne: {
            filter: {
                productCode: normalizedProduct,
                packageCode: row.packageCode,
                customerMarket: market,
                ...(row.expectedDecisionVersion > 0
                    ? { decisionVersion: row.expectedDecisionVersion }
                    : { decisionVersion: { $exists: false } })
            },
            update: {
                $set: {
                    productCode: normalizedProduct,
                    packageCode: row.packageCode,
                    customerMarket: market,
                    published: true,
                    publishedAt: now,
                    publishedBy: normalizedActor,
                    unpublishedAt: null,
                    unpublishedBy: "",
                    decisionVersion: row.expectedDecisionVersion + 1,
                    decisionNote: normalizedNote,
                    "provenance.source": "ADMIN_BULK_READY"
                }
            },
            upsert: row.expectedDecisionVersion === 0
        }
    }));
    const result = await model.bulkWrite(operations, { ordered: true, session });
    const changed = Number(result.modifiedCount || 0) + Number(result.upsertedCount || 0);
    if (changed !== rows.length) {
        throw new PackageMarketPublicationError("PUBLICATION_BATCH_STALE", "A package publication changed while the batch was being applied.", 409);
    }
    return {
        matchedCount: Number(result.matchedCount || 0),
        modifiedCount: Number(result.modifiedCount || 0),
        upsertedCount: Number(result.upsertedCount || 0),
        packageCodes: rows.map(row => row.packageCode)
    };
}

module.exports = {
    PUBLICATION_MODES,
    PackageMarketPublicationError,
    applyPublicationMetadata,
    comparePublicationSets,
    explicitPublishedPackages,
    normalizeCustomerMarket,
    publicationKey,
    publicationPackageKey,
    publicationPackageMap,
    publicationMap,
    publicationMode,
    publishPackageMarketBatch,
    projectPackagePublication,
    setPackageMarketPublication,
    stripPublicationMetadata,
    suppressionReasons
};
