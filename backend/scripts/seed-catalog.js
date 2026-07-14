const dotenv = require("dotenv");
const mongoose = require("mongoose");
const path = require("path");

dotenv.config({
    path: path.join(__dirname, "../..", ".env")
});

const connectDB = require("../config/db");
const {
    buildCatalogSeedPlan,
    createMissingCatalogRows,
    hasConflicts,
    loadDatabaseCatalog,
    summarizePlan
} = require("../services/catalogMigrationService");

function isApplyMode() {
    return process.argv.includes("--apply");
}

function printPlan(plan) {
    plan.products.create.forEach(item => console.log(`CREATE PRODUCT ${item.productCode}`));
    plan.products.unchanged.forEach(productCode => console.log(`UNCHANGED PRODUCT ${productCode}`));
    plan.products.conflicts.forEach(item => {
        console.log(`CONFLICT PRODUCT ${item.productCode}: ${item.conflicts.join("; ")}`);
    });
    plan.products.extra.forEach(productCode => console.log(`EXTRA_DB_PRODUCT ${productCode}`));

    plan.packages.create.forEach(item => console.log(`CREATE PACKAGE ${item.productCode}:${item.packageCode}`));
    plan.packages.unchanged.forEach(key => console.log(`UNCHANGED PACKAGE ${key}`));
    plan.packages.conflicts.forEach(item => {
        console.log(`CONFLICT PACKAGE ${item.productCode}:${item.packageCode}: ${item.conflicts.join("; ")}`);
    });
    plan.packages.extra.forEach(key => console.log(`EXTRA_DB_PACKAGE ${key}`));

    const summary = summarizePlan(plan);
    console.log(`SUMMARY products=${summary.productsPlanned} packages=${summary.packagesPlanned} creates=${summary.creates} unchanged=${summary.unchanged} conflicts=${summary.conflicts} extraDbRows=${summary.extraDbRows}`);
}

async function main() {
    const apply = isApplyMode();

    await connectDB();

    try {
        const databaseCatalog = await loadDatabaseCatalog();
        const plan = buildCatalogSeedPlan(databaseCatalog);

        printPlan(plan);

        if (!apply) {
            console.log("APPLY STATUS: NOT APPLIED");
            return;
        }

        if (hasConflicts(plan)) {
            throw new Error("Catalog seed has conflicts. Resolve conflicts before --apply.");
        }

        await createMissingCatalogRows(plan);
        console.log("APPLY STATUS: APPLIED");
    } finally {
        await mongoose.connection.close(false);
    }
}

main().catch(error => {
    console.error("Catalog seed failed:", error.message || error);
    process.exit(1);
});
