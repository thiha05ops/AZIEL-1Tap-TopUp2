"use strict";

const CatalogPackage = require("../../models/CatalogPackage");

function packageIdentityQuery(productCode, packageCode, extra = {}) {
    return {
        ...extra,
        $and: [
            {
                $or: [
                    { productCode: String(productCode || "").trim().toLowerCase() },
                    { productAliases: String(productCode || "").trim().toLowerCase() }
                ]
            },
            {
                $or: [
                    { packageCode: String(packageCode || "").trim().toUpperCase() },
                    { aliases: String(packageCode || "").trim().toUpperCase() }
                ]
            }
        ]
    };
}

function findCatalogPackageByIdentity(productCode, packageCode, extra = {}) {
    return CatalogPackage.findOne(packageIdentityQuery(productCode, packageCode, extra));
}

module.exports = Object.freeze({ packageIdentityQuery, findCatalogPackageByIdentity });
