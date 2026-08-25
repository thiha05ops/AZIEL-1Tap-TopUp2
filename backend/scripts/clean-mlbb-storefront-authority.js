#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const { updatePackage } = require("../services/catalogAdminService");

const APPLY = process.argv.includes("--apply");
const CANONICAL_NAMES = Object.freeze({
    MLBB_86: "86 Diamonds",
    MLBB_172: "172 Diamonds",
    MLBB_WONDD_ML00257: "257 Diamonds",
    MLBB_WONDD_ML00275: "275 Diamonds",
    MLBB_WONDD_ML00343: "343 Diamonds",
    MLBB_570: "429 Diamonds",
    MLBB_WONDD_ML00600: "600 Diamonds",
    MLBB_WONDD_ML00706: "706 Diamonds",
    MLBB_WONDD_ML00792: "792 Diamonds",
    MLBB_WONDD_ML01049: "1049 Diamonds",
    MLBB_WONDD_ML02195: "2195 Diamonds",
    MLBB_WONDD_ML03688: "3688 Diamonds",
    MLBB_WONDD_ML05532: "5532 Diamonds",
    MLBB_WONDD_ML09288: "9288 Diamonds",
    MLBB_WONDD_MLFT055: "55 Diamonds – First Top-Up",
    MLBB_WONDD_MLFT165: "165 Diamonds – First Top-Up",
    MLBB_WONDD_MLFT275: "275 Diamonds – First Top-Up",
    MLBB_WONDD_MLFT565: "565 Diamonds – First Top-Up",
    MLBB_WONDD_MLOTW01: "One-Time Weekly Pass",
    MLBB_WONDD_MLTMP01: "Twilight Miya Pass"
});

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const mappings = await SupplierProductMapping.find({
        supplierCode: "WONDD", region: "TH", productCode: "mlbb",
        supplierProductCode: "mlbb", executionMode: "API", enabled: true,
        supplierPackageCode: { $type: "string", $ne: "" }
    }).lean();
    if (mappings.length !== 20 || new Set(mappings.map(item => item.packageCode)).size !== 20) throw new Error("Expected the exact 20-package WonDD MLBB whitelist.");
    const mappingCodes = [...new Set(mappings.map(item => item.packageCode))].sort();
    const namedCodes = Object.keys(CANONICAL_NAMES).sort();
    if (JSON.stringify(mappingCodes) !== JSON.stringify(namedCodes)) throw new Error("Canonical naming authority does not exactly match the mapped whitelist.");
    const packages = await CatalogPackage.find({ productCode: "mlbb", packageCode: { $in: mappingCodes }, deletedAt: null });
    if (packages.length !== 20) throw new Error("Every mapped package must resolve to one canonical package.");
    const changes = packages.filter(pkg => pkg.name !== CANONICAL_NAMES[pkg.packageCode]).map(pkg => ({ packageCode: pkg.packageCode, from: pkg.name, to: CANONICAL_NAMES[pkg.packageCode] }));
    if (APPLY) {
        for (const change of changes) {
            const pkg = packages.find(item => item.packageCode === change.packageCode);
            await updatePackage({ productCode: "mlbb", packageCode: change.packageCode, patch: { name: change.to, expectedUpdatedAt: pkg.updatedAt }, actor: "mlbb-storefront-authority-cleanup" });
        }
    }
    console.log(JSON.stringify({ mode: APPLY ? "APPLY" : "PREVIEW", mappedWhitelist: mappings.length, renamed: changes.length, changes, topupCalls: 0 }, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(`MLBB_STOREFRONT_CLEANUP_ERROR: ${error.message}`); process.exitCode = 1; });
