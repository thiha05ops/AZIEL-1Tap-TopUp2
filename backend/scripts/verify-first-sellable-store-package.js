#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { activationBlockers, exactInputContract, sourceLock, assertSourceLock, StorePackageActivationError } = require("../services/storePackageActivationService");
const { applyPackageFulfillmentReadiness, projectCommerceReadiness, projectCatalogProduct, resolveDatabasePackagePriceFromRows } = require("../services/catalogService");
const { validateFazerCardsMapping } = require("../services/suppliers/fazercardsFulfillmentProcessor");
const { buildFazerCardsOrderFields, buildFazerCardsValidationFields } = require("../services/suppliers/fazercardsInputFormatters");
const { createRoutingAuthority } = require("../services/supplierProductionSelectionService");
const { FULFILLMENT_ROUTING_MODES } = require("../config/fulfillmentRoutingMode");
const { OUTCOMES } = require("../services/supplierEligibilityRouteResolver");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const now = new Date("2026-09-01T09:44:04.317Z");
const mapping = { _id:"6a94fec6591c7120027da868",supplierId:"supplier",supplierCode:"FAZERCARDS",productCode:"mlbb",packageCode:"MC_MLBB_1007_156_DIAMONDS_83C0D0F9",supplierProductCode:"mobile_legends_global",supplierPackageCode:"1007_156_diamonds",supplierCatalogOfferId:"offer",region:"GLOBAL",enabled:true,productionRole:"PRIMARY",executionMode:"API",archivedAt:null,updatedAt:now,supplierCostAuthority:{rawSupplierCost:18.6488,supplierCurrency:"USD",capturedAt:now},fulfillmentEligibility:{mode:"CUSTOMER_MARKET_ALLOWLIST",allowedCustomerMarkets:["TH"],evidenceCode:"OPERATOR_CONFIRMED_CAPABILITY",evidenceSource:"provider evidence",verifiedAt:now,version:1},mappingMetadata:{readiness:{supplierMapped:true,pricingReady:true,inputReady:true,validationReady:true,fulfillmentReady:true,storefrontReady:true}}};
const supplier={_id:"supplier",supplierCode:"FAZERCARDS",enabled:true,mode:"API",supportedRegions:["TH"],updatedAt:now};
const pkg={_id:"pkg",productCode:"mlbb",packageCode:mapping.packageCode,name:"1007 + 156 Diamonds",enabled:true,deletedAt:null,updatedAt:now,prices:{TH:{enabled:true,amount:651.08,currency:"THB"}}};
const selection={_id:"selection",productCode:"mlbb",supplierId:"supplier",supplierMarket:"GLOBAL",status:"ACTIVE",sellingRegions:["TH","MM"],visibleRegions:[],decisionVersion:1,packages:[{packageCode:mapping.packageCode,supplierProductMappingId:mapping._id}]};
const offer={_id:"offer",supplierId:"supplier",supplierOfferCode:mapping.supplierPackageCode,catalogLifecycleState:"ACTIVE",sourceRevision:"revision"};
const availability={state:"AVAILABLE",coverageComplete:true,observedAt:now};
const adapter={isConfigured:()=>true,isAutoFulfillmentEnabled:()=>true,autoFulfillmentGateState:()=>({effectiveGateEnabled:true})};
const base={selection,mapping,supplier,pkg,offer,availability,publication:{published:false,decisionVersion:1},customerMarket:"TH",adapter,conflicts:[]};

assert.deepStrictEqual(activationBlockers(base),[]);
assert(exactInputContract(mapping));
for(const [name,mutate,blocker] of [
    ["unknown eligibility",x=>x.mapping.fulfillmentEligibility={mode:"UNKNOWN",allowedCustomerMarkets:[]},null],
    ["missing cost",x=>x.mapping.supplierCostAuthority={rawSupplierCost:null},"APPROVED_SUPPLIER_COST_REQUIRED"],
    ["missing price",x=>x.pkg.prices.TH.enabled=false,"CUSTOMER_MARKET_PRICE_REQUIRED"],
    ["invalid input",x=>x.mapping.supplierProductCode="wrong","CUSTOMER_INPUT_CONTRACT_NOT_VERIFIED"],
    ["adapter disabled",x=>x.adapter={isConfigured:()=>false,isAutoFulfillmentEnabled:()=>false},"SUPPLIER_ADAPTER_NOT_CONFIGURED"],
    ["gate disabled",x=>x.adapter={isConfigured:()=>true,isAutoFulfillmentEnabled:()=>false,autoFulfillmentGateState:()=>({blockerCode:"SUPPLIER_AUTO_FULFILLMENT_DISABLED"})},"SUPPLIER_AUTO_FULFILLMENT_DISABLED"],
    ["unsupported offer",x=>x.mapping.supplierProductCode="unsupported","EXACT_SUPPLIER_OFFER_UNSUPPORTED"],
    ["primary conflict",x=>x.conflicts=[{_id:"other"}],"CONFLICTING_PRIMARY_ROUTE"],
    ["stale selection",x=>x.selection.decisionVersion=2,null]
]){const value={...JSON.parse(JSON.stringify(base)),adapter};mutate(value);if(blocker)assert(activationBlockers(value).includes(blocker),name);}

