"use strict";

const CatalogPackage = require("../../models/CatalogPackage");

function normalizeProductCode(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizePackageCode(value) {
    return String(value || "").trim().toUpperCase();
}

function packageIdentityQuery(productCode, packageCode, extra = {}) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const normalizedPackageCode = normalizePackageCode(packageCode);

    return {
        ...extra,
        $and: [
            {
                $or: [
                    { productCode: normalizedProductCode },
                    { productAliases: normalizedProductCode }
                ]
            },
            {
                $or: [
                    { packageCode: normalizedPackageCode },
                    { aliases: normalizedPackageCode }
                ]
            }
        ]
    };
}

/*
 * Resolve catalog package identities deterministically.
 *
 * Exact canonical identities must always win over aliases. Alias support
 * remains available for legacy product/package routes, but an alias can
 * never shadow an existing exact package.
 */
async function findCatalogPackageByIdentity(productCode, packageCode, extra = {}) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const normalizedPackageCode = normalizePackageCode(packageCode);

    if (!normalizedProductCode || !normalizedPackageCode) return null;

    const candidates = [
        {
            ...extra,
            productCode: normalizedProductCode,
            packageCode: normalizedPackageCode
        },
        {
            ...extra,
            productAliases: normalizedProductCode,
            packageCode: normalizedPackageCode
        },
        {
            ...extra,
            productCode: normalizedProductCode,
            aliases: normalizedPackageCode
        },
        {
            ...extra,
            productAliases: normalizedProductCode,
            aliases: normalizedPackageCode
        }
    ];

    for (const query of candidates) {
        const pkg = await CatalogPackage.findOne(query).lean();
        if (pkg) return pkg;
    }

    return null;
}

module.exports = Object.freeze({
    packageIdentityQuery,
    findCatalogPackageByIdentity
});
