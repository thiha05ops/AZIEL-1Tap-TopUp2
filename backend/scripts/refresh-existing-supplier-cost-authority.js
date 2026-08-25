#!/usr/bin/env node
"use strict";
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const crypto = require("crypto");
const fetch = require("node-fetch");
const mongoose = require("mongoose");
const Mapping = require("../models/SupplierProductMapping");
const fazer = require("../services/suppliers/fazercardsAdapter");
const wondd = require("../services/suppliers/wonddAdapter");
const { WONDD_FAMILIES } = require("../services/suppliers/wonddCatalogConfig");
const APPLY = process.argv.includes("--apply");
const clean = value => String(value == null ? "" : value).trim();
const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function wonddCatalog() {
    const response = await fetch("https://www.wondd.com/member/bot-game-packlist.php", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: clean(process.env.WONDD_USERNAME), password: clean(process.env.WONDD_PASSWORD) }).toString() });
    if (!response.ok) throw new Error(`WonDD catalog HTTP ${response.status}`);
    const rows = await response.json(); if (!Array.isArray(rows)) throw new Error("WonDD catalog shape invalid"); return rows;
}
async function main() {
    if (["mlbb", "freefire"].some(product => wondd.isAutoFulfillmentEnabled(product))) throw new Error("WonDD gates must be OFF during cost refresh.");
    if (["pubg", "mlbb", "freefire", "hok", "valorant"].some(product => fazer.isAutoFulfillmentEnabled(product))) throw new Error("FazerCards gates must be OFF during cost refresh.");
    const [wb, fb, wr] = await Promise.all([wondd.getBalance(), fazer.getBalance(), wonddCatalog()]);
    await mongoose.connect(process.env.MONGO_URI);
    const mappings = await Mapping.find({ supplierCode: { $in: ["WONDD", "FAZERCARDS"] }, archivedAt: null }).lean();
    const categories = [...new Set(mappings.filter(x => x.supplierCode === "FAZERCARDS").map(x => x.supplierProductCode))];
    const fazerOffers = new Map();
    for (const category of categories) {
        const payload = await fazer.getTopupOffers(category); fazerOffers.set(category, new Map((payload.offers || []).map(x => [clean(x.offer_id), x])));
    }
    const wonddOffers = new Map(wr.map(row => [`${row.serviceid}:${clean(row.packcode)}`, row]));
    const updates = [];
    for (const mapping of mappings) {
        let raw; let currency; let source; let evidence;
        if (mapping.supplierCode === "FAZERCARDS") {
            const offer = fazerOffers.get(mapping.supplierProductCode)?.get(mapping.supplierPackageCode);
            if (!offer) throw new Error(`Current FazerCards offer missing: ${mapping.supplierProductCode}/${mapping.supplierPackageCode}`);
            raw = Number(offer.price_usd); currency = "USD"; source = "FAZERCARDS_LIVE_API"; evidence = { category: mapping.supplierProductCode, offer: mapping.supplierPackageCode, price_usd: offer.price_usd };
        } else {
            const family = Object.entries(WONDD_FAMILIES).find(([, value]) => value.productCode === mapping.productCode && value.serviceCode.toLowerCase() === clean(mapping.supplierProductCode).toLowerCase());
            if (!family) throw new Error(`WonDD service authority missing: ${mapping.productCode}/${mapping.supplierProductCode}`);
            const offer = wonddOffers.get(`${family[0]}:${mapping.supplierPackageCode}`);
            if (!offer) throw new Error(`Current WonDD pack missing: ${family[0]}/${mapping.supplierPackageCode}`);
            raw = Number(offer.netpricedealer); currency = "THB"; source = "WONDD_LIVE_PACKLIST"; evidence = { serviceid: family[0], servicecode: family[1].serviceCode, packcode: mapping.supplierPackageCode, netpricedealer: offer.netpricedealer };
        }
        if (!Number.isFinite(raw) || raw < 0) throw new Error(`Invalid provider cost: ${mapping.supplierCode}/${mapping.supplierPackageCode}`);
        const storedRaw = Number(mapping.supplierCostAuthority?.rawSupplierCost);
        updates.push({ mapping, raw, currency, source, evidenceHash: sha(evidence), storedRaw: Number.isFinite(storedRaw) ? storedRaw : null, drift: !Number.isFinite(storedRaw) || Math.abs(storedRaw - raw) > 0.000001 });
    }
    const capturedAt = new Date();
    if (APPLY) {
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            for (const item of updates) await Mapping.updateOne({ _id: item.mapping._id, archivedAt: null, supplierProductCode: item.mapping.supplierProductCode, supplierPackageCode: item.mapping.supplierPackageCode }, { $set: { supplierCostAuthority: { rawSupplierCost: item.raw, supplierCurrency: item.currency, capturedAt, source: item.source, providerProductCode: item.mapping.supplierProductCode, providerOfferCode: item.mapping.supplierPackageCode, fundingCost: Number(item.mapping.supplierCostAuthority?.fundingCost || 0), otherAcquisitionCost: Number(item.mapping.supplierCostAuthority?.otherAcquisitionCost || 0) }, "mappingMetadata.costAuthorityEvidence": { source: item.source, capturedAt, evidenceHash: item.evidenceHash, responseBodyPersisted: false } } }, { session });
        }); await session.endSession();
    }
    await mongoose.disconnect();
    const [wa, fa] = await Promise.all([wondd.getBalance(), fazer.getBalance()]);
    console.log(JSON.stringify({ result: "PASS", apply: APPLY, refreshed: updates.length, costMatches: updates.filter(x=>!x.drift).length, costDrift: updates.filter(x=>x.drift).map(x=>({ supplier:x.mapping.supplierCode, product:x.mapping.productCode, packageCode:x.mapping.packageCode, providerOffer:x.mapping.supplierPackageCode, stored:x.storedRaw, current:x.raw })), bySupplier: { WONDD: updates.filter(x=>x.mapping.supplierCode==="WONDD").length, FAZERCARDS: updates.filter(x=>x.mapping.supplierCode==="FAZERCARDS").length }, capturedAt: APPLY ? capturedAt : null, balances: { wonddBefore: wb.rawMetadata.balance, wonddAfter: wa.rawMetadata.balance, fazerBefore: fb.rawMetadata.balance, fazerAfter: fa.rawMetadata.balance }, providerSpend: { WONDD: Number(wb.rawMetadata.balance)-Number(wa.rawMetadata.balance), FAZERCARDS: Number(fb.rawMetadata.balance)-Number(fa.rawMetadata.balance) }, orderCalls: 0, validationCalls: 0 }, null, 2));
}
main().catch(async error => { await mongoose.disconnect().catch(()=>null); console.error(JSON.stringify({ result: "FAIL", message: error.message })); process.exitCode=1; });
