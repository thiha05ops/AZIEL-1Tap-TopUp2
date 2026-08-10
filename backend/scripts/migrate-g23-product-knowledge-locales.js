#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const CatalogProduct = require("../models/CatalogProduct");
const seeds = require("../catalog/verifiedProductKnowledge");
const { hasKnowledgeContent, normalizeProductKnowledge } = require("../catalog/productKnowledge");

const stable = value => JSON.stringify(value);

async function run({ apply = false } = {}) {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGO_URI or MONGODB_URI is required.");
  mongoose.set("autoIndex", false);
  await mongoose.connect(mongoUri, { autoIndex: false });
  try {
    const report = [];
    const updates = [];
    for (const [productCode, seed] of Object.entries(seeds)) {
      const product = await CatalogProduct.findOne({ productCode }).select("productCode productKnowledge").lean();
      if (!product) {
        report.push({ productCode, status: "RECORD_NOT_FOUND" });
        continue;
      }
      const current = normalizeProductKnowledge(product.productKnowledge || {});
      const proposed = normalizeProductKnowledge(seed);
      const englishMatches = stable(current.locales.en) === stable(proposed.locales.en);
      const hasApprovedEnglish = hasKnowledgeContent(current.locales.en);
      const status = englishMatches
        ? "APPROVED_SOURCE_MATCH"
        : (hasApprovedEnglish ? "ENGLISH_SOURCE_MISMATCH" : "NO_APPROVED_ENGLISH");
      const fields = ["my", "th"].map(locale => ({
        field: `productKnowledge.locales.${locale}`,
        currentEN: current.locales.en,
        current: current.locales[locale],
        proposed: proposed.locales[locale],
        pending: stable(current.locales[locale]) !== stable(proposed.locales[locale])
      }));
      report.push({ productCode, status, fields });
      if (englishMatches && fields.some(field => field.pending)) {
        updates.push({
          updateOne: {
            filter: { _id: product._id },
            update: { $set: {
              "productKnowledge.locales.my": proposed.locales.my,
              "productKnowledge.locales.th": proposed.locales.th
            } }
          }
        });
      }
    }

    const mismatches = report.filter(item => item.status === "ENGLISH_SOURCE_MISMATCH" || item.status === "RECORD_NOT_FOUND");
    if (apply && mismatches.length) throw new Error(`Fail-closed: ${mismatches.length} Product Knowledge records do not match the approved English source.`);
    let mutation = null;
    if (apply && updates.length) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          mutation = await CatalogProduct.bulkWrite(updates, { ordered: true, session });
        });
      } finally {
        await session.endSession();
      }
    }
    return {
      dryRun: !apply,
      scope: Object.keys(seeds),
      pendingRecords: updates.length,
      report,
      mutation: mutation ? { matchedCount: mutation.matchedCount, modifiedCount: mutation.modifiedCount } : null
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

module.exports = { run };
