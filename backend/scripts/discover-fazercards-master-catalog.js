#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const adapter = require("../services/suppliers/fazercardsAdapter");
const historical = require("../../docs/fazercards-sellable-catalog-audit.json");
const { classifySupplierMarket } = require("../services/supplierCatalog/supplierMarketCoveragePolicy");
const { canonicalJson, sanitizeSupplierCatalogSnapshot } = require("../services/supplierCatalog/supplierCatalogNormalization");

const outputArg = process.argv.find(value => value.startsWith("--output="));
const outputPath = outputArg ? path.resolve(process.cwd(), outputArg.slice(9)) : "";
const concurrency = 2;
const clean = value => String(value == null ? "" : value).trim();
const categoryRows = payload => payload?.items || payload?.categories || payload?.data?.categories || payload?.data || [];
const offerRows = payload => payload?.offers || payload?.data?.offers || payload?.data || [];
const sha = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");

function stableCategory(category) {
    return {
        categoryId: clean(category.category_id || category.id),
        name: clean(category.name),
        description: clean(category.description),
        notes: clean(category.notes || category.note),
        requiredFields: category.required_fields || category.fields || []
    };
}

function marketEvidence(category, prior) {
    const fresh = stableCategory(category);
    const priorStable = prior ? { categoryId: prior.category_id, name: clean(prior.display_name), description: clean(prior.description), notes: clean(prior.notes), requiredFields: prior.required_customer_inputs || [] } : null;
    const identityAndTextMatch = Boolean(priorStable && fresh.categoryId === priorStable.categoryId && fresh.name === priorStable.name && fresh.description === priorStable.description && fresh.notes === priorStable.notes);
    const supplierMarketCode = identityAndTextMatch ? clean(prior.region_context).toUpperCase() || "UNSPECIFIED" : "UNSPECIFIED";
    return { supplierMarketCode, evidenceCode: identityAndTextMatch ? "FRESH_PROVIDER_CATEGORY_MATCHES_AUTHENTICATED_MARKET_EVIDENCE" : "FRESH_MARKET_EVIDENCE_REVIEW_REQUIRED", historicalCategoryHash: prior ? sha(priorStable) : "", freshCategoryHash: sha(fresh) };
}

async function mapLimit(values, limit, fn) {
    const output = new Array(values.length);
    let cursor = 0;
    async function worker() { while (true) { const index = cursor++; if (index >= values.length) return; output[index] = await fn(values[index], index); } }
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
    return output;
}

async function readOffersWithBackoff(categoryId) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        try { return await adapter.getTopupOffers(categoryId); }
        catch (error) {
            if (error?.code !== "FAZERCARDS_HTTP_429" || attempt === 5) throw error;
            await new Promise(resolve => setTimeout(resolve, 35000));
        }
    }
    throw Object.assign(new Error(`FazerCards offer read retries exhausted for ${categoryId}.`), { code: "OFFER_READ_RETRIES_EXHAUSTED" });
}

async function readCategoriesWithBackoff(cursor) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        try { return await adapter.getTopupCategories(cursor); }
        catch (error) {
            if (error?.code !== "FAZERCARDS_HTTP_429" || attempt === 5) throw error;
            await new Promise(resolve => setTimeout(resolve, 35000));
        }
    }
    throw Object.assign(new Error("FazerCards category read retries exhausted."), { code: "CATEGORY_READ_RETRIES_EXHAUSTED" });
}

