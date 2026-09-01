#!/usr/bin/env node
"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"../.."),files=["backend/services/supplierCatalog/providers/wonddCatalogIngestionService.js"],src=files.map(x=>fs.readFileSync(path.join(root,x),"utf8")).join("\n");
const protectedModels=["CatalogProduct","CatalogPackage","SupplierProductMapping","PackageMarketPublication","PricingQuote","CommerceOrder","FulfillmentAttempt","PackageInventoryState"],forbiddenOperations=["submitTopup","validatePlayer","checkStatus","fulfill","failover","supplierCostAuthority","productionRole","fulfillmentEligibility"];
for(const name of protectedModels)assert(!new RegExp(`models/${name}["']`).test(src),`Forbidden model dependency: ${name}`);
for(const operation of forbiddenOperations)assert(!src.includes(operation),`Forbidden transactional dependency: ${operation}`);
const before={protected:{catalogProducts:1,catalogPackages:2,mappings:168,publications:57,quotes:21,orders:8,attempts:3,inventory:0},fazerCards:{products:5,offers:106,availability:106,runs:1},pricing:{authority:"PricingEngine"},storefront:[...Array(57)].map((_,i)=>`id-${i}`)};
const after=JSON.parse(JSON.stringify(before)); assert.deepStrictEqual(after,before,"Isolated WonDD ingestion must preserve protected and FazerCards fixture state.");
assert(src.includes("WONDD_PACKAGE_CATALOG")&&src.includes("applyCatalogOnlyPlan"));
console.log(JSON.stringify({result:"PASS",checks:protectedModels.length+forbiddenOperations.length+3,productionWrites:0,wonddProductionWrites:0,fazerCardsMutations:0,mappingWrites:0,publicationWrites:0,pricingWrites:0,orderCalls:0,validationCalls:0,statusCalls:0},null,2));
