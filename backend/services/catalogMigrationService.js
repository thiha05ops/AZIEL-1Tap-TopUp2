const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const {
    REGION_CURRENCIES,
    getStaticCatalogSnapshot
} = require("../catalog/catalogProjection");

function sameArray(left = [], right = []) {
    const a = [...left].sort();
    const b = [...right].sort();
    return a.length === b.length && a.every((item, index) => item === b[index]);
}

function numbersEqual(left, right) {
    return Math.abs(Number(left) - Number(right)) <= 0.000001;
}

function compareProduct(staticProduct, dbProduct) {
    const conflicts = [];

    if (staticProduct.name !== dbProduct.name) {
        conflicts.push(`name static="${staticProduct.name}" db="${dbProduct.name}"`);
    }

    if (Boolean(staticProduct.enabled) !== Boolean(dbProduct.enabled)) {
        conflicts.push(`enabled static=${staticProduct.enabled} db=${dbProduct.enabled}`);
    }

    if (!sameArray(staticProduct.supportedRegions, dbProduct.supportedRegions || [])) {
        conflicts.push(
            `supportedRegions static=${staticProduct.supportedRegions.join(",")} db=${(dbProduct.supportedRegions || []).join(",")}`
        );
    }

    return conflicts;
}

function comparePackage(staticPackage, dbPackage) {
    const conflicts = [];

    if (staticPackage.name !== dbPackage.name) {
        conflicts.push(`name static="${staticPackage.name}" db="${dbPackage.name}"`);
    }

    if (Boolean(staticPackage.enabled) !== Boolean(dbPackage.enabled)) {
        conflicts.push(`enabled static=${staticPackage.enabled} db=${dbPackage.enabled}`);
    }

    Object.entries(REGION_CURRENCIES).forEach(([region, currency]) => {
        const expected = staticPackage.prices?.[region];
        const actual = dbPackage.prices?.[region];

        if (!expected && !actual) return;

        if (!expected || !actual) {
            conflicts.push(`${region} availability static=${Boolean(expected)} db=${Boolean(actual)}`);
            return;
        }

        if (!numbersEqual(expected.amount, actual.amount)) {
            conflicts.push(`${region} amount static=${expected.amount} db=${actual.amount}`);
        }

        if (expected.currency !== actual.currency || actual.currency !== currency) {
            conflicts.push(`${region} currency static=${expected.currency} db=${actual.currency}`);
        }

        if (Boolean(expected.enabled) !== Boolean(actual.enabled)) {
            conflicts.push(`${region} enabled static=${expected.enabled} db=${actual.enabled}`);
        }
    });

    return conflicts;
}

function buildCatalogSeedPlan({ dbProducts = [], dbPackages = [], staticSnapshot = getStaticCatalogSnapshot() } = {}) {
    const dbProductMap = new Map(dbProducts.map(item => [item.productCode, item]));
    const dbPackageMap = new Map(dbPackages.map(item => [`${item.productCode}:${item.packageCode}`, item]));
    const staticProductCodes = new Set(staticSnapshot.products.map(item => item.productCode));
    const staticPackageKeys = new Set(staticSnapshot.packages.map(item => `${item.productCode}:${item.packageCode}`));

    const plan = {
        products: {
            create: [],
            unchanged: [],
            conflicts: [],
            extra: []
        },
        packages: {
            create: [],
            unchanged: [],
            conflicts: [],
            extra: []
        }
    };

    staticSnapshot.products.forEach(staticProduct => {
        const existing = dbProductMap.get(staticProduct.productCode);

        if (!existing) {
            plan.products.create.push(staticProduct);
            return;
        }

        const conflicts = compareProduct(staticProduct, existing);

        if (conflicts.length) {
            plan.products.conflicts.push({
                productCode: staticProduct.productCode,
                conflicts
            });
            return;
        }

        plan.products.unchanged.push(staticProduct.productCode);
    });

    staticSnapshot.packages.forEach(staticPackage => {
        const key = `${staticPackage.productCode}:${staticPackage.packageCode}`;
        const existing = dbPackageMap.get(key);

        if (!existing) {
            plan.packages.create.push(staticPackage);
            return;
        }

        const conflicts = comparePackage(staticPackage, existing);

        if (conflicts.length) {
            plan.packages.conflicts.push({
                productCode: staticPackage.productCode,
                packageCode: staticPackage.packageCode,
                conflicts
            });
            return;
        }

        plan.packages.unchanged.push(key);
    });

    dbProducts.forEach(product => {
        if (!staticProductCodes.has(product.productCode)) {
            plan.products.extra.push(product.productCode);
        }
    });

    dbPackages.forEach(item => {
        const key = `${item.productCode}:${item.packageCode}`;

        if (!staticPackageKeys.has(key)) {
            plan.packages.extra.push(key);
        }
    });

    return plan;
}

function hasConflicts(plan) {
    return Boolean(plan.products.conflicts.length || plan.packages.conflicts.length);
}

async function loadDatabaseCatalog() {
    const [dbProducts, dbPackages] = await Promise.all([
        CatalogProduct.find().lean(),
        CatalogPackage.find().lean()
    ]);

    return { dbProducts, dbPackages };
}

async function createMissingCatalogRows(plan) {
    if (hasConflicts(plan)) {
        throw new Error("Catalog seed has conflicts; refusing to apply.");
    }

    if (plan.products.create.length) {
        await CatalogProduct.insertMany(plan.products.create, { ordered: true });
    }

    if (plan.packages.create.length) {
        await CatalogPackage.insertMany(plan.packages.create, { ordered: true });
    }
}

function summarizePlan(plan) {
    return {
        productsPlanned: plan.products.create.length + plan.products.unchanged.length + plan.products.conflicts.length,
        packagesPlanned: plan.packages.create.length + plan.packages.unchanged.length + plan.packages.conflicts.length,
        creates: plan.products.create.length + plan.packages.create.length,
        unchanged: plan.products.unchanged.length + plan.packages.unchanged.length,
        conflicts: plan.products.conflicts.length + plan.packages.conflicts.length,
        extraDbRows: plan.products.extra.length + plan.packages.extra.length
    };
}

module.exports = {
    buildCatalogSeedPlan,
    comparePackage,
    compareProduct,
    createMissingCatalogRows,
    hasConflicts,
    loadDatabaseCatalog,
    summarizePlan
};
