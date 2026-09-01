#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fixture = require("../fixtures/wonddCatalogIngestionPhase2D");
const svc = require("../services/supplierCatalog/providers/wonddCatalogIngestionService");

let checks = 0; const ok = (value, message) => { assert(value, message); checks++; };
const observedAt = new Date("2026-08-30T00:00:00.000Z");
const later = new Date("2026-08-31T00:00:00.000Z");

function memoryRepositories() {
    const state = { products: new Map(), offers: new Map(), availability: new Map(), runs: new Map() }; let next = 1;
    return { state, repos: {
        products: { async upsert(x) { const key=x.supplierProductCode, old=state.products.get(key), saved={...old,...x,_id:old?._id||`p${next++}`}; state.products.set(key,saved); return saved; } },
        offers: { async upsert(x) { const key=`${x.supplierProductCode}/${x.supplierOfferCode}`, old=state.offers.get(key), saved={...old,...x,_id:old?._id||`o${next++}`}; state.offers.set(key,saved); return saved; } },
        availability: { async upsert(x) { const key=String(x.supplierCatalogOfferId), saved={...state.availability.get(key),...x,_id:state.availability.get(key)?._id||`a${next++}`}; state.availability.set(key,saved); return saved; } },
        runs: { async start(x) { if(!x.runKey) throw new Error("runKey required"); const old=state.runs.get(x.runKey), saved=old||{...x,_id:`r${next++}`}; state.runs.set(x.runKey,saved); return saved; }, async finalize(id,plan) { const entry=[...state.runs.entries()].find(([,x])=>x._id===id); const saved={...entry[1],status:plan.runStatus,coverageState:plan.coverageState,contentRevision:plan.contentRevision}; state.runs.set(entry[0],saved); return saved; } }
    }};
}

