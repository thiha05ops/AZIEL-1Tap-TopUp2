const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, fragment, message) {
    assert(read(file).includes(fragment), `${file}: ${message}`);
}

function notIncludes(file, fragment, message) {
    assert(!read(file).includes(fragment), `${file}: ${message}`);
}

function assertIndex(model, fields, message) {
    const hasIndex = model.schema.indexes().some(([indexFields]) => (
        Object.entries(fields).every(([key, value]) => indexFields[key] === value)
    ));
    assert(hasIndex, message);
}

function assertUniqueIndex(model, fields, message) {
    const hasIndex = model.schema.indexes().some(([indexFields, options]) => (
        options?.unique === true &&
        Object.entries(fields).every(([key, value]) => indexFields[key] === value)
    ));
    assert(hasIndex, message);
}

async function expectInvalid(doc, pathName, message) {
    let error = null;
    try {
        await doc.validate();
    } catch (validationError) {
        error = validationError;
    }
    assert(error?.errors?.[pathName], message);
}

function assertNotUniqueIndex(model, fields, message) {
    const hasUniqueIndex = model.schema.indexes().some(([indexFields, options]) => (
        options?.unique === true &&
        Object.keys(indexFields).length === Object.keys(fields).length &&
        Object.entries(fields).every(([key, value]) => indexFields[key] === value)
    ));
    assert(!hasUniqueIndex, message);
}

async function verifyConstants() {
    const constants = require("../constants/commerce");
    const expected = {
        PRICING_POLICY_STATUS: ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"],
        PRICING_RULE_SCOPE: ["GLOBAL", "REGION", "GAME", "CATEGORY", "TIER", "PACKAGE"],
        PRICING_RULE_TYPE: ["MARKUP_PERCENT", "MARKUP_FIXED", "PROFIT_MARGIN_PERCENT", "PROFIT_FIXED", "FEE_PERCENT", "FEE_FIXED", "PRICE_OVERRIDE", "ROUNDING"],
        PROMOTION_RULE_STATUS: ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "ENDED", "ARCHIVED"],
        PROMOTION_TYPE: ["PERCENTAGE_DISCOUNT", "FIXED_DISCOUNT", "OVERRIDE_PRICE", "FREE_ITEM", "NON_PRICE_REWARD"],
        PROMOTION_SCOPE: ["GLOBAL", "REGION", "GAME", "CATEGORY", "TIER", "PACKAGE", "PAYMENT_METHOD", "USER_SEGMENT"],
        CAMPAIGN_STATUS: ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "ENDED", "CANCELLED", "ARCHIVED"],
        AVAILABILITY_STATE: ["AVAILABLE", "OUT_OF_STOCK", "TEMPORARILY_UNAVAILABLE", "COMING_SOON", "HIDDEN", "DISCONTINUED"],
        INVENTORY_SOURCE: ["MANUAL", "SUPPLIER", "SYSTEM"],
        PRICE_VERSION_STATUS: ["DRAFT", "VALIDATED", "APPROVED", "PUBLISHED", "SUPERSEDED", "ROLLED_BACK", "ARCHIVED"],
        ROUNDING_MODE: ["NONE", "NEAREST", "UP", "DOWN", "PSYCHOLOGICAL"],
        CURRENCY: ["MMK", "THB"],
        REGION: ["MM", "TH"],
        ELIGIBILITY_OPERATOR: ["ALL", "ANY", "NOT"],
        ELIGIBILITY_COMPARATOR: ["EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "GREATER_THAN", "GREATER_THAN_OR_EQUAL", "LESS_THAN", "LESS_THAN_OR_EQUAL", "EXISTS", "NOT_EXISTS", "BETWEEN", "CONTAINS"]
    };

    Object.entries(expected).forEach(([key, values]) => {
        assert.deepStrictEqual(constants[key], values, `${key} must match required commerce enum values.`);
        assert(Object.isFrozen(constants[key]), `${key} must be immutable.`);
    });
}

