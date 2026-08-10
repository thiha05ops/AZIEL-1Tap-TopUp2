require("dotenv").config();
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Campaign = require("../models/Campaign");
const HomeBanner = require("../models/HomeBanner");
const { hasKnowledgeContent, normalizeProductKnowledge, normalizeCustomerNoteLocales } = require("../catalog/productKnowledge");
const { normalizeCampaignLocales, normalizeTextLocales } = require("../catalog/localizedContent");

function changed(before, after) {
    return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}

async function buildPlan() {
    const [products, packages, campaigns, banners] = await Promise.all([
        CatalogProduct.find({}).select("productCode productKnowledge").lean(),
        CatalogPackage.find({ customerNote: { $type: "string", $ne: "" } }).select("productCode packageCode customerNote customerNoteLocales").lean(),
        Campaign.find({}).select("campaignCode title body ctaLabel locales").lean(),
        HomeBanner.find({}).select("name ctaLabel ctaLabelLocales").lean()
    ]);
    const operations = [];
    products.forEach(product => {
        const value = normalizeProductKnowledge(product.productKnowledge || {});
        if (!hasKnowledgeContent(value.locales.en)) return;
        if (changed(product.productKnowledge?.locales, value.locales)) operations.push({ model: CatalogProduct, id: product._id, label: `CatalogProduct:${product.productCode}`, field: "productKnowledge.locales", value: value.locales });
    });
    packages.forEach(pkg => {
        const value = normalizeCustomerNoteLocales(pkg.customerNoteLocales, pkg.customerNote);
        if (changed(pkg.customerNoteLocales, value)) operations.push({ model: CatalogPackage, id: pkg._id, label: `CatalogPackage:${pkg.productCode}/${pkg.packageCode}`, field: "customerNoteLocales", value });
    });
    campaigns.forEach(campaign => {
        const value = normalizeCampaignLocales(campaign.locales, campaign);
        if (changed(campaign.locales, value)) operations.push({ model: Campaign, id: campaign._id, label: `Campaign:${campaign.campaignCode}`, field: "locales", value });
    });
    banners.forEach(banner => {
        const value = normalizeTextLocales(banner.ctaLabelLocales, banner.ctaLabel, "ctaLabelLocales", 40);
        if (changed(banner.ctaLabelLocales, value)) operations.push({ model: HomeBanner, id: banner._id, label: `HomeBanner:${banner.name}`, field: "ctaLabelLocales", value });
    });
    return operations;
}

async function run({ apply = false } = {}) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGO_URI or MONGODB_URI is required.");
    mongoose.set("autoIndex", false);
    await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
    try {
        const operations = await buildPlan();
        const report = { dryRun: !apply, count: operations.length, records: operations.map(item => ({ record: item.label, field: item.field })) };
        if (!apply || !operations.length) return report;
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                for (const operation of operations) {
                    await operation.model.updateOne({ _id: operation.id }, { $set: { [operation.field]: operation.value } }, { session });
                }
            });
        } finally {
            await session.endSession();
        }
        return { ...report, dryRun: false, applied: operations.length };
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    run({ apply: process.argv.includes("--apply") })
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}

module.exports = { buildPlan, run };
