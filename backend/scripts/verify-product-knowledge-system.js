const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { CANONICAL_OPERATIONAL_PRODUCTS } = require("../catalog/canonicalOperationalCatalog");
const seeds = require("../catalog/verifiedProductKnowledge");
const { normalizeProductKnowledge, normalizeCustomerNote } = require("../catalog/productKnowledge");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
assert.equal(CANONICAL_OPERATIONAL_PRODUCTS.length, 16, "All 16 canonical products must remain available");
assert(!CANONICAL_OPERATIONAL_PRODUCTS.some(item => item.productCode === "aovid"), "aovid must not be reintroduced");
assert.deepEqual(Object.keys(seeds).sort(), ["freefire", "hok", "mlbb", "mlbb-twilight-weekly-pass", "pubg", "pubgrp"]);
Object.values(seeds).forEach(normalizeProductKnowledge);
assert.throws(() => normalizeProductKnowledge({ purchaseNotes: {} }), /must be an array/);
assert.throws(() => normalizeProductKnowledge({ about: { details: "<script>alert(1)</script>" } }), /cannot contain HTML/);
assert.throws(() => normalizeCustomerNote("<b>unsafe</b>"), /cannot contain HTML/);

const stage = read("frontend/js/product-detail-stage.js");
assert(stage.includes("resolveProductKnowledge(product.productKnowledge || {})"), "Product Knowledge must resolve through the shared locale fallback contract");
assert(stage.includes("if (container.children.length)"), "Empty knowledge sections must be omitted");
assert(stage.includes(".product-account-card label"), "How to Top Up must derive from account fields");
assert(!stage.includes('faqLink.href = "faq.html"'), "Legacy FAQ-only fallback must be removed");
const prices = read("frontend/js/prices.js");
assert(prices.includes("data-customer-note"), "Package note must be available as a subtle affordance");

console.log("Product knowledge system verification passed for 16 canonical products.");
