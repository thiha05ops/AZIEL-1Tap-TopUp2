const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const seeds = require("../catalog/verifiedProductKnowledge");
const { normalizeProductKnowledge } = require("../catalog/productKnowledge");

async function run({ apply = false } = {}) {
    const operations = Object.entries(seeds).map(([productCode, content]) => ({
        updateOne: {
            filter: { productCode },
            update: { $set: { productKnowledge: normalizeProductKnowledge(content) } }
        }
    }));
    if (!apply) return {
        dryRun: true,
        prepared: operations.length,
        productCodes: Object.keys(seeds),
        replacedField: "productKnowledge",
        preservedFields: "All CatalogProduct fields outside productKnowledge; all CatalogPackage records including customerNote."
    };
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGO_URI or MONGODB_URI is required with --apply.");
    mongoose.set("autoIndex", false);
    await mongoose.connect(mongoUri, { autoIndex: false });
    try { return await CatalogProduct.bulkWrite(operations, { ordered: false }); }
    finally { await mongoose.disconnect(); }
}

if (require.main === module) {
    run({ apply: process.argv.includes("--apply") })
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { run };
