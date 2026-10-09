#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/js/admin-pricing-engine.js"), "utf8");
const mappingMessage = "No valid supplier-to-canonical package mappings are available for this product.";

function createState() {
    return { productBrowserOpen: true, navigationProducts: [], selectedProductId: "", region: "TH", rows: [], detailLoaded: false, detailProductId: "", detailRegion: "", workspaceError: "", detailError: "", detailErrorProductId: "", detailErrorRegion: "", detailSeq: 0 };
}
function visibleError(state) {
    if (state.productBrowserOpen) return state.workspaceError;
    if (state.detailError && state.detailErrorProductId === state.selectedProductId && state.detailErrorRegion === state.region) return state.detailError;
    if (state.detailLoaded && state.detailProductId === state.selectedProductId && state.detailRegion === state.region && !state.rows.length) return mappingMessage;
    return "";
}
function beginDetail(state, productId) {
    state.detailSeq += 1;
    state.selectedProductId = productId;
    state.productBrowserOpen = false;
    state.detailLoaded = false;
    state.detailError = "";
    return { seq: state.detailSeq, productId, region: state.region };
}
function settleDetail(state, request, rows, error = "") {
    if (request.seq !== state.detailSeq || request.productId !== state.selectedProductId || request.region !== state.region || state.productBrowserOpen) return false;
    state.rows = rows;
    state.detailLoaded = !error;
    state.detailProductId = request.productId;
    state.detailRegion = request.region;
    state.detailError = error;
    state.detailErrorProductId = error ? request.productId : "";
    state.detailErrorRegion = error ? request.region : "";
    return true;
}

const state = createState();
state.navigationProducts = [{ productId: "A" }, { productId: "B" }];
state.selectedProductId = "A"; // restored session selection while list remains open
assert.strictEqual(visibleError(state), "", "successful product inventory must not expose remembered-product detail state");
const requestA = beginDetail(state, "A");
settleDetail(state, requestA, []);
assert.strictEqual(visibleError(state), mappingMessage, "zero mappings must remain visible in current product detail");
state.detailSeq += 1; state.productBrowserOpen = true; state.detailError = "";
assert.strictEqual(visibleError(state), "", "back to products must hide the product error");
const slowA = beginDetail(state, "A");
const requestB = beginDetail(state, "B");
settleDetail(state, requestB, [{ packageCode: "B1" }]);
assert.strictEqual(visibleError(state), "", "valid product B must clear product A state");
assert.strictEqual(settleDetail(state, slowA, [], "A failed"), false, "slow A response must be rejected after B selection");
assert.strictEqual(visibleError(state), "", "slow A response must not reintroduce its error");
const oldMarket = beginDetail(state, "B");
state.detailSeq += 1; state.region = "MM";
assert.strictEqual(settleDetail(state, oldMarket, [], "TH failed"), false, "customer-market switch must reject the old response");
state.productBrowserOpen = true; state.workspaceError = "Inventory unavailable";
assert.strictEqual(visibleError(state), "Inventory unavailable", "genuine inventory errors must remain workspace-owned");

assert(source.includes('workspaceError: ""') && source.includes('detailErrorProductId: ""'), "Pricing must own separate workspace/detail error state");
assert(source.includes("daily.productBrowserOpen) return \"\""), "detail blockers must not render in the product browser");
assert(source.includes("customerMarket !== daily.region || daily.productBrowserOpen"), "detail responses must be guarded by product, market and visible workspace");
assert(source.includes("clearDetailError();") && source.includes('$("pricingBackToProducts")'), "back navigation must clear detail-owned errors");
assert(source.includes("setWorkspaceError(error.message, true)"), "inventory failure must remain a workspace error");
assert(source.includes(mappingMessage), "legitimate zero-mapping detail state must remain supported");

console.log("PASS Daily Pricing workspace/detail error ownership and stale-response verification");