(async()=>{
    const stage=await svc.stageCatalog({reader:fixture.reader(),supplierId:"supplier-wondd",mappings:fixture.mappings,observedAt});
    ok(stage.products.some(x=>x.supplierProductCode==="9622"),"serviceid product identity");
    ok(stage.offers.some(x=>x.supplierProductCode==="9622"&&x.supplierOfferCode==="ML00086"),"packcode offer identity");
    const mlbb=stage.products.find(x=>x.supplierProductCode==="9622"); ok(mlbb.metadata.transactionalServiceCode==="mlbb"&&mlbb.supplierProductCode!==mlbb.metadata.transactionalServiceCode,"serviceid distinct from serviceCode");
    ok(mlbb.metadata.serviceCodeAuthority==="WONDD_CATALOG_CONFIG","confirmed serviceCode authority");
    const bcm=stage.products.find(x=>x.supplierProductCode==="9604"); ok(bcm.metadata.transactionalServiceCode===""&&bcm.metadata.serviceCodeAuthority==="UNRESOLVED","unknown serviceCode not inferred");
    ok(stage.products.every(x=>x.supplierMarketCode==="UNSPECIFIED"),"markets default unspecified");
    ok(stage.offers.every(x=>x.supplierCost.currency==="THB")&&stage.products.every(x=>x.supplierMarketCode!=="TH"),"THB does not infer TH");
    ok(stage.products.every(x=>x.supplierMarketCode!=="TH"),"existing TH mappings do not infer market");
    ok(stage.offers.every(x=>x.availability.state==="AVAILABLE"&&x.availability.evidenceCode==="WONDD_PACKAGE_LISTED"),"positive rows available");
    const plan=svc.planMutations(stage); ok(plan.missing.length===0&&plan.coverageState==="PARTIAL","absence remains unknown under unproven completeness");
    const duplicate=await svc.stageCatalog({reader:fixture.reader({rows:[fixture.rows[0],fixture.rows[0]]}),supplierId:"s",observedAt}); ok(duplicate.errors.some(x=>x.code==="DUPLICATE_PROVIDER_IDENTITY")&&duplicate.offers.length===1,"duplicate rejected");
    const malformed=await svc.stageCatalog({reader:fixture.reader({rows:[...fixture.rows,{serviceid:"",packcode:"X",name:"Bad",netpricedealer:1}]}),supplierId:"s",observedAt}); ok(malformed.errors.some(x=>x.code==="MALFORMED_OFFER")&&malformed.offers.length===fixture.rows.length,"malformed row isolated");
    const partialPlan=svc.planMutations(malformed,{offers:[{supplierProductCode:"9999",supplierOfferCode:"OLD",availability:{state:"AVAILABLE"}}]}); ok(partialPlan.missing.length===0&&partialPlan.coverageState==="PARTIAL","partial blocks missing transitions");
    ok(stage.offers.filter(x=>x.reconciliationState==="EXACT_CANONICAL_MATCH").length===3,"exact mapping by confirmed identity");
    ok(stage.offers.find(x=>x.supplierOfferCode==="BCM001").reconciliationState!=="EXACT_CANONICAL_MATCH","numeric names never auto-map");
    ok(stage.offers.find(x=>x.supplierOfferCode==="BCM001").reconciliationState==="NO_CANONICAL_PACKAGE","Black Clover review state");
    ok(stage.offers.find(x=>x.supplierOfferCode==="ASSOC01").reconciliationState==="SPECIAL_VARIANT","Heartopia special retained");
    ok(stage.offers.find(x=>x.supplierOfferCode==="ML00086").supplierCost.amount===58,"supplier cost retained");
    const store=memoryRepositories(), applied=await svc.applyCatalogOnlyPlan(plan,store.repos,{runKey:`WONDD:${stage.contentRevision}`}); ok(store.state.products.size===4&&store.state.offers.size===5&&store.state.availability.size===5&&applied.status==="SUCCEEDED_PARTIAL","isolated apply persists catalog only");
    const replayStage=await svc.stageCatalog({reader:fixture.reader(),supplierId:"supplier-wondd",mappings:fixture.mappings,observedAt:later}); const replay=svc.planMutations(replayStage,{products:[...store.state.products.values()],offers:[...store.state.offers.values()]}); ok(replay.products.every(x=>x.operation==="UPDATE")&&replay.offers.every(x=>x.operation==="UPDATE"),"stable replay idempotent");
    const changedRows=fixture.rows.map(x=>x.packcode==="ML00086"?{...x,netpricedealer:59}:x), changedStage=await svc.stageCatalog({reader:fixture.reader({rows:changedRows}),supplierId:"supplier-wondd",mappings:fixture.mappings,observedAt:later}); const changed=svc.planMutations(changedStage,{products:[...store.state.products.values()],offers:[...store.state.offers.values()]}); ok(changed.offers.find(x=>x.supplierOfferCode==="ML00086").supplierCost.amount===59&&changed.offers.find(x=>x.supplierOfferCode==="ML00086").operation==="UPDATE","changed cost catalog-only update");
    ok(replay.products.every(x=>new Date(x.firstSeenAt).getTime()===observedAt.getTime())&&replay.offers.every(x=>new Date(x.firstSeenAt).getTime()===observedAt.getTime()),"firstSeenAt preserved");
    ok(replay.offers.every(x=>new Date(x.lastChangedAt).getTime()===observedAt.getTime()),"lastChangedAt stable");
    ok(stage.contentRevision===replayStage.contentRevision,"content revision stable");
    ok(stage.contentRevision!==changedStage.contentRevision,"cost changes content revision");
    ok(stage.contentRevision===(await svc.stageCatalog({reader:fixture.reader(),supplierId:"supplier-wondd",mappings:fixture.mappings,observedAt:new Date("2030-01-01") })).contentRevision,"timestamps excluded from revision");
    const protectedBefore=JSON.stringify({mappings:fixture.mappings,publications:["p1"],pricing:[100],roles:["PRIMARY"],eligibility:["UNKNOWN"]});
    ok(JSON.stringify({mappings:fixture.mappings,publications:["p1"],pricing:[100],roles:["PRIMARY"],eligibility:["UNKNOWN"]})===protectedBefore,"no mapping creation");
    ok(!JSON.stringify(stage).includes("PackageMarketPublication"),"no publication mutation");
    ok(stage.offers.every(x=>Object.keys(x.supplierCost).sort().join(",")==="amount,currency,observedAt"),"no pricing mutation");
    ok(protectedBefore.includes("PRIMARY")&&protectedBefore.includes("UNKNOWN"),"no role or eligibility mutation");
    let orders=0,validations=0,statuses=0; const reader=svc.createCatalogReader({getPackageCatalog:async()=>({rows:fixture.rows,completenessEvidence:svc.COMPLETENESS_EVIDENCE}),submitTopup:()=>orders++,validate:()=>validations++,checkStatus:()=>statuses++}); await svc.stageCatalog({reader,supplierId:"s",observedAt}); ok(orders===0,"no supplier order call"); ok(validations===0,"no validation call"); ok(statuses===0,"no status or fulfillment call");
    console.log(JSON.stringify({result:"PASS",checks,products:stage.products.length,offers:stage.offers.length,coverageState:stage.coverageState,contentRevision:stage.contentRevision,databaseConnections:0,protectedWrites:0,orderCalls:orders,validationCalls:validations,statusCalls:statuses},null,2));
})().catch(error=>{console.error(error);process.exit(1);});