async function verifySharedSchemas() {
    const schemas = require("../models/commerceSchemas");
    [
        "moneyRuleSchema",
        "profitRuleSchema",
        "roundingRuleSchema",
        "promotionScopeSchema",
        "packageIdentitySchema",
        "eligibilitySchema",
        "percentValidator",
        "applyMetadataValidation",
        "validateEligibilityDepth",
        "validateStartBeforeEnd"
    ].forEach(exportName => {
        assert(schemas[exportName], `commerceSchemas must export ${exportName}.`);
    });
}

async function verifyPricingPolicy() {
    const PricingPolicy = require("../models/PricingPolicy");
    const valid = new PricingPolicy({
        name: "Thailand Default Policy",
        code: "th-default",
        status: "DRAFT",
        region: "TH",
        currency: "THB",
        defaultGatewayFee: { type: "PERCENT", value: 2.5, enabled: true },
        defaultProfitRule: { type: "PERCENT", value: 12 },
        defaultRoundingRule: { mode: "NEAREST", increment: 10, enabled: true },
        minimumProfitMarginPercent: 5
    });
    await valid.validate();
    assert.strictEqual(valid.code, "TH-DEFAULT", "PricingPolicy code should normalize uppercase.");

    await expectInvalid(new PricingPolicy({ name: "Invalid", code: "bad", status: "LIVE", region: "TH", currency: "THB" }), "status", "PricingPolicy must reject invalid status.");
    await expectInvalid(new PricingPolicy({ name: "Invalid", code: "bad-region", region: "EU", currency: "THB" }), "region", "PricingPolicy must reject invalid region.");
    await expectInvalid(new PricingPolicy({ name: "Invalid", code: "bad-percent", region: "TH", currency: "THB", minimumProfitMarginPercent: 101 }), "minimumProfitMarginPercent", "PricingPolicy must bound percentage fields.");
    await expectInvalid(new PricingPolicy({ name: "Invalid", code: "bad-date", region: "TH", currency: "THB", effectiveFrom: new Date("2026-02-02"), effectiveUntil: new Date("2026-01-01") }), "effectiveUntil", "PricingPolicy must validate date order.");
    await expectInvalid(new PricingPolicy({ name: "Invalid", code: "bad-metadata", region: "TH", currency: "THB", metadata: [] }), "metadata", "PricingPolicy must reject non-object metadata.");
    await expectInvalid(new PricingPolicy({ name: "Invalid", code: "bad-metadata-key", region: "TH", currency: "THB", metadata: { constructor: "unsafe" } }), "metadata", "PricingPolicy must reject dangerous metadata keys.");

    assertUniqueIndex(PricingPolicy, { code: 1 }, "PricingPolicy must have unique code index.");
    assertIndex(PricingPolicy, { status: 1, region: 1, currency: 1 }, "PricingPolicy must have status/region/currency index.");
}

async function verifyPricingRule() {
    const PricingRule = require("../models/PricingRule");
    const policyId = new mongoose.Types.ObjectId();
    const valid = new PricingRule({
        name: "MLBB Markup",
        code: "mlbb-markup",
        policyId,
        scopeType: "GAME",
        scopeReference: "mlbb",
        ruleType: "MARKUP_PERCENT",
        value: 8,
        region: "MM",
        currency: "MMK"
    });
    await valid.validate();
    assert.strictEqual(valid.code, "MLBB-MARKUP", "PricingRule code should normalize uppercase.");

    await expectInvalid(new PricingRule({ name: "Invalid", code: "bad", policyId, scopeType: "GAME", ruleType: "UNKNOWN" }), "ruleType", "PricingRule must reject invalid type.");
    await expectInvalid(new PricingRule({ name: "Invalid", code: "bad-percent", policyId, scopeType: "GAME", ruleType: "MARKUP_PERCENT", value: 101 }), "value", "PricingRule must bound percent values.");
    await expectInvalid(new PricingRule({ name: "Invalid", code: "bad-date", policyId, scopeType: "GAME", ruleType: "MARKUP_FIXED", effectiveFrom: new Date("2026-02-02"), effectiveUntil: new Date("2026-01-01") }), "effectiveUntil", "PricingRule must validate date order.");

    assertUniqueIndex(PricingRule, { code: 1 }, "PricingRule must have unique code index.");
    assertIndex(PricingRule, { policyId: 1, status: 1, priority: -1 }, "PricingRule must have policy/status/priority index.");
    assertIndex(PricingRule, { scopeType: 1, scopeReference: 1 }, "PricingRule must have scope lookup index.");
}

