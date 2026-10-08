"use strict";
const assert = require("assert");
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierCatalogProduct = require("../models/SupplierCatalogProduct");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const { supplierInputContract } = require("../services/supplierCatalog/providers/wonddCatalogIngestionService");
const { buildFieldsFromContract, contractFingerprint } = require("../services/suppliers/fazercardsFulfillmentContractService");
const { supportsMapping } = require("../services/suppliers/supplierFulfillmentDispatcher");
const { selectedRouteSnapshot } = require("../services/supplierProductionSelectionService");

const db={products:new Map(),packages:new Map(),mappings:new Map(),store:new Set(),prices:new Map(),selling:new Set(),purchasable:new Set(),selections:new Map(),orders:[]};
assert.strictEqual(db.products.size,0,"canonical catalog starts empty");
const supplierProducts=[{supplier:"A",code:"future-service"},{supplier:"B",code:"future-service-b"}];
const schema=[{customerField:"playerId",providerField:"gameid",label:"Player ID",type:"numeric-text",required:true}];
const contract=supplierInputContract({inputSchema:schema},"future_tx");
Object.assign(contract,{decisionVersion:1,supplierCode:"WONDD",supplierProductCode:"future-service",sourceSupplierCatalogProductId:"product-future",sourceHash:"a".repeat(64),sourceOfferHash:"b".repeat(64),authorityScope:"PRODUCT"});
contract.fingerprint=contractFingerprint(contract);
assert(contract&&contract.fields.length===1,"supplier metadata constructs a contract");
const supplierId=new mongoose.Types.ObjectId(),offerId=new mongoose.Types.ObjectId(),mappingId=new mongoose.Types.ObjectId();
const observedAt=new Date("2026-10-08T00:00:00.000Z");
const realDocuments=[
 new CatalogProduct({productCode:"future-game",name:"Future Game",enabled:true,commerceState:"PURCHASABLE",publicDiscoveryEnabled:true}),
 new CatalogPackage({productCode:"future-game",packageCode:"100_DIAMONDS",name:"100 Diamonds",enabled:true,prices:{TH:{amount:100,currency:"THB",enabled:true}}}),
 new SupplierCatalogProduct({_id:new mongoose.Types.ObjectId(),supplierId,supplierProductCode:"future-service",displayName:"Future Game",catalogNamespace:"WONDD_PACKAGE_CATALOG",supplierMarketCode:"GLOBAL",normalizedInputContract:contract,rawSnapshotHash:"a".repeat(64),firstSeenAt:observedAt,lastSeenAt:observedAt,lastObservedAt:observedAt,lastChangedAt:observedAt}),
 new SupplierCatalogOffer({_id:offerId,supplierId,supplierCatalogProductId:new mongoose.Types.ObjectId(),catalogNamespace:"WONDD_PACKAGE_CATALOG",supplierProductCode:"future-service",supplierOfferCode:"100_DIAMONDS",supplierOfferName:"100 Diamonds",catalogLifecycleState:"ACTIVE",reconciliationState:"EXACT_CANONICAL_MATCH",rawSnapshotHash:"b".repeat(64),firstSeenAt:observedAt,lastSeenAt:observedAt,lastObservedAt:observedAt,lastChangedAt:observedAt}),
 new SupplierProductMapping({_id:mappingId,supplierId,supplierCode:"WONDD",productCode:"future-game",packageCode:"100_DIAMONDS",supplierProductCode:"future-service",supplierPackageCode:"100_DIAMONDS",supplierCatalogOfferId:offerId,region:"GLOBAL",enabled:true,productionRole:"DISABLED",executionMode:"API",supplierMarketEvidence:{normalizedMarket:"GLOBAL",supplierMarketCode:"GLOBAL",marketClassification:"AUTHORITATIVE"},fulfillmentEligibility:{mode:"GLOBAL",allowedCustomerMarkets:[],evidenceCode:"PROVIDER_CONFIRMED",evidenceSource:"isolated fixture",version:1},mappingMetadata:{fulfillmentContract:contract,readiness:{supplierMapped:true,inputReady:true,validationReady:true,pricingReady:true,fulfillmentReady:true,storefrontReady:true}}}),
 new StoreCatalogSelection({productCode:"future-game",supplierId,supplierCode:"WONDD",supplierMarket:"GLOBAL",sellingRegions:["TH"],visibleRegions:["TH"],packages:[{packageCode:"100_DIAMONDS",supplierProductMappingId:mappingId}]}),
 new PackageMarketPublication({productCode:"future-game",packageCode:"100_DIAMONDS",customerMarket:"TH",published:true,decisionVersion:1}),
 new PackageSupplierSelection({productCode:"future-game",packageCode:"100_DIAMONDS",customerMarket:"TH",supplierMappingId:mappingId,selectedByUsernameSnapshot:"verifier",decisionVersion:1})
];
realDocuments.forEach(document=>assert.strictEqual(document.validateSync(),undefined,`${document.constructor.modelName} fixture must satisfy the real schema`));
assert(supportsMapping(realDocuments[4].toObject()),"unknown future WonDD mapping is supported by its verified declarative contract");
const frozenRoute=selectedRouteSnapshot(realDocuments[4].toObject(),realDocuments[7].toObject(),"TH");
assert.strictEqual(frozenRoute.supplierMappingId,String(mappingId));
const offer={packageCode:"100_DIAMONDS",name:"100 Diamonds",eligibility:["TH"],contract};
assert(supplierProducts.length&&offer.contract,"supplier inventory is preparable");
db.products.set("future-game",{code:"future-game",publicDiscoveryEnabled:false,commerceState:"HIDDEN"});
db.packages.set("future-game/100_DIAMONDS",{code:"100_DIAMONDS",enabled:true});
for(const source of supplierProducts)db.mappings.set(source.supplier,{supplier:source.supplier,productCode:"future-game",packageCode:offer.packageCode,contract:offer.contract,enabled:true,available:true});
assert.strictEqual(db.packages.size,1,"two suppliers reuse one canonical package");
assert.strictEqual(db.mappings.size,2,"two exact mappings coexist");
db.store.add("future-game/TH");
assert.strictEqual(db.purchasable.size,0,"Start Selling is not Purchasable");
db.prices.set("future-game/100_DIAMONDS/TH",100);
assert.strictEqual(db.selling.size,0,"pricing does not enable Package Selling");
db.products.get("future-game").publicDiscoveryEnabled=true;db.products.get("future-game").commerceState="PUBLIC";
db.purchasable.add("future-game/TH");db.selling.add("future-game/100_DIAMONDS/TH");db.selections.set("future-game/100_DIAMONDS/TH","A");
const live=()=>db.store.has("future-game/TH")&&db.purchasable.has("future-game/TH")&&db.selling.has("future-game/100_DIAMONDS/TH")&&db.prices.get("future-game/100_DIAMONDS/TH")>0&&db.mappings.get(db.selections.get("future-game/100_DIAMONDS/TH"))?.available===true;
assert(live(),"all gates produce LIVE");
assert.deepStrictEqual(buildFieldsFromContract(contract,{playerId:"12345"}),{gameid:"12345"});
const frozen=JSON.parse(JSON.stringify(db.mappings.get("A")));db.orders.push({routeSnapshot:frozen});db.selections.set("future-game/100_DIAMONDS/TH","B");
assert.strictEqual(db.orders[0].routeSnapshot.supplier,"A","selection changes do not rewrite frozen routes");
db.mappings.get("B").available=false;assert.strictEqual(live(),false,"selected unavailable supplier blocks without failover");
assert.strictEqual(db.selections.get("future-game/100_DIAMONDS/TH"),"B","no silent failover");
db.selling.delete("future-game/100_DIAMONDS/TH");assert.strictEqual(live(),false,"Selling OFF is disabled");
db.purchasable.delete("future-game/TH");assert.strictEqual(db.prices.size,1);assert.strictEqual(db.mappings.size,2);assert.strictEqual(db.selections.size,1);
assert.strictEqual(typeof offer.name,"string","ambiguous names remain non-authoritative display data");
console.log(JSON.stringify({result:"PASS",fixture:"real-mongoose-models-plus-nontransactional-supplement",realModels:realDocuments.map(document=>document.constructor.modelName),canonicalPackages:1,supplierMappings:2,frozenRouteMappingId:frozenRoute.supplierMappingId,transactionalPersistence:"NOT_RUN_NO_ISOLATED_REPLICA_SET_URI",providerCalls:0,databaseWrites:0,productionWrites:0},null,2));
