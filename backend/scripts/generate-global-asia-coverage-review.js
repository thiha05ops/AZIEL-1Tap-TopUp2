#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const readModel = require("../services/adminSupplierCatalogReadService");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");

const outputArgument = process.argv.find(value => value.startsWith("--output="));
const outputPath = outputArgument ? path.resolve(process.cwd(), outputArgument.slice("--output=".length)) : "";
const summaryOnly = process.argv.includes("--summary-only");

async function main() {
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred", serverSelectionTimeoutMS: 10000 });
    const projected = readModel.project(await readModel.load());
    const productById = new Map(projected.productRows.map(product => [product.productId, product]));
    const offers = projected.rows.map(row => readModel.decorateCoverageRow(row, productById.get(row.supplierProductId))).map(row => ({
        offerId: row.offerId,
        supplierCode: row.supplierCode,
        catalogNamespace: row.catalogNamespace,
        supplierProductCode: row.supplierProductCode,
        supplierOfferCode: row.supplierOfferCode,
        supplierOfferName: row.supplierOfferName,
        supplierMarketCode: row.supplierMarketCode,
        marketCoverageState: row.marketCoverageState,
        marketCoverageEvidenceCode: row.marketCoverageEvidenceCode,
        targetMarketEligible: row.targetMarketEligible,
        mappingStatus: row.mappingStatus,
        canonicalProductCode: row.canonicalProductCode,
        canonicalPackageCode: row.canonicalPackageCode,
        reconciliationState: row.reconciliationState,
        durableDisposition: row.durableDisposition,
        productionReady: row.productionReadiness?.ready === true,
        productionBlockers: row.productionReadiness?.blockers || ["CANONICAL_REVIEW_REQUIRED"],
        publicationState: row.publicationState,
        proposedProductionMutation: "NONE",
        nextReviewedAction: row.durableDisposition === "MAPPED" ? "NO_MAPPING_CHANGE" : row.targetMarketEligible ? "HUMAN_SEMANTIC_REVIEW" : "NO_TARGET_MAPPING_ACTION"
    })).sort((a, b) => `${a.supplierCode}/${a.supplierProductCode}/${a.supplierOfferCode}`.localeCompare(`${b.supplierCode}/${b.supplierProductCode}/${b.supplierOfferCode}`));
    const body = {
        artifactType: "GLOBAL_ASIA_COVERAGE_REVIEW",
        mode: "READ_ONLY_NO_PRODUCTION_MUTATIONS",
        generatedAt: new Date().toISOString(),
        source: "CURRENT_DURABLE_SUPPLIER_CATALOG",
        supplierTransactionalCalls: 0,
        productionWrites: 0,
        summary: { ...readModel.coverageSummary(offers), totalOffers: offers.length },
        offers
    };
    body.reviewedSourceSetHash = crypto.createHash("sha256").update(canonicalJson(body.offers)).digest("hex");
    const json = `${JSON.stringify(summaryOnly ? { ...body, offers: undefined } : body, null, 2)}\n`;
    if (outputPath) fs.writeFileSync(outputPath, json, { flag: "wx" });
    else process.stdout.write(json);
}

main().catch(error => { console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
