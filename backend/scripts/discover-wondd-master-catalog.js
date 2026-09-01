#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const adapter = require("../services/suppliers/wonddAdapter");
const service = require("../services/supplierCatalog/providers/wonddCatalogIngestionService");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");

const outputArg = process.argv.find(value => value.startsWith("--output="));
const outputPath = outputArg ? path.resolve(process.cwd(), outputArg.slice(9)) : "";
const sha = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");

async function main() {
    const stage = await service.stageCatalog({ reader: service.createCatalogReader(adapter), supplierId: "000000000000000000000000", mappings: [], observedAt: new Date() });
    if (stage.errors.length || stage.rowsObserved !== stage.validRows || stage.offers.length !== stage.validRows) throw Object.assign(new Error("WonDD source enumeration was malformed or incomplete."), { code: "WONDD_SOURCE_INVALID", details: stage.errors });
    const products = stage.products.map(row => ({ supplierProductCode: row.supplierProductCode, displayName: row.displayName, supplierMarketCode: row.supplierMarketCode, supportState: row.supportState, metadata: row.metadata, normalizedInputContract: row.normalizedInputContract, rawSnapshotHash: row.rawSnapshotHash, rawSnapshot: row.rawSnapshot }));
    const offers = stage.offers.map(row => ({ supplierProductCode: row.supplierProductCode, supplierOfferCode: row.supplierOfferCode, supplierOfferName: row.supplierOfferName, supplierMarketCode: "UNSPECIFIED", marketCoverageState: "UNKNOWN_MARKET", targetMarketEligible: false, supplierCost: row.supplierCost, rawSemantics: row.rawSemantics, normalizedSemantics: row.normalizedSemantics, rawSnapshotHash: row.rawSnapshotHash, rawSnapshot: row.rawSnapshot }));
    const report = { artifactType: "WONDD_CURRENT_MASTER_CATALOG_SOURCE", generatedAt: new Date().toISOString(), mode: "READ_ONLY_SUPPLIER_DISCOVERY", completeness: stage.completenessEvidence || "PARTIAL_COMPLETENESS_UNPROVEN", coverageState: stage.coverageState, products, offers, contentRevision: stage.contentRevision, sourceSetHash: sha({ products: products.map(({ rawSnapshot: _raw, ...rest }) => rest), offers: offers.map(({ rawSnapshot: _raw, ...rest }) => rest) }), safety: { supplierCatalogCalls: 1, balanceCalls: 0, validationCalls: 0, orderCalls: 0, statusCalls: 0, fulfillmentCalls: 0, supplierWrites: 0, databaseWrites: 0 } };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (outputPath) fs.writeFileSync(outputPath, json, { flag: "wx" });
    else process.stdout.write(JSON.stringify({ artifactType: report.artifactType, generatedAt: report.generatedAt, completeness: report.completeness, coverageState: report.coverageState, products: products.length, offers: offers.length, contentRevision: report.contentRevision, sourceSetHash: report.sourceSetHash, safety: report.safety }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message, details: error.details || {} }, null, 2)); process.exitCode = 1; });
