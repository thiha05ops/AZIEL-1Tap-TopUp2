const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../..", ".env") });

const CatalogProduct = require("../models/CatalogProduct");

const APPROVED_PRODUCTS = Object.freeze(["mlbb", "pubg", "pubgrp", "freefire", "hok"]);
const APPROVED_REGIONS = Object.freeze(["MM", "TH"]);

async function run() {
    const apply = process.argv.includes("--apply");
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const products = await CatalogProduct.find({ productCode: { $in: APPROVED_PRODUCTS } })
        .select({ productCode: 1, "fulfillment.manualAllowedRegions": 1 })
        .lean();
    const found = new Set(products.map(item => item.productCode));
    const missing = APPROVED_PRODUCTS.filter(code => !found.has(code));
    if (missing.length) throw new Error(`Missing approved products: ${missing.join(", ")}`);

    const plan = products.map(product => ({
        productCode: product.productCode,
        before: product.fulfillment?.manualAllowedRegions || [],
        after: APPROVED_REGIONS
    }));
    if (apply) {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                for (const productCode of APPROVED_PRODUCTS) {
                    await CatalogProduct.updateOne(
                        { productCode },
                        { $set: { "fulfillment.manualAllowedRegions": APPROVED_REGIONS } },
                        { session, runValidators: true }
                    );
                }
            });
        } finally {
            await session.endSession();
        }
    }
    console.log(JSON.stringify({ applied: apply, products: plan, telegramChanged: false }, null, 2));
    await mongoose.disconnect();
}

run().catch(async error => {
    console.error(error);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
