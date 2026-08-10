#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const CatalogProduct = require("../models/CatalogProduct");
const approvedKnowledge = require("../catalog/verifiedProductKnowledge").pubg;
const { hasKnowledgeContent, normalizeProductKnowledge } = require("../catalog/productKnowledge");

const PRODUCT_CODE = "pubg";
const stable = value => JSON.stringify(value);

function changedPaths(current, proposed, prefix = "productKnowledge") {
    if (stable(current) === stable(proposed)) return [];
    if (Array.isArray(current) || Array.isArray(proposed) || !current || !proposed ||
        typeof current !== "object" || typeof proposed !== "object") return [prefix];
    return [...new Set([...Object.keys(current), ...Object.keys(proposed)])]
        .flatMap(key => changedPaths(current[key], proposed[key], `${prefix}.${key}`));
}

async function run({ apply = false } = {}) {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGO_URI or MONGODB_URI is required.");
    mongoose.set("autoIndex", false);
    await mongoose.connect(mongoUri, { autoIndex: false });

    try {
        const matches = await CatalogProduct.find({ productCode: PRODUCT_CODE })
            .select("_id productCode name productKnowledge")
            .lean();
        if (matches.length !== 1) throw new Error(`Fail-closed: expected exactly one ${PRODUCT_CODE} record, found ${matches.length}.`);

        const product = matches[0];
        if (product.productCode !== PRODUCT_CODE) throw new Error("Fail-closed: target identity mismatch.");

        const current = normalizeProductKnowledge(product.productKnowledge || {});
        const proposed = normalizeProductKnowledge(approvedKnowledge);
        const currentHasContent = hasKnowledgeContent(current);
        const alreadyApplied = stable(current) === stable(proposed);
        if (currentHasContent && !alreadyApplied) {
            throw new Error("Fail-closed: current PUBG Product Knowledge is non-empty and does not match the owner-approved source.");
        }

        const fields = changedPaths(current, proposed);
        let mutation = null;
        if (apply && !alreadyApplied) {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const fresh = await CatalogProduct.findOne({ _id: product._id, productCode: PRODUCT_CODE })
                        .select("productKnowledge")
                        .session(session)
                        .lean();
                    const freshKnowledge = normalizeProductKnowledge(fresh?.productKnowledge || {});
                    if (!fresh || stable(freshKnowledge) !== stable(current)) {
                        throw new Error("Fail-closed: PUBG Product Knowledge changed after preflight.");
                    }
                    mutation = await CatalogProduct.collection.updateOne(
                        { _id: product._id, productCode: PRODUCT_CODE },
                        { $set: { productKnowledge: proposed } },
                        { session }
                    );
                    if (mutation.matchedCount !== 1 || mutation.modifiedCount !== 1) {
                        throw new Error("Fail-closed: expected exactly one PUBG CatalogProduct mutation.");
                    }
                });
            } finally {
                await session.endSession();
            }
        }

        return {
            mode: apply ? "apply" : "dry-run",
            target: { _id: String(product._id), productCode: product.productCode, name: product.name },
            preMigration: current,
            proposed,
            fieldsThatWouldChange: fields,
            alreadyApplied,
            mutation: mutation ? { matchedCount: mutation.matchedCount, modifiedCount: mutation.modifiedCount } : null,
            preserved: [
                "all CatalogProduct fields outside productKnowledge",
                "all CatalogPackage records",
                "pricing, supplier metadata, fulfillment, readiness, routes, presentation/media, and account-field configuration"
            ]
        };
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    run({ apply: process.argv.includes("--apply") })
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { PRODUCT_CODE, changedPaths, run };