async function verifyPromotionRule() {
    const PromotionRule = require("../models/PromotionRule");
    const valid = new PromotionRule({
        name: "Welcome Discount",
        code: "welcome-10",
        promotionType: "PERCENTAGE_DISCOUNT",
        discountValue: 10,
        scopes: [{ scopeType: "REGION", scopeReference: "TH" }],
        couponCode: "hello",
        eligiblePackages: [{ packageId: "mlbb_weekly_1x", packageCode: "weekly_1x", packageRef: null }],
        eligibility: {
            operator: "ALL",
            conditions: [
                { field: "region", comparator: "IN", values: ["TH"] },
                { field: "accountAgeDays", comparator: "LESS_THAN_OR_EQUAL", value: 7 }
            ]
        }
    });
    await valid.validate();
    assert.strictEqual(valid.code, "WELCOME-10", "PromotionRule code should normalize uppercase.");
    assert.strictEqual(valid.couponCode, "HELLO", "PromotionRule couponCode should normalize uppercase.");
    assert.strictEqual(valid.eligiblePackages[0].packageId, "MLBB_WEEKLY_1X", "PromotionRule package identity should normalize packageId uppercase.");
    assert.strictEqual(valid.eligiblePackages[0].packageCode, "WEEKLY_1X", "PromotionRule package identity should normalize packageCode uppercase.");
    assert.strictEqual(valid.eligiblePackages[0].packageRef, null, "PromotionRule packageRef should be nullable.");

    await expectInvalid(new PromotionRule({ name: "Invalid", code: "bad", promotionType: "PERCENTAGE_DISCOUNT", discountValue: 101 }), "discountValue", "PromotionRule must bound percentage discounts.");
    await expectInvalid(new PromotionRule({ name: "Invalid", code: "bad-scope", promotionType: "FIXED_DISCOUNT", scopes: [{ scopeType: "UNKNOWN" }] }), "scopes.0.scopeType", "PromotionRule must reject invalid scopes.");
    await expectInvalid(new PromotionRule({ name: "Invalid", code: "bad-date", promotionType: "FIXED_DISCOUNT", effectiveFrom: new Date("2026-02-02"), effectiveUntil: new Date("2026-01-01") }), "effectiveUntil", "PromotionRule must validate date order.");
    await expectInvalid(new PromotionRule({ name: "Invalid", code: "bad-eligibility", promotionType: "FIXED_DISCOUNT", eligibility: { operator: "SOME" } }), "eligibility.operator", "PromotionRule must reject invalid eligibility operator.");
    await expectInvalid(new PromotionRule({ name: "Invalid", code: "bad-comparator", promotionType: "FIXED_DISCOUNT", eligibility: { operator: "ALL", conditions: [{ field: "region", comparator: "MATCHES" }] } }), "eligibility.conditions.0.comparator", "PromotionRule must reject invalid eligibility comparator.");
    await expectInvalid(new PromotionRule({
        name: "Invalid",
        code: "bad-depth",
        promotionType: "FIXED_DISCOUNT",
        eligibility: {
            operator: "ALL",
            conditions: [{
                operator: "ALL",
                conditions: [{
                    operator: "ALL",
                    conditions: [{
                        operator: "ALL",
                        conditions: [{
                            operator: "ALL",
                            conditions: [{
                                operator: "ALL",
                                conditions: [{ field: "region", comparator: "EQUALS", value: "TH" }]
                            }]
                        }]
                    }]
                }]
            }]
        }
    }), "eligibility", "PromotionRule must bound eligibility nesting depth.");
    await expectInvalid(new PromotionRule({ name: "Invalid", code: "bad-metadata", promotionType: "FIXED_DISCOUNT", metadata: { prototype: true } }), "metadata", "PromotionRule must reject dangerous metadata keys.");

    assertUniqueIndex(PromotionRule, { code: 1 }, "PromotionRule must have unique code index.");
    assertIndex(PromotionRule, { couponCode: 1, requiresCoupon: 1 }, "PromotionRule must have coupon lookup index.");
    assertIndex(PromotionRule, { "eligiblePackages.packageId": 1 }, "PromotionRule must index package identity targets.");
}

