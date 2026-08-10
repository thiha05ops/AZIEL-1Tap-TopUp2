const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "../..", ".env")
});

const CatalogProduct = require("../models/CatalogProduct");
const {
    CANONICAL_OPERATIONAL_PRODUCTS,
    CANONICAL_PRODUCT_CODE_SET
} = require("../catalog/canonicalOperationalCatalog");

function shouldApply() {
    return process.argv.includes("--apply");
}

async function connect() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGO_URI is required for canonical product routing migration.");
    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });
}

async function run() {
    const apply = shouldApply();
    await connect();

    const before = await CatalogProduct.find({
        productCode: { $in: Array.from(CANONICAL_PRODUCT_CODE_SET) }
    }).sort({ productCode: 1 }).lean();
    const beforeByCode = new Map(before.map(product => [product.productCode, product]));
    const routeChanges = [];

    for (const canonical of CANONICAL_OPERATIONAL_PRODUCTS) {
        const current = beforeByCode.get(canonical.productCode);
        const beforeRoute = current?.productRoute || "";
        const nextRoute = canonical.productRoute || "";
        routeChanges.push({
            productCode: canonical.productCode,
            name: canonical.name,
            beforeRoute,
            route: nextRoute,
            changed: beforeRoute !== nextRoute
        });

        if (apply) {
            await CatalogProduct.updateOne(
                { productCode: canonical.productCode },
                {
                    $set: {
                        productRoute: nextRoute,
                        "metadata.canonicalRoute": nextRoute,
                        "metadata.canonicalRouteVersion": 1
                    }
                }
            );
        }
    }

    const after = apply
        ? await CatalogProduct.find({ productCode: { $in: Array.from(CANONICAL_PRODUCT_CODE_SET) } }).lean()
        : before;
    const afterByCode = new Map(after.map(product => [product.productCode, product]));
    const genericFallbackRoutes = routeChanges
        .filter(item => String(item.route || "").includes("coming-soon.html"))
        .map(item => item.productCode);
    const missingRoutes = routeChanges
        .filter(item => !String(item.route || "").trim())
        .map(item => item.productCode);
    const mismatchedRoutes = CANONICAL_OPERATIONAL_PRODUCTS
        .filter(canonical => (afterByCode.get(canonical.productCode)?.productRoute || "") !== (apply ? canonical.productRoute : (beforeByCode.get(canonical.productCode)?.productRoute || "")))
        .map(canonical => canonical.productCode);

    if (genericFallbackRoutes.length > 0) {
        throw new Error(`Canonical products may not route to generic fallback: ${genericFallbackRoutes.join(", ")}`);
    }
    if (missingRoutes.length > 0) {
        throw new Error(`Canonical products missing routes: ${missingRoutes.join(", ")}`);
    }
    if (apply && mismatchedRoutes.length > 0) {
        throw new Error(`Canonical route migration mismatch: ${mismatchedRoutes.join(", ")}`);
    }

    return {
        mode: apply ? "apply" : "dry-run",
        migrationPerformed: apply,
        routeChanges
    };
}

if (require.main === module) {
    run()
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => {
            console.error(error?.message || error);
            process.exitCode = 1;
        })
        .finally(async () => {
            await mongoose.disconnect();
        });
}

module.exports = { run };
