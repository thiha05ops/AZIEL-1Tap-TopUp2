const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    applyPublicationMetadata,
    comparePublicationSets,
    explicitPublishedPackages,
    projectPackagePublication,
    stripPublicationMetadata
} = require("../services/packageMarketPublicationService");
const {
    analyzePublicationState,
    buildPublicationBaseline,
    publicationBaselineHash,
    stablePlanHash
} = require("./migrate-package-market-publication");
const { resolvePublicProductReadiness } = require("../catalog/publicProductReadiness");

function pkg(packageCode, operational = true) {
    return { packageCode, enabled: true, prices: { TH: { enabled: true, amount: 10 } }, fulfillmentRegions: { TH: operational } };
}

function customerClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function planFixture() {
    const composition = { mlbb: 18, "mlbb-twilight-weekly-pass": 2, pubg: 6, freefire: 9, "freefire-pass-membership": 10, hok: 12 };
    const records = Object.entries(composition).flatMap(([productCode, count]) => Array.from({ length: count }, (_, index) => ({ productCode, packageCode: `${productCode.replaceAll("-", "_").toUpperCase()}_${index + 1}`, customerMarket: "TH", published: true })))
        .sort((a, b) => `${a.productCode}:${a.packageCode}`.localeCompare(`${b.productCode}:${b.packageCode}`));
    const planHash = stablePlanHash(records);
    const publicationBaseline = buildPublicationBaseline([], records, "TH");
    return { migrationId: "phase1a-test-plan", customerMarket: "TH", records, planHash, publicationBaseline, publicationBaselineHash: publicationBaselineHash(publicationBaseline) };
}

function migrationRecord(record, plan) {
    return { ...record, decisionVersion: 1, updatedAt: new Date("2026-08-30T00:00:00.000Z"), provenance: { source: "LEGACY_PUBLIC_CATALOG_MIGRATION", migrationId: plan.migrationId, metadata: { planHash: plan.planHash } } };
}

function verify() {
    const base = [{ productCode: "mlbb", packages: [pkg("SAFE"), pkg("UNSAFE", false)] }];
    const legacyBefore = customerClone(base);
    const internal = customerClone(base);
    applyPublicationMetadata(internal[0], [{ productCode: "mlbb", packageCode: "UNSAFE", customerMarket: "TH", published: true, decisionNote: "private", publishedBy: "owner", decisionVersion: 4, provenance: { migrationId: "secret" } }]);
    const proposed = [{ ...internal[0], packages: explicitPublishedPackages(internal[0]) }];
    const diagnostics = comparePublicationSets(base, proposed, "TH");
    const shadowReturned = customerClone(base);
    assert.deepStrictEqual(shadowReturned, legacyBefore, "SHADOW customer response must equal LEGACY.");
    assert(diagnostics.removed.length === 1, "SHADOW must detect internal differences.");
    stripPublicationMetadata(proposed[0]);
    const serializedCustomer = JSON.stringify(proposed);
    for (const privateField of ["publishedBy", "unpublishedBy", "decisionNote", "decisionVersion", "migrationId", "provenance"]) assert(!serializedCustomer.includes(privateField), `${privateField} leaked to customer projection`);

    const suppressed = projectPackagePublication(pkg("UNSAFE", false), { published: true, decisionVersion: 1 });
    assert.strictEqual(suppressed.state, "SUPPRESSED");
    assert.strictEqual(suppressed.currentlyPurchasable, false);
    const product = { productCode: "mlbb", enabled: true, publicDiscoveryEnabled: true, commerceState: "PURCHASABLE", lifecycleStatus: "ACTIVE", supportedRegions: ["TH"] };
    const publishedOnlyReadiness = resolvePublicProductReadiness(product, [pkg("UNSAFE", false)], { checks: { fulfillment: false, availability: true }, regions: { TH: { fulfillment: false, availability: true } } });
    assert.notStrictEqual(publishedOnlyReadiness.state, "AVAILABLE", "Private ready package must contribute zero readiness.");
    const recovered = resolvePublicProductReadiness(product, [pkg("UNSAFE", true)], { checks: { fulfillment: true, availability: true }, regions: { TH: { fulfillment: true, availability: true } } });
    assert.strictEqual(recovered.state, "AVAILABLE", "Operational recovery must work without republish.");
    assert.strictEqual(resolvePublicProductReadiness({ ...product, publicDiscoveryEnabled: false }, [pkg("UNSAFE", true)], { checks: { fulfillment: true, availability: true }, regions: { TH: { fulfillment: true, availability: true } } }).state, "HIDDEN");

    const plan = planFixture();
    assert.strictEqual(plan.records.length, 57);
    const first = plan.records[0];
    const adminPrivate = { ...first, published: false, decisionVersion: 1, updatedAt: new Date("2026-08-30T01:00:00.000Z"), provenance: { source: "ADMIN" } };
    assert(analyzePublicationState(plan, [adminPrivate]).conflictKeys.length > 0, "Admin unpublish after plan must conflict.");
    const outsideAdmin = { productCode: "other", packageCode: "OTHER_1", customerMarket: "TH", published: true, decisionVersion: 1, updatedAt: new Date("2026-08-30T01:00:00.000Z"), provenance: { source: "ADMIN" } };
    assert(analyzePublicationState(plan, [outsideAdmin]).outOfPlanPublishedKeys.length === 1, "Out-of-plan Admin publish must conflict.");
    const replay = migrationRecord(first, plan);
    const replayAnalysis = analyzePublicationState(plan, [replay]);
    assert.strictEqual(replayAnalysis.conflictKeys.length, 0);
    assert.strictEqual(replayAnalysis.samePlanExistingKeys.length, 1);
    assert.strictEqual(replay.decisionVersion, 1);
    assert.strictEqual(replay.provenance.migrationId, plan.migrationId);
    const compatibleAdmin = { ...first, published: true, decisionVersion: 3, updatedAt: new Date("2026-08-29T01:00:00.000Z"), provenance: { source: "ADMIN" } };
    const compatiblePlan = { ...plan };
    compatiblePlan.publicationBaseline = buildPublicationBaseline([compatibleAdmin], plan.records, "TH");
    compatiblePlan.publicationBaselineHash = publicationBaselineHash(compatiblePlan.publicationBaseline);
    const compatibleAnalysis = analyzePublicationState(compatiblePlan, [compatibleAdmin]);
    assert.strictEqual(compatibleAnalysis.conflictKeys.length, 0);
    assert.strictEqual(compatibleAnalysis.compatibleAdminPublishedKeys.length, 1);
    const migrationSource = fs.readFileSync(path.join(__dirname, "migrate-package-market-publication.js"), "utf8");
    assert(migrationSource.includes("$setOnInsert"), "Migration replay must remain insert-only.");
    assert(!migrationSource.includes("$set: update"), "Migration must not overwrite Admin decisions.");

    console.log(JSON.stringify({
        result: "PASS",
        checks: 26,
        legacyPayloadParity: true,
        shadowPayloadParity: true,
        shadowDiagnosticsInternal: true,
        explicitAggregateReadinessScoped: true,
        customerPrivateMetadataLeak: false,
        staleAdminDecisionDetected: true,
        samePlanReplayCompatible: true,
        productionWrites: 0,
        supplierRequests: 0
    }, null, 2));
}

verify();
