#!/usr/bin/env node
"use strict";
const assert=require("assert");const {calculateBasePrice}=require("../services/commerce/pricingCalculationEngine");
const calc=(landed,profitRule,minimumProfitAmount=0,maximumProfitAmount=null,packageProfitOverride={mode:"INHERIT",value:null})=>calculateBasePrice({supplierCost:landed,supplierCurrency:"THB",targetCurrency:"THB",policy:{profitRule:{enabled:true,...profitRule},minimumProfitAmount,maximumProfitAmount,packageProfitOverride,roundingRule:{enabled:false,mode:"NONE"}}});
assert.strictEqual(calc(100,{type:"PERCENT",value:5},3,50).profitAmount,5);
assert.strictEqual(calc(20,{type:"PERCENT",value:5},3,50).profitAmount,3);
assert.strictEqual(calc(3000,{type:"PERCENT",value:5},3,50).profitAmount,50);
assert.strictEqual(calc(100,{type:"FIXED",value:10},0,null).profitAmount,10);
assert.strictEqual(calc(260,{type:"PERCENT",value:5},3,50,{mode:"FIXED_AMOUNT",value:10}).profitAmount,10);
assert.strictEqual(calc(260,{type:"PERCENT",value:5},3,50,{mode:"PERCENTAGE",value:3}).baseProfitAmount,7.8);
assert.strictEqual(calc(260,{type:"PERCENT",value:5},10,50,{mode:"PERCENTAGE",value:3}).profitAmount,10);
assert.strictEqual(calc(100,{type:"PERCENT",value:5},0,0).profitAmount,0);
assert.throws(()=>calc(100,{type:"PERCENT",value:5},10,5),/Maximum profit/);
console.log(JSON.stringify({result:"PASS",percentageNormal:5,minimumCatch:3,maximumCap:50,fixedRegional:10,packageFixed:10,packagePercentageBase:7.8,packagePercentageGuarded:10,zeroValid:true,realOrders:0,realTopups:0,pricePublications:0},null,2));