async function main() {
    let cursor = "", pages = 0, categories = [];
    do {
        const payload = await readCategoriesWithBackoff(cursor);
        pages += 1;
        categories.push(...categoryRows(payload));
        cursor = clean(payload?.meta?.next_cursor);
        if (pages > 50) throw Object.assign(new Error("FazerCards category pagination exceeded the safety limit."), { code: "CATEGORY_PAGE_LIMIT" });
    } while (cursor);
    const identities = categories.map(row => clean(row.category_id || row.id));
    if (identities.some(value => !value) || new Set(identities).size !== identities.length) throw Object.assign(new Error("FazerCards category identity set is malformed or duplicated."), { code: "CATEGORY_IDENTITY_INVALID" });
    const historicalById = new Map(historical.categories.map(row => [row.category_id, row]));
    const offerPayloads = await mapLimit(categories, concurrency, async category => {
        const categoryId = clean(category.category_id || category.id);
        const payload = await readOffersWithBackoff(categoryId);
        const rows = offerRows(payload);
        const ids = rows.map(row => clean(row.offer_id || row.id));
        if (ids.some(value => !value) || new Set(ids).size !== ids.length) throw Object.assign(new Error(`Offer identity set is malformed or duplicated for ${categoryId}.`), { code: "OFFER_IDENTITY_INVALID" });
        return { categoryId, rows, revision: clean(payload?.meta?.revision) };
    });
    const offersByCategory = new Map(offerPayloads.map(item => [item.categoryId, item]));
    const products = categories.map(category => {
        const categoryId = clean(category.category_id || category.id), prior = historicalById.get(categoryId), market = marketEvidence(category, prior), coverage = classifySupplierMarket({ supplierMarketCode: market.supplierMarketCode, supportState: prior?.class === "C_MANUAL_NOT_SUITABLE" ? "UNSUPPORTED" : "SUPPORTED" }), safe = sanitizeSupplierCatalogSnapshot(category);
        return { supplierProductCode: categoryId, displayName: clean(category.name), supplierMarketCode: market.supplierMarketCode, marketCoverageState: coverage.state, targetMarketEligible: coverage.targetEligible, marketEvidenceCode: market.evidenceCode, restrictions: prior?.explicit_region_restrictions || [], requiredCustomerInputs: prior?.required_customer_inputs || [], deliveryClass: prior?.delivery_class || "UNKNOWN", supportState: prior?.class === "C_MANUAL_NOT_SUITABLE" ? "UNSUPPORTED" : "SUPPORTED", sourceCategoryHash: sha(stableCategory(category)), historicalCategoryHash: market.historicalCategoryHash, rawSnapshotHash: sha(safe.snapshot), rawSnapshot: safe.snapshot };
    });
    const productByCode = new Map(products.map(product => [product.supplierProductCode, product]));
    const offers = offerPayloads.flatMap(item => item.rows.map(row => {
        const safe = sanitizeSupplierCatalogSnapshot(row), product = productByCode.get(item.categoryId), amount = Number(row.price_usd);
        return { supplierProductCode: item.categoryId, supplierOfferCode: clean(row.offer_id || row.id), supplierOfferName: clean(row.name), supplierMarketCode: product.supplierMarketCode, marketCoverageState: product.marketCoverageState, targetMarketEligible: product.targetMarketEligible, supplierCost: Number.isFinite(amount) && amount >= 0 ? { amount, currency: "USD" } : null, restrictions: product.restrictions, requiredCustomerInputs: product.requiredCustomerInputs, sourceRevision: item.revision, rawSnapshotHash: sha(safe.snapshot), rawSnapshot: safe.snapshot };
    }));
    const removedHistoricalCategories = historical.categories.map(row => row.category_id).filter(id => !productByCode.has(id)).sort();
    const report = { artifactType: "FAZERCARDS_CURRENT_MASTER_CATALOG_SOURCE", generatedAt: new Date().toISOString(), mode: "READ_ONLY_SUPPLIER_DISCOVERY", completeness: "COMPLETE_CATEGORY_AND_OFFER_ENUMERATION", categoryPages: pages, products, offers, removedHistoricalCategories, sourceSetHash: sha({ products: products.map(({ rawSnapshot: _raw, ...rest }) => rest), offers: offers.map(({ rawSnapshot: _raw, ...rest }) => rest) }), safety: { supplierCatalogCalls: pages + categories.length, balanceCalls: 0, validationCalls: 0, orderCalls: 0, statusCalls: 0, fulfillmentCalls: 0, supplierWrites: 0, databaseWrites: 0 } };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (outputPath) fs.writeFileSync(outputPath, json, { flag: "wx" });
    else process.stdout.write(JSON.stringify({ artifactType: report.artifactType, generatedAt: report.generatedAt, completeness: report.completeness, categoryPages: pages, products: products.length, offers: offers.length, marketProducts: products.reduce((out, row) => (out[row.marketCoverageState] = (out[row.marketCoverageState] || 0) + 1, out), {}), marketOffers: offers.reduce((out, row) => (out[row.marketCoverageState] = (out[row.marketCoverageState] || 0) + 1, out), {}), removedHistoricalCategories, sourceSetHash: report.sourceSetHash, safety: report.safety }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; });
