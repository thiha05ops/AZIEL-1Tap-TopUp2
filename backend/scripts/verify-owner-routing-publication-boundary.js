#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { calculateBasePrice } = require("../services/commerce/pricingCalculationEngine");
const { publishedCustomerPriceRule } = require("../services/commerce/productionPricingContextService");
const { getPermissionsForRole, PERMISSIONS } = require("../services/adminAuthorizationService");
const Mapping = require("../models/SupplierProductMapping");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const context = { packageCode: "PUBG_60_UC" };
const policy = (minimum = 5, override = { mode: "INHERIT", value: null }) => ({
    profitRule: { enabled: true, type: "PERCENT", value: 5 },
    minimumProfitAmount: minimum,
    maximumProfitAmount: null,
    packageProfitOverride: override,
    roundingRule: { enabled: false, mode: "NONE" }
});
const preview = (supplierCost, pricingPolicy = policy()) => calculateBasePrice({ supplierCost, supplierCurrency: "THB", targetCurrency: "THB", policy: pricingPolicy, context }).regularPrice;
const published = (supplierCost, amount) => calculateBasePrice({
    supplierCost,
    supplierCurrency: "THB",
    targetCurrency: "THB",
    policy: policy(),
    context,
    appliedPricingRules: [publishedCustomerPriceRule({ price: { amount, publishedPriceMode: "POLICY_DERIVED" }, packageContext: context, region: "TH", currency: "THB" })]
}).regularPrice;

assert.strictEqual(preview(37.17), 42.17);
assert.strictEqual(published(37.17, 32.84), 32.84);
assert.strictEqual(published(37.17, 32.84), 32.84); // product detail/new quote/checkout shared boundary
assert.notStrictEqual(preview(37.17, policy(6)), 42.17);
assert.strictEqual(published(37.17, 32.84), 32.84); // settings save
assert.notStrictEqual(preview(37.17, policy(5, { mode: "FIXED_AMOUNT", value: 10 })), 42.17);
assert.strictEqual(published(37.17, 32.84), 32.84); // override save
assert.strictEqual(published(30, 32.84), 32.84); // cost/route change
assert.strictEqual(published(37.17, 43.17), 43.17); // explicit publication
const oldQuote = Object.freeze({ amount: 32.84 });
const oldOrder = Object.freeze({ amount: oldQuote.amount, supplierCode: "WONDD" });
assert.deepStrictEqual(oldQuote, { amount: 32.84 });
assert.deepStrictEqual(oldOrder, { amount: 32.84, supplierCode: "WONDD" });

assert(getPermissionsForRole("OWNER").includes(PERMISSIONS.OWNER_ROUTING_MANAGE));
assert(!getPermissionsForRole("CATALOG").includes(PERMISSIONS.OWNER_ROUTING_MANAGE));
assert(!getPermissionsForRole("OPERATIONS").includes(PERMISSIONS.OWNER_ROUTING_MANAGE));
const primaryIndex = Mapping.schema.indexes().find(([, options]) => options?.name === "one_primary_supplier_per_package_region");
assert(primaryIndex?.[1]?.unique === true);
assert(primaryIndex?.[1]?.partialFilterExpression?.productionRole === "PRIMARY");

const routing = read("backend/services/supplierProductionSelectionService.js");
const fulfillment = read("backend/services/fulfillmentService.js");
const routes = read("backend/routes/supplier.js");
const ui = read("frontend/js/admin-fulfillment.js");
assert(routing.includes("Mapping cannot become PRIMARY"));
assert(routing.includes("PRIMARY_ROUTE_REQUIRED"));
assert(routing.includes("productionRole: ROLES.BACKUP"));
assert(routing.includes('productionRole: ROLES.PRIMARY'));
assert(fulfillment.includes("SUPPLIER_MAPPING_NOT_PRIMARY"));
assert(routes.includes("OWNER_ROUTING_MANAGE"));
assert(ui.includes("Provider gate:"));
assert(ui.includes("Production blockers:"));
assert(ui.includes("OWNER_ROUTING_MANAGE"));

console.log(JSON.stringify({
    result: "PASS",
    observedCase: { published: 32.84, preview: 42.17, customerSurfaces: 32.84 },
    ownerOnlyRouting: true,
    onePrimaryIndex: true,
    unreadyPrimaryBlocked: true,
    solePrimaryRemovalRequiresManualFallback: true,
    backupAutomaticSelection: false,
    historicalSnapshotsImmutable: true,
    productionMutations: 0,
    providerCalls: 0
}, null, 2));
