"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { CANONICAL_OPERATIONAL_PRODUCTS } = require("../catalog/canonicalOperationalCatalog");

const root = path.resolve(__dirname, "../..");
const service = fs.readFileSync(path.join(root, "backend/services/commerce/adminPricingEngineService.js"), "utf8");
const frontend = fs.readFileSync(path.join(root, "frontend/js/admin-pricing-engine.js"), "utf8");

assert.strictEqual(CANONICAL_OPERATIONAL_PRODUCTS.length, 17, "Operational catalog must expose the expected 17 identities.");
assert.ok(service.includes('require("../../catalog/canonicalOperationalCatalog")'), "Pricing projection must import canonical catalog authority.");
assert.ok(service.includes("CANONICAL_OPERATIONAL_PRODUCTS.forEach"), "Every canonical identity must seed the pricing projection.");
assert.ok(service.includes("if (!products.has(productId)) return;"), "DB-only package products must not enter the selector projection.");
assert.ok(service.includes("packages: []"), "Zero-package canonical products must be representable.");
assert.ok(service.includes("packageCount"), "Projection must expose canonical package counts.");
assert.ok(!frontend.includes("some(pkg => pkg.packageEnabled"), "Package presence must not define selector membership.");
assert.ok(frontend.includes("daily.loadController?.abort()"), "Workspace refresh must abort stale loads.");
assert.ok(frontend.includes("seq !== daily.loadSeq"), "Workspace refresh must ignore stale responses.");

const codes = CANONICAL_OPERATIONAL_PRODUCTS.map(product => product.productCode);
assert.strictEqual(new Set(codes).size, codes.length, "Canonical product codes must remain exact and unique.");
assert.ok(!codes.includes("aovid"), "Legacy aovid must remain outside active canonical projection.");

console.log(`Daily Pricing canonical consistency verification passed (${codes.length} products).`);
