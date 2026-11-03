"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readSupplierCatalogIngestionPolicy, readWeeklySupplierCostSyncPolicy } = require("../config/supplierCatalogIngestionPolicy");
const { createWeeklySupplierCostSyncService, validateCandidate, immutableCandidate, manifestHash } = require("../services/supplierCatalog/weeklySupplierCostSyncService");
const { createWeeklySupplierCostApprovalService } = require("../services/supplierCatalog/weeklySupplierCostApprovalService");
const { createWeeklySupplierCostJobLeaseService } = require("../services/supplierCatalog/weeklySupplierCostJobLeaseService");
const fazer = require("../services/supplierCatalog/providers/fazerCardsCatalogIngestionService");
const wondd = require("../services/supplierCatalog/providers/wonddCatalogIngestionService");
const { workspaceSupplierCostState } = require("../services/commerce/adminPricingControlCenterService");

let checks = 0;
const ok = (value, message) => { assert(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const now = new Date("2026-10-10T20:00:00.000Z");
const selection = { productCode: "mlbb", packageCode: "MLBB_10", customerMarket: "GLOBAL", supplierMappingId: "m1" };
const supplier = { _id: "s1", supplierCode: "FAZERCARDS" };
const mapping = { _id: "m1", supplierId: "s1", supplierCode: "FAZERCARDS", supplierCatalogOfferId: "o1", productCode: "mlbb", packageCode: "MLBB_10", supplierProductCode: "mobile_legends_global", supplierPackageCode: "10_diamonds", updatedAt: now, supplierCostAuthority: { rawSupplierCost: 1, supplierCurrency: "USD", capturedAt: now, fundingCost: 0, otherAcquisitionCost: 0 } };
const offer = { _id: "o1", supplierId: "s1", supplierCatalogProductId: "sp1", catalogNamespace: "FAZERCARDS_RESELLER_CATALOG", supplierProductCode: "mobile_legends_global", supplierOfferCode: "10_diamonds", catalogLifecycleState: "ACTIVE", supplierCost: { amount: 1.1, currency: "USD", observedAt: now }, sourceRevision: "r1", rawSnapshotHash: "a".repeat(64) };
const observation = { supplierCatalogOfferId: "o1", supplierCatalogProductId: "sp1", supplierId: "s1", catalogNamespace: offer.catalogNamespace, supplierProductCode: offer.supplierProductCode, supplierOfferCode: offer.supplierOfferCode, amount: 1.1, currency: "USD", observedAt: now, ingestionRunId: "111111111111111111111111" };
const availability = { supplierCatalogOfferId: "o1", state: "AVAILABLE", observedAt: now, staleAt: null, observationRunId: observation.ingestionRunId };
const policy = { maximumObservationAgeMs: 86_400_000, maximumAutomaticChangePercent: 20 };
const candidate = overrides => validateCandidate({ selection: overrides?.selection || selection, mapping: overrides?.mapping === undefined ? mapping : overrides.mapping, offer: overrides?.offer === undefined ? offer : overrides.offer, observation: overrides?.observation === undefined ? observation : overrides.observation, availability: overrides?.availability === undefined ? availability : overrides.availability, ingestionRunId: overrides?.ingestionRunId || observation.ingestionRunId, expectedSupplier: overrides?.expectedSupplier === undefined ? supplier : overrides.expectedSupplier, now: now.getTime(), maximumObservationAgeMs: policy.maximumObservationAgeMs, maximumAutomaticChangePercent: policy.maximumAutomaticChangePercent });

async function main() {
    const weeklyDefault = readWeeklySupplierCostSyncPolicy({});
    equal(weeklyDefault.enabled, false, "weekly execution defaults disabled");
    equal(weeklyDefault.scheduleTimeZone, "Asia/Bangkok");
    equal(weeklyDefault.scheduleLocal, "Sunday 03:00");
    equal(weeklyDefault.cronUtc, "0 20 * * 6");
    equal(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now), "Sunday 03:00");
    equal(readSupplierCatalogIngestionPolicy({}).suppliers.FAZERCARDS.timeoutMs, 240000, "Fazer receives bounded complete-catalog timeout");
    equal(readSupplierCatalogIngestionPolicy({ SUPPLIER_WEEKLY_COST_SYNC_ENABLED: "true" }).automatedEnabled, false, "external weekly gate cannot enable the web-process scheduler");

    equal(candidate().status, "ACCEPTABLE");
    equal(candidate({ observation: { ...observation, amount: 0 } }).code, "INVALID_SUPPLIER_COST");
    equal(candidate({ observation: { ...observation, amount: -1 } }).code, "INVALID_SUPPLIER_COST");
    equal(candidate({ observation: { ...observation, amount: Infinity } }).code, "INVALID_SUPPLIER_COST");
    equal(candidate({ mapping: { ...mapping, supplierPackageCode: "wrong" } }).code, "NATIVE_SKU_IDENTITY_CONFLICT");
    equal(candidate({ mapping: null }).code, "GLOBAL_MAPPING_MISSING");
    equal(candidate({ offer: null }).code, "SUPPLIER_OFFER_REFERENCE_INVALID");
    equal(candidate({ mapping: { ...mapping, supplierId: "s2" } }).code, "GLOBAL_MAPPING_WRONG_SUPPLIER");
    equal(candidate({ offer: { ...offer, supplierId: "s2" } }).code, "SUPPLIER_OFFER_IDENTITY_CONFLICT");
    equal(candidate({ observation: { ...observation, supplierId: "s2" } }).code, "OBSERVATION_SUPPLIER_IDENTITY_CONFLICT");
    equal(candidate({ observation: { ...observation, catalogNamespace: "WRONG" } }).code, "OBSERVATION_NAMESPACE_CONFLICT");
    const largeMovement = candidate({ mapping: { ...mapping, supplierCostAuthority: { ...mapping.supplierCostAuthority, rawSupplierCost: 0.5 } } });
    equal(largeMovement.status, "ACCEPTABLE");
    equal(largeMovement.warnings[0], "LARGE_COST_MOVEMENT", "large verified movement is an audited warning, not a blocker");
    equal(candidate({ mapping: { ...mapping, supplierCostAuthority: { ...mapping.supplierCostAuthority, supplierCurrency: "THB" } } }).code, "CURRENCY_MISMATCH");
    equal(candidate({ observation: { ...observation, observedAt: new Date(now.getTime() - 90_000_000) } }).code, "STALE_OBSERVATION");
    equal(candidate({ availability: { ...availability, state: "UNKNOWN" } }).code, "SUPPLIER_AVAILABILITY_NOT_CONFIRMED");
    equal(candidate({ availability: { ...availability, observationRunId: "different" } }).code, "SUPPLIER_AVAILABILITY_NOT_CONFIRMED");
    equal(candidate({ availability: { ...availability, observedAt: new Date(now.getTime() - 90_000_000) } }).code, "SUPPLIER_AVAILABILITY_NOT_CONFIRMED");
    equal(candidate({ ingestionRunId: "different" }).code, "OBSERVATION_RUN_IDENTITY_CONFLICT");

    const promoted = new Set(), updates = [];
    const repos = {
        selections: async () => [selection], mappings: async () => [mapping], offers: async () => [offer], observations: async () => [observation], availability: async () => [availability], supplier: async () => supplier,
        approval: async () => null, createManifest: async value => ({ _id: "a1", ...value }), consumeApproval: async () => null,
        updateRun: async (runId, sync) => updates.push({ runId, sync })
    };
    const promoter = async input => {
        const replayed = promoted.has(input.idempotencyToken);
        promoted.add(input.idempotencyToken);
        return { replayed };
    };
    const service = createWeeklySupplierCostSyncService({ repositories: repos, promoter, clock: () => now });
    const first = await service.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: observation.ingestionRunId, policy, actor: { id: "1".repeat(24), username: "supplier-cost-sync", role: "SYSTEM" } });
    equal(first.updated, 1);
    equal(updates.length, 1);
    const replay = await service.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: observation.ingestionRunId, policy, actor: { id: "1".repeat(24), username: "supplier-cost-sync", role: "SYSTEM" } });
    equal(replay.replayed, 1, "duplicate invocation is idempotent");
    const dry = await service.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: observation.ingestionRunId, dryRun: true, policy, actor: {} });
    equal(dry.decisions[0].status, "DRY_RUN_ACCEPTABLE");
    equal(updates.length, 2, "dry run does not update run metadata");
    const missingMappingService = createWeeklySupplierCostSyncService({ repositories: { ...repos, mappings: async () => [], offers: async () => [], observations: async () => [] }, promoter, clock: () => now });
    const missingMapping = await missingMappingService.reconcile({ supplierCode: "FAZERCARDS", dryRun: true, policy, actor: {} });
    equal(missingMapping.decisions[0].code, "GLOBAL_MAPPING_MISSING", "missing GLOBAL mapping remains visible as REVIEW_REQUIRED");
    const wrongSupplierService = createWeeklySupplierCostSyncService({ repositories: { ...repos, mappings: async () => [{ ...mapping, supplierId: "s2" }] }, promoter, clock: () => now });
    const wrongSupplier = await wrongSupplierService.reconcile({ supplierCode: "FAZERCARDS", dryRun: true, policy, actor: {} });
    equal(wrongSupplier.decisions[0].code, "GLOBAL_MAPPING_WRONG_SUPPLIER", "wrong-supplier GLOBAL mapping remains visible as REVIEW_REQUIRED");

    const initialMapping = { ...mapping, supplierCostAuthority: {} };
    const initialDecision = candidate({ mapping: initialMapping });
    equal(initialDecision.code, "FRESH_EXACT_INITIAL_COST");
    const approvedCandidate = immutableCandidate(initialDecision), approvedHash = manifestHash([approvedCandidate]);
    const initialRepos = { ...repos, mappings: async () => [initialMapping] };
    let initialPromotions = 0, promotedInput = null;
    const initialService = createWeeklySupplierCostSyncService({ repositories: initialRepos, promoter: async input => { initialPromotions += 1; promotedInput = input; return { replayed: initialPromotions > 1 }; }, clock: () => now });
    const automatic = await initialService.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: observation.ingestionRunId, policy, actor: { id: "1".repeat(24), username: "automation", role: "SYSTEM" } });
    equal(automatic.updated, 1, "verified exact API evidence automatically establishes initial authority");
    equal(promotedInput.verificationMode, "AUTOMATIC_VERIFIED_API");
    equal(promotedInput.ingestionRunId, observation.ingestionRunId);
    const automaticReplay = await initialService.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: observation.ingestionRunId, policy, actor: {} });
    equal(automaticReplay.replayed, 1, "automatic initial promotion replay is idempotent");
    let interruptedAttempts = 0;
    const interruptedService = createWeeklySupplierCostSyncService({ repositories: initialRepos, promoter: async () => { interruptedAttempts += 1; if (interruptedAttempts === 1) throw Object.assign(new Error("interrupted"), { code: "SIMULATED_INTERRUPTION" }); return { replayed: false }; }, clock: () => now });
    const interrupted = await interruptedService.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: observation.ingestionRunId, policy, actor: {} });
    equal(interrupted.decisions[0].code, "SIMULATED_INTERRUPTION", "interrupted promotion remains reviewable and unconsumed");
    const resumed = await interruptedService.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: observation.ingestionRunId, policy, actor: {} });
    equal(resumed.updated, 1, "interrupted promotion can resume with the same immutable evidence");

    let approvalRecord = { _id: "a1", manifestHash: approvedHash, candidates: [approvedCandidate], status: "PENDING", maximumInitialPromotions: null, expiresAt: null, approvedBy: {} };
    const ApprovalModel = {
        findOne: () => ({ lean: async () => approvalRecord }),
        findById: () => ({ lean: async () => approvalRecord }),
        findOneAndUpdate: (query, update) => ({ lean: async () => { approvalRecord = { ...approvalRecord, ...update.$set }; return approvalRecord; } })
    };
    const accounts = new Map([
        ["1".repeat(24), { _id: "1".repeat(24), username: "owner", role: "OWNER", status: "ACTIVE" }],
        ["2".repeat(24), { _id: "2".repeat(24), username: "manager", role: "OPERATIONS", status: "ACTIVE" }],
        ["3".repeat(24), { _id: "3".repeat(24), username: "disabled-owner", role: "OWNER", status: "DISABLED" }]
    ]);
    const AdminModel = { findOne: query => ({ lean: async () => { const account = accounts.get(String(query._id)); return account?.status === query.status && account?.role === query.role ? account : null; } }) };
    const SessionModel = { findOne: query => ({ lean: async () => query.sessionId === `session-${String(query.adminId)}` ? { sessionId: query.sessionId, adminId: query.adminId } : null }) };
    const approvalService = createWeeklySupplierCostApprovalService({ Model: ApprovalModel, AdminModel, SessionModel, clock: () => now });
    const approvalInput = actor => ({ manifestHash: approvedHash, maximumInitialPromotions: 1, expiresAt: new Date(now.getTime() + 60_000), confirmed: true, actor });
    const sessionActor = id => ({ id, sessionId: `session-${id}` });
    await assert.rejects(() => approvalService.approve(approvalInput({ ...sessionActor("2".repeat(24)), role: "OWNER" })), error => error.code === "OWNER_APPROVAL_REQUIRED"); checks += 1;
    await assert.rejects(() => approvalService.approve(approvalInput({ ...sessionActor("3".repeat(24)), role: "OWNER" })), error => error.code === "OWNER_APPROVAL_REQUIRED"); checks += 1;
    await assert.rejects(() => approvalService.approve(approvalInput({ ...sessionActor("4".repeat(24)), role: "OWNER" })), error => error.code === "OWNER_APPROVAL_REQUIRED"); checks += 1;
    await assert.rejects(() => approvalService.approve(approvalInput({ id: "1".repeat(24), role: "OWNER" })), error => error.code === "OWNER_APPROVAL_REQUIRED"); checks += 1;
    await assert.rejects(() => approvalService.approve({ ...approvalInput(sessionActor("1".repeat(24))), confirmed: false }), error => error.code === "EXPLICIT_OWNER_CONFIRMATION_REQUIRED"); checks += 1;
    const ownerApproval = await approvalService.approve(approvalInput({ ...sessionActor("1".repeat(24)), username: "forged", role: "SUPPORT" }));
    equal(ownerApproval.replayed, false, "OWNER can approve exact immutable manifest");
    equal(String(ownerApproval.approval.approvedBy.adminId), "1".repeat(24), "approval persists the authenticated OWNER AdminAccount ObjectId");
    equal(ownerApproval.approval.approvedBy.username, "owner", "approval snapshots persisted account identity, not caller claims");
    await assert.rejects(() => approvalService.approve({ ...approvalInput(sessionActor("1".repeat(24))), maximumInitialPromotions: 2 }), error => error.code === "APPROVAL_IMMUTABLE"); checks += 1;

    let leaseRecord = null, leaseNow = new Date(now);
    const Lease = {
        findOneAndUpdate: async (query, update) => { if (!leaseRecord || leaseRecord.expiresAt <= leaseNow || (query._id && query.ownerId === leaseRecord.ownerId && leaseRecord.expiresAt > leaseNow)) { leaseRecord = { ...(leaseRecord || { _id: "l1", version: 0 }), ...(update.$set || {}), version: (leaseRecord?.version || 0) + (update.$inc?.version || 0) }; return leaseRecord; } return null; },
        create: async value => { if (leaseRecord) throw Object.assign(new Error("duplicate"), { code: 11000 }); leaseRecord = { _id: "l1", ...value }; return leaseRecord; },
        findOne: async query => query.ownerId === leaseRecord?.ownerId && leaseRecord.expiresAt > leaseNow ? leaseRecord : null,
        deleteOne: async query => { if (query.ownerId === leaseRecord?.ownerId) leaseRecord = null; return { deletedCount: 1 }; }
    };
    const leaseService = createWeeklySupplierCostJobLeaseService({ Lease, clock: () => leaseNow, ownerId: () => "owner-1" });
    const lease = await leaseService.acquire({ runKey: "run-1", ttlMs: 1000 });
    await assert.rejects(() => createWeeklySupplierCostJobLeaseService({ Lease, clock: () => leaseNow, ownerId: () => "owner-2" }).acquire({ runKey: "run-2", ttlMs: 1000 }), error => error.code === "WEEKLY_SUPPLIER_COST_SYNC_ALREADY_RUNNING"); checks += 1;
    leaseNow = new Date(now.getTime() + 500); await leaseService.renew(lease, 1000); ok(leaseRecord.expiresAt > new Date(now.getTime() + 1000), "weekly job lease renews safely");
    leaseNow = new Date(now.getTime() + 2000); await assert.rejects(() => leaseService.assertOwned(lease), error => error.code === "WEEKLY_SUPPLIER_COST_SYNC_LEASE_LOST"); checks += 1;

    const currentMapping = { ...mapping, supplierCostAuthority: { ...mapping.supplierCostAuthority, capturedAt: new Date(), observedAt: new Date(), providerProductCode: mapping.supplierProductCode, providerOfferCode: mapping.supplierPackageCode, ingestionRunId: observation.ingestionRunId, rawSnapshotHash: "a".repeat(64), observedCostHash: "b".repeat(64), verificationMode: "AUTOMATIC_VERIFIED_API" } };
    const authority = workspaceSupplierCostState(currentMapping, offer.supplierCost);
    equal(authority.status, "INVALID_AUTHORITY");
    equal(authority.previewSupplierCost, null, "automatic authority requires matching validated latest evidence");
    equal(workspaceSupplierCostState({ supplierCostAuthority: {} }, offer.supplierCost).previewSupplierCost, null, "unpromoted catalog observation cannot drive preview");
    equal(workspaceSupplierCostState({ ...currentMapping, supplierCostAuthority: { ...currentMapping.supplierCostAuthority, capturedAt: new Date(0), observedAt: new Date(0) } }, offer.supplierCost).previewSupplierCost, null, "stale authority cannot drive preview");
    equal(workspaceSupplierCostState({ ...currentMapping, supplierCostAuthority: {}, mappingMetadata: { supplierCost: { rawSupplierCost: 99, supplierCurrency: "USD" } } }, offer.supplierCost).previewSupplierCost, null, "legacy mapping metadata cannot drive preview");
    equal(workspaceSupplierCostState({ supplierCostAuthority: { rawSupplierCost: null } }, null).approvedSupplierCost, null, "missing authority never becomes a zero-cost fallback");
    const exactLatest = { ...offer.supplierCost, amount: 1, ingestionRunId: observation.ingestionRunId, rawSnapshotHash: currentMapping.supplierCostAuthority.rawSnapshotHash, observedCostHash: currentMapping.supplierCostAuthority.observedCostHash };
    equal(workspaceSupplierCostState(currentMapping, exactLatest).status, "AUTHORITATIVE");

    let inFlight = 0, maximumInFlight = 0;
    const concurrentStage = await fazer.stageCatalog({
        reader: {
            listCategories: async () => ({ items: Array.from({ length: 16 }, (_, index) => ({ category_id: `game_${index}`, name: `Game ${index}`, note: "Region: GLOBAL" })), meta: {} }),
            listOffers: async categoryId => {
                inFlight += 1; maximumInFlight = Math.max(maximumInFlight, inFlight);
                await new Promise(resolve => setImmediate(resolve));
                inFlight -= 1;
                return { offers: [{ offer_id: `${categoryId}_10`, name: "10 Diamonds", price_usd: 1 }], fields: [], no_customer_input: true };
            }
        }, supplierId: "s1", mappings: [], observedAt: now
    });
    equal(maximumInFlight, fazer.OFFER_READ_CONCURRENCY, "Fazer offer reads use bounded concurrency");
    equal(concurrentStage.coverageState, "COMPLETE", "all categories must complete before complete coverage");
    equal(concurrentStage.categoryResults.filter(row => row.complete).length, 16);

    const partialFazer = fazer.planMutations({ supplierId: "s1", observedAt: now, coverageState: "PARTIAL", products: [], offers: [], errors: [{ code: "TIMEOUT" }], categoryResults: [] }, { offers: [offer], products: [] });
    equal(partialFazer.missing.length, 0, "failed/partial Fazer refresh preserves previous offers");
    const partialWondd = wondd.planMutations({ supplierId: "s2", observedAt: now, products: [], offers: [], errors: [], contentRevision: "x", completenessEvidence: "SINGLE_RESPONSE_COMPLETENESS_UNPROVEN" }, { offers: [offer], products: [] });
    equal(partialWondd.missing.length, 0, "WonDD partial response never retires missing offers");
    equal(fazer.OFFER_READ_CONCURRENCY, 8, "Fazer reads offers with bounded concurrency");

    const root = path.resolve(__dirname, "..");
    const job = fs.readFileSync(path.join(root, "scripts/run-weekly-supplier-cost-sync.js"), "utf8");
    const syncSource = fs.readFileSync(path.join(root, "services/supplierCatalog/weeklySupplierCostSyncService.js"), "utf8");
    const approvalSource = fs.readFileSync(path.join(root, "services/supplierCatalog/weeklySupplierCostApprovalService.js"), "utf8");
    const ownerAuthorizationSource = fs.readFileSync(path.join(root, "services/adminOwnerAuthorizationService.js"), "utf8");
    const supplierRoutes = fs.readFileSync(path.join(root, "routes/supplier.js"), "utf8");
    const pricingUi = fs.readFileSync(path.resolve(root, "../frontend/js/admin-pricing-engine.js"), "utf8");
    ok(job.includes("reconcileSellability: false"), "weekly ingestion cannot reconcile storefront selection");
    ok(job.includes('trigger: "EXTERNAL_SCHEDULED"'), "weekly job uses the external scheduler authority");
    ok(job.includes("dryRun ? await operation(async () => true) : await withJobLease"), "dry-run bypasses the database-backed job lease and remains read-only");
    ok(job.includes("const heartbeat = setInterval") && !job.includes("scheduleJob") && !job.includes("node-cron"), "the only in-process timer renews the durable job lease; scheduling remains external");
    ok(!job.includes("approve-manifest") && !job.includes('role: "OWNER"'), "automation CLI cannot approve or impersonate an OWNER");
    ok(job.includes("SUPPLIER_COST_APPROVAL_MANIFEST_OPERATION_OBSOLETE") && !job.includes("Approval.findById"), "obsolete manifest operations fail closed without loading or applying a manifest");
    ok(job.includes("loadAutomationActor") && job.includes("role: { $ne: ROLES.OWNER }") && job.includes("automationActorId"), "scheduler loads a persisted active non-OWNER audit identity");
    ok(approvalSource.includes("requireAuthenticatedOwner") && ownerAuthorizationSource.includes("AdminModel.findOne") && ownerAuthorizationSource.includes("SessionModel.findOne") && ownerAuthorizationSource.includes("status: STATUSES.ACTIVE") && ownerAuthorizationSource.includes("role: ROLES.OWNER"), "approval service verifies persisted active OWNER and live Admin session state");
    ok(supplierRoutes.includes('/admin/weekly-supplier-cost/manifests/:manifestHash/approve') && supplierRoutes.includes("PERMISSIONS.OWNER_ROUTING_MANAGE"), "approval is exposed only through authenticated Owner-authorized Admin infrastructure");
    for (const forbidden of ["CatalogPackage", "PackageMarketPublication", "PricingQuote", "CommerceOrder", "PaymentAttempt", "FulfillmentAttempt", "publishDailyPricing", "startFulfillment", "submitTopup", "validatePlayerId"]) {
        ok(!syncSource.includes(forbidden), `cost sync excludes ${forbidden}`);
    }
    ok(!pricingUi.includes("row.supplierCost ?? row.savedDraftSupplierCost ?? row.publishedSupplierPrice"), "customer selling price is not a supplier-cost fallback");
    ok(pricingUi.includes("UNPUBLISHED"), "draft recommendation is explicitly unpublished");
    ok(syncSource.includes('customerMarket: "GLOBAL"'), "only GLOBAL selections are considered");
    ok(syncSource.includes("supplierProductCode !== offer.supplierProductCode"), "native supplier SKU identity is exact");
    ok(syncSource.includes("LARGE_COST_MOVEMENT"), "large changes retain an audited warning");
    ok(syncSource.includes("SUPPLIER_OFFER_IDENTITY_CONFLICT") && syncSource.includes("OBSERVATION_SUPPLIER_IDENTITY_CONFLICT"), "supplier identity is exact across mapping, offer and observation");
    ok(syncSource.includes("AUTOMATIC_VERIFIED_API"), "verified API evidence promotes initial authority automatically");

    console.log(JSON.stringify({ result: "PASS", checks, schedule: { local: weeklyDefault.scheduleLocal, timeZone: weeklyDefault.scheduleTimeZone, cronUtc: weeklyDefault.cronUtc }, catalogWritesInOfflineTest: 0, productionConnections: 0, supplierCalls: 0, publicationWrites: 0, orderWrites: 0, paymentWrites: 0, fulfillmentWrites: 0 }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
