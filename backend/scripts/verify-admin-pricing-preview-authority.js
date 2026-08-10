"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

const adminService = read("backend/services/commerce/adminPricingControlCenterService.js");
assert(adminService.includes("resolveCommercePricingPreviewDetailed"), "Admin preview must delegate to the shared Commerce preview service.");
assert(adminService.includes('preview.authority = "COMMERCE_PRICING_RUNTIME"'), "Admin preview must expose canonical Commerce provenance.");
assert(adminService.includes("preview.currentCommercePrice - preview.publishedCatalogPrice"), "Difference must mean Commerce price minus stored Catalog price.");
assert(!/async function previewPackagePricing[\s\S]*?const draftPackage\s*=/.test(adminService), "Admin live preview must not build financial authority from browser draft package data.");
assert(!/async function previewPackagePricing[\s\S]*?createPricingQuote\s*\(/.test(adminService), "Admin preview must not invoke a separate quote formula/path.");

const previewService = read("backend/services/commerce/commercePricingPreviewService.js");
assert(previewService.includes("buildProductionPricingContext"));
assert(previewService.includes("createPricingQuote"));
assert(previewService.includes('readOnly: true'), "Preview promotion eligibility must be side-effect free.");
assert(!previewService.includes("sellingPrice: input"), "Browser selling-price fields must not become trusted context.");

const adminFrontend = read("frontend/js/admin-catalog.js");
assert(adminFrontend.includes("Current Commerce Price"));
assert(adminFrontend.includes("Published Catalog Price"));
assert(adminFrontend.includes("Commerce − Catalog Difference"));
assert(adminFrontend.includes("Promo Discount"));
assert(!adminFrontend.includes("LEGACY_CATALOG_COMPATIBILITY"), "Admin UI must not present compatibility provenance as current authority.");

const ownership = read("backend/services/commerce/productionPricingContextService.js");
assert(ownership.includes('mode !== "MANUAL_OVERRIDE"'), "Only explicit MANUAL_OVERRIDE may become a price override.");

console.log("Admin pricing preview authority verification passed.");
