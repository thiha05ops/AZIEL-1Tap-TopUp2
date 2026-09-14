#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "../../.env"),
    quiet: true
});

const mongoose = require("mongoose");
const CatalogPackage = require("../models/CatalogPackage");
const {
    findCatalogPackageByIdentity
} = require("../services/commerce/catalogPackageIdentityService");

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    /*
     * Regression:
     * PUBG_FAZER_1800_UC exists as an exact packageCode, while another
     * PUBG package may expose that identity through aliases.
     *
     * Exact package identity must always win over alias fallback.
     */
    const requestedProduct = "pubg";
    const requestedPackage = "PUBG_FAZER_1800_UC";

    const exact = await CatalogPackage.findOne({
        productCode: requestedProduct,
        packageCode: requestedPackage,
        enabled: true,
        deletedAt: null
    }).lean();

    assert(exact, "Expected exact PUBG Fazer package to exist.");

    const resolved = await findCatalogPackageByIdentity(
        requestedProduct,
        requestedPackage,
        {
            enabled: true,
            deletedAt: null
        }
    );

    assert(resolved, "Package identity resolver returned no package.");

    console.log(JSON.stringify({
        requested: `${requestedProduct}/${requestedPackage}`,
        exact: {
            id: String(exact._id),
            productCode: exact.productCode,
            packageCode: exact.packageCode,
            amountTH: exact.prices?.TH?.amount
        },
        resolved: {
            id: String(resolved._id),
            productCode: resolved.productCode,
            packageCode: resolved.packageCode,
            amountTH: resolved.prices?.TH?.amount
        },
        exactWins: String(resolved._id) === String(exact._id)
    }, null, 2));

    assert.strictEqual(
        String(resolved._id),
        String(exact._id),
        `Exact package identity lost to alias: expected ${exact.packageCode}, resolved ${resolved.packageCode}`
    );

    console.log("VERIFY_CATALOG_PACKAGE_IDENTITY_PRECEDENCE: PASS");
}

main()
    .catch(error => {
        console.error(`VERIFY_CATALOG_PACKAGE_IDENTITY_PRECEDENCE: FAIL — ${error.message}`);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect().catch(() => null));
