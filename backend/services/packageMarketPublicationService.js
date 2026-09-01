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
    const mode = String(env.PACKAGE_MARKET_PUBLICATION_MODE || "LEGACY").trim().toUpperCase();
    return PUBLICATION_MODES.includes(mode) ? mode : "LEGACY";
}

function publicationKey(productCode, packageCode, customerMarket = "TH") {
    return `${String(productCode || "").trim().toLowerCase()}:${String(packageCode || "").trim().toUpperCase()}:${normalizeCustomerMarket(customerMarket)}`;
}

function publicationMap(records = []) {
    return new Map(records.map(record => [publicationKey(record.productCode, record.packageCode, record.customerMarket), record]));
}

function suppressionReasons(pkg = {}, customerMarket = "TH") {
    const market = normalizeCustomerMarket(customerMarket);
    const reasons = [];
    if (pkg.deletedAt) reasons.push("PACKAGE_DELETED");
    if (pkg.enabled === false) reasons.push("PACKAGE_DISABLED");
    const price = pkg.prices?.[market];
    if (!price || price.enabled === false || !Number.isFinite(Number(price.amount)) || Number(price.amount) <= 0) reasons.push("NO_VALID_PRICE");
    if (pkg.fulfillmentRegions?.[market] !== true) reasons.push("FULFILLMENT_NOT_READY");
    return reasons;
}

function projectPackagePublication(pkg, record, customerMarket = "TH") {
    const published = record?.published === true;
    const reasons = published ? suppressionReasons(pkg, customerMarket) : [];
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
    const recordsByKey = publicationMap(records);
    for (const pkg of projection?.packages || []) {
        const record = recordsByKey.get(publicationKey(projection.productCode, pkg.packageCode, customerMarket));
        pkg.publication = projectPackagePublication(pkg, record, customerMarket);
    }
    return projection;
}

function stripPublicationMetadata(projection) {
    for (const pkg of projection?.packages || []) delete pkg.publication;
    return projection;
}

function explicitPublishedPackages(projection) {
    // Publication controls storefront inclusion. Operational safety is projected
    // separately so an unsafe package remains published-but-suppressed rather
    // than silently losing the Admin's publication decision.
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

module.exports = {
    PUBLICATION_MODES,
    PackageMarketPublicationError,
    applyPublicationMetadata,
    comparePublicationSets,
    explicitPublishedPackages,
    normalizeCustomerMarket,
    publicationKey,
    publicationMap,
    publicationMode,
    projectPackagePublication,
    setPackageMarketPublication,
    stripPublicationMetadata,
    suppressionReasons
};