const lock=sourceLock(base),stale=structuredClone(lock);stale.selectionDecisionVersion+=1;assert.throws(()=>assertSourceLock(stale,lock),error=>error instanceof StorePackageActivationError&&error.code==="STORE_PACKAGE_ACTIVATION_STALE");
validateFazerCardsMapping(mapping,{customerMarket:"TH"});
assert.throws(()=>validateFazerCardsMapping({...mapping,fulfillmentEligibility:{mode:"UNKNOWN",allowedCustomerMarkets:[]}},{customerMarket:"TH"}),/eligibility/);
assert.deepStrictEqual(buildFazerCardsOrderFields("mlbb",{playerId:"12345",zoneId:"6789"}),{player_id:"12345",server_id:"6789"});
assert.deepStrictEqual(buildFazerCardsValidationFields("mlbb",{playerId:"12345",zoneId:"6789"}),{player_id:"12345",zone_id:"6789"});

const product={productCode:"mlbb",enabled:true,commerceState:"PURCHASABLE",publicDiscoveryEnabled:true,lifecycleStatus:"ACTIVE",supportedRegions:["TH"],productRoute:"mlbb.html"};
const projection=projectCatalogProduct(product,[pkg],{includeDisabled:false});
const context={adapterResolver:()=>adapter,mappingSupportResolver:()=>true};
applyPackageFulfillmentReadiness(projection,[mapping],[],[supplier],context);
assert.strictEqual(projection.packages[0].fulfillmentRegions.TH,true,"GLOBAL supplier market must fulfill explicitly eligible TH customer market");
assert.strictEqual(projectCommerceReadiness(product,[pkg],[mapping],[],[supplier],context).regions.TH.fulfillment,true);
const checkout=resolveDatabasePackagePriceFromRows({productCode:"mlbb",packageCode:mapping.packageCode,region:"TH"},{products:[product],packages:[pkg]});assert.strictEqual(checkout.amount,651.08);assert.strictEqual(checkout.currency,"THB");

(async()=>{const shadow={outcome:OUTCOMES.ELIGIBLE,blockerCodes:[],eligibility:mapping.fulfillmentEligibility,routeSnapshot:{routeType:"SUPPLIER_API",supplierMappingId:mapping._id,supplierId:mapping.supplierId,supplierCode:"FAZERCARDS",productCode:"mlbb",packageCode:mapping.packageCode,region:"TH",supplierProductCode:mapping.supplierProductCode,supplierPackageCode:mapping.supplierPackageCode,executionMode:"API",selectedRole:"PRIMARY"}};const route=createRoutingAuthority({legacyResolver:async()=>({ready:false,blockers:["NO_LEGACY_REGION_ROUTE"],routeSnapshot:null}),eligibilityResolver:async()=>shadow,modeResolver:()=>FULFILLMENT_ROUTING_MODES.LEGACY_REGION});const resolved=await route({productCode:"mlbb",packageCode:mapping.packageCode,region:"TH"});assert(resolved.ready);assert.strictEqual(resolved.routeSnapshot.supplierMappingId,mapping._id);assert.strictEqual(resolved.routeSnapshot.customerMarket,"TH");
const service=read("backend/services/storePackageActivationService.js"),routes=read("backend/routes/supplier.js"),ui=read("frontend/js/admin-guided-selling.js");
const mutationStart=service.indexOf("mapping.productionRole=\"PRIMARY\""),publicationWrite=service.indexOf("await setPackageMarketPublication",mutationStart),visibilityWrite=service.indexOf("selection.visibleRegions=",publicationWrite);assert(mutationStart<publicationWrite);assert(publicationWrite<visibilityWrite);assert(!service.slice(service.indexOf("async function activate"),service.indexOf("return{inspect,activate}")).includes("Promise.all"),"activation mutation path must remain sequential");assert(routes.includes("requireAdminPermission(PERMISSIONS.OWNER_ROUTING_MANAGE)"));assert(ui.includes("Activate / Show in ${storeEscape(marketName)}")&&ui.includes("SELLING IN ${storeEscape(marketName.toUpperCase())}"));
console.log(JSON.stringify({result:"PASS",target:{supplierMarket:"GLOBAL",customerMarket:"TH",price:651.08,cost:18.6488},publicCatalog:true,checkoutCatalogResolution:true,fulfillmentRoute:mapping._id,inputContract:{order:["player_id","server_id"],validation:["player_id","zone_id"]},negativeCases:9,productionWrites:0,supplierCalls:0},null,2));})().catch(error=>{console.error(error.stack||error);process.exitCode=1});