async function verifyCommerceCampaign() {
    const CommerceCampaign = require("../models/CommerceCampaign");
    const valid = new CommerceCampaign({
        name: "Songkran Commerce",
        code: "songkran-commerce",
        status: "SCHEDULED",
        targetRegions: ["TH"],
        promotionRuleIds: [new mongoose.Types.ObjectId()],
        targetPackages: [{ packageId: "pubg_royale_pass", packageCode: "royale_pass" }]
    });
    await valid.validate();
    assert.strictEqual(valid.code, "SONGKRAN-COMMERCE", "CommerceCampaign code should normalize uppercase.");
    assert.strictEqual(valid.targetPackages[0].packageId, "PUBG_ROYALE_PASS", "CommerceCampaign package identity should normalize packageId uppercase.");

    await expectInvalid(new CommerceCampaign({ name: "Invalid", code: "bad", status: "LIVE" }), "status", "CommerceCampaign must reject invalid status.");
    await expectInvalid(new CommerceCampaign({ name: "Invalid", code: "bad-date", startAt: new Date("2026-02-02"), endAt: new Date("2026-01-01") }), "endAt", "CommerceCampaign must validate date order.");

    assertUniqueIndex(CommerceCampaign, { code: 1 }, "CommerceCampaign must have unique code index.");
    assertIndex(CommerceCampaign, { status: 1, startAt: 1, endAt: 1 }, "CommerceCampaign must have schedule/status index.");
    assertIndex(CommerceCampaign, { "targetPackages.packageId": 1 }, "CommerceCampaign must index package identity targets.");
}

async function verifyPackageInventoryState() {
    const PackageInventoryState = require("../models/PackageInventoryState");
    const valid = new PackageInventoryState({
        packageId: "mlbb_weekly_1x",
        packageCode: "weekly_1x",
        packageRef: null,
        availabilityState: "TEMPORARILY_UNAVAILABLE",
        source: "MANUAL",
        manualOverrideEnabled: true,
        manualOverrideState: "OUT_OF_STOCK"
    });
    await valid.validate();
    assert.strictEqual(valid.packageId, "MLBB_WEEKLY_1X", "PackageInventoryState packageId should normalize uppercase.");
    assert.strictEqual(valid.packageCode, "WEEKLY_1X", "PackageInventoryState packageCode should normalize uppercase.");
    assert.strictEqual(valid.packageRef, null, "PackageInventoryState packageRef should be nullable.");

    await expectInvalid(new PackageInventoryState({ packageId: "pkg", availabilityState: "DELETED" }), "availabilityState", "PackageInventoryState must reject delete as an availability state.");
    await expectInvalid(new PackageInventoryState({ packageId: "pkg", source: "API" }), "source", "PackageInventoryState must reject invalid source.");
    await expectInvalid(new PackageInventoryState({ packageId: "pkg", metadata: { constructor: { polluted: true } } }), "metadata", "PackageInventoryState must reject dangerous metadata keys.");

    assertUniqueIndex(PackageInventoryState, { packageId: 1 }, "PackageInventoryState must prevent duplicate current records per package.");
    assertIndex(PackageInventoryState, { packageCode: 1 }, "PackageInventoryState must index packageCode.");
    assertIndex(PackageInventoryState, { packageRef: 1 }, "PackageInventoryState must index nullable packageRef.");
    assertIndex(PackageInventoryState, { availabilityState: 1, source: 1 }, "PackageInventoryState must have availability/source index.");
}

