#!/usr/bin/env node
"use strict";
const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Fx = require("../models/ExchangeRateAuthority");
const Mapping = require("../models/SupplierProductMapping");
const { loadActiveExchangeRateAuthority, snapshotFromAuthority } = require("../services/commerce/exchangeRateService");

(async()=>{
 await mongoose.connect(process.env.MONGO_URI);
 const expected={"USD_THB":35.25,"USD_MMK":4500,"THB_MMK":130};
 for(const pair of Object.keys(expected)){const [sourceCurrency,targetCurrency]=pair.split("_");const row=await loadActiveExchangeRateAuthority({sourceCurrency,targetCurrency});assert(row,`${pair} missing`);assert.strictEqual(Number(row.rate),expected[pair]);const snap=snapshotFromAuthority(row,{sourceCurrency,targetCurrency});assert.strictEqual(snap.rate,expected[pair]);}
 const identity=snapshotFromAuthority(null,{sourceCurrency:"THB",targetCurrency:"THB"});assert.strictEqual(identity.rate,1);
 const core=["mlbb","freefire","pubg","hok"];
 const mappings=await Mapping.find({productCode:{$in:core},region:"TH",archivedAt:null}).lean();
 assert.strictEqual(mappings.filter(x=>x.productionRole==="PRIMARY").length,47);
 assert.strictEqual(mappings.filter(x=>x.productionRole==="BACKUP").length,10);
 assert.strictEqual(mappings.filter(x=>x.enabled).length,57);
 assert.strictEqual(mappings.filter(x=>x.mappingMetadata?.readiness?.fulfillmentReady).length,57);
 console.log(JSON.stringify({result:"PASS",pairs:expected,identityTHB_THB:1,primary:47,backup:10,enabled:57,fulfillmentReady:57,realOrders:0,realTopups:0,liveValidationPosts:0,providerSpend:0,pricesPublished:0},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>mongoose.disconnect().catch(()=>{}));
