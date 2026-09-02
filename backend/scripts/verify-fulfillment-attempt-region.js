#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { fulfillmentAttemptRegion } = require("../services/fulfillmentService");

const supplierId = new mongoose.Types.ObjectId();
const mappingId = new mongoose.Types.ObjectId();
const orderId = new mongoose.Types.ObjectId();

function validateAttempt({ mappingRegion, customerMarket, marketDecoupledV2 }) {
    const region = fulfillmentAttemptRegion({ region: mappingRegion }, customerMarket, marketDecoupledV2);
    const attempt = new FulfillmentAttempt({
        fulfillmentId: `FUL-${mappingRegion}-${customerMarket}-${marketDecoupledV2 ? "V2" : "LEGACY"}`,
        orderId,
        orderModel: "CommerceOrder",
        orderCode: "AZL-REGION-VERIFY",
        supplierId,
        supplierCodeSnapshot: "FAZERCARDS",
        supplierMappingId: mappingId,
        productCode: "generic-product",
        packageCode: "GENERIC_PACKAGE",
        region,
        ...(marketDecoupledV2 ? { customerMarket } : {}),
        mode: "API",
        routeType: "SUPPLIER_API",
        status: "IN_PROGRESS",
        idempotencyKey: `fulfillment:start:AZL-REGION-VERIFY:${mappingId}`
    });
    assert.strictEqual(attempt.validateSync(), undefined, `${mappingRegion} -> ${customerMarket} attempt must validate.`);
    assert.strictEqual(String(attempt.supplierId), String(supplierId), "supplier identity remains unchanged.");
    assert.strictEqual(String(attempt.supplierMappingId), String(mappingId), "mapping identity remains unchanged.");
    return attempt;
}

const globalTh = validateAttempt({ mappingRegion: "GLOBAL", customerMarket: "TH", marketDecoupledV2: true });
assert.strictEqual(globalTh.region, "TH");
assert.strictEqual(globalTh.customerMarket, "TH");

const globalMm = validateAttempt({ mappingRegion: "GLOBAL", customerMarket: "MM", marketDecoupledV2: true });
assert.strictEqual(globalMm.region, "MM");
assert.strictEqual(globalMm.customerMarket, "MM");

const legacyTh = validateAttempt({ mappingRegion: "TH", customerMarket: "TH", marketDecoupledV2: false });
assert.strictEqual(legacyTh.region, "TH");
assert.strictEqual(legacyTh.customerMarket, undefined);

const legacyMm = validateAttempt({ mappingRegion: "MM", customerMarket: "MM", marketDecoupledV2: false });
assert.strictEqual(legacyMm.region, "MM");
assert.strictEqual(legacyMm.customerMarket, undefined);

console.log("FulfillmentAttempt customer-region verification passed.");