async function verifyPriceVersion() {
    const PriceVersion = require("../models/PriceVersion");
    const valid = new PriceVersion({
        versionNumber: 1,
        branchKey: "Main",
        name: "Initial Draft",
        status: "DRAFT",
        pricingPolicyId: new mongoose.Types.ObjectId(),
        pricingRuleIds: [new mongoose.Types.ObjectId()],
        promotionRuleIds: [new mongoose.Types.ObjectId()],
        campaignIds: [new mongoose.Types.ObjectId()],
        parentVersionId: new mongoose.Types.ObjectId(),
        affectedPackages: [{ packageId: "mlbb_weekly_1x", packageCode: "weekly_1x" }],
        validationSummary: { valid: true, errorCount: 0, warningCount: 1 }
    });
    await valid.validate();
    assert(valid.versionId, "PriceVersion must generate immutable versionId.");
    assert.strictEqual(valid.branchKey, "main", "PriceVersion branchKey should normalize lowercase.");
    assert.strictEqual(valid.affectedPackages[0].packageId, "MLBB_WEEKLY_1X", "PriceVersion affected packages must normalize packageId uppercase.");

    await expectInvalid(new PriceVersion({ versionNumber: 0, name: "Invalid" }), "versionNumber", "PriceVersion must require positive version number.");
    await expectInvalid(new PriceVersion({ versionNumber: 1, name: "Invalid", status: "LIVE" }), "status", "PriceVersion must reject invalid status.");
    await expectInvalid(new PriceVersion({ versionNumber: 1, name: "Invalid", validationSummary: { errorCount: -1 } }), "validationSummary.errorCount", "PriceVersion validation summary counts must be non-negative.");
    await expectInvalid(new PriceVersion({ versionNumber: 1, name: "Invalid", metadata: [] }), "metadata", "PriceVersion must reject non-object metadata.");

    assertUniqueIndex(PriceVersion, { versionId: 1 }, "PriceVersion must have unique versionId index.");
    assertUniqueIndex(PriceVersion, { branchKey: 1, versionNumber: 1 }, "PriceVersion must have branch/version unique index.");
    assertNotUniqueIndex(PriceVersion, { versionNumber: 1 }, "PriceVersion versionNumber must not be globally unique.");
    assertIndex(PriceVersion, { status: 1, branchKey: 1 }, "PriceVersion must have status/branch index.");
    assertIndex(PriceVersion, { parentVersionId: 1 }, "PriceVersion must have parent version index.");
    assertIndex(PriceVersion, { publishedAt: -1 }, "PriceVersion must have publishedAt index.");
    assertIndex(PriceVersion, { status: 1, createdAt: -1 }, "PriceVersion must have status/createdAt index.");
}

function verifyDocumentationAndScope() {
    [
        "PricingPolicy",
        "PricingRule",
        "PromotionRule",
        "CommerceCampaign",
        "PackageInventoryState",
        "PriceVersion",
        "Canonical Package Identity",
        "Promotion Eligibility Tree",
        "Metadata Policy",
        "Business-Rule Architecture Decision",
        "Future PricingQuote Contract",
        "No generic `BusinessRule` key-value model",
        "No `PricingQuote` implementation",
        "Catalog → Inventory → Pricing → Promotion → Campaign → Display → Checkout → Immutable Order Snapshot",
        "Explicitly Deferred Runtime Features"
    ].forEach(fragment => includes("docs/commerce-data-foundation.md", fragment, `Commerce foundation docs must include ${fragment}.`));

    [
        "ADR-001 Package Identity",
        "ADR-002 Typed Domain Rules vs Generic BusinessRule",
        "ADR-003 Price Version Lineage",
        "ADR-004 PricingQuote Deferred"
    ].forEach(fragment => includes("docs/commerce-architecture-decisions.md", fragment, `Commerce ADR docs must include ${fragment}.`));

    notIncludes("backend/server.js", "PricingPolicy", "Commerce data foundation must not mount PricingPolicy APIs.");
    notIncludes("backend/server.js", "PromotionRule", "Commerce data foundation must not mount PromotionRule APIs.");
    notIncludes("backend/server.js", "CommerceCampaign", "Commerce data foundation must not mount CommerceCampaign APIs.");
    notIncludes("frontend/admin.html", "PromotionRule", "Commerce data foundation must not change Admin UI.");
    notIncludes("frontend/home.html", "PricingPolicy", "Commerce data foundation must not change storefront UI.");
}

async function main() {
    await verifyConstants();
    await verifySharedSchemas();
    await verifyPricingPolicy();
    await verifyPricingRule();
    await verifyPromotionRule();
    await verifyCommerceCampaign();
    await verifyPackageInventoryState();
    await verifyPriceVersion();
    verifyDocumentationAndScope();
    console.log("Commerce data foundation verification checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
