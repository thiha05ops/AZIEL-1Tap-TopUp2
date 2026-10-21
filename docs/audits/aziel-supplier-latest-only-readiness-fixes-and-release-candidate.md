# AZIEL Supplier Latest-Only Readiness Fixes and Release Candidate

**Date:** 2026-10-21  
**Scope:** Local source changes, synthetic tests, and a disposable loopback MongoDB replica set only. No production database, supplier endpoint, deployment, Render setting, feature activation, migration, index operation, cleanup, commit, or push was used.

## Outcome

The two requested local blockers are resolved:

1. Cost-authority review and promotion now fail closed in latest-only mode when validated latest evidence is absent, invalid, corrupt, mismatched, or bound to an ineligible/missing run. Legacy mode still uses the existing catalog-offer behavior.
2. A clean release candidate was assembled from tracked `HEAD` plus the explicit allowlist below. It contains none of the unrelated dirty-worktree changes.

This does not authorize production deployment or activation. Production topology, explicit transaction durability, Atlas headroom, collection creation, restore verification, monitoring, and rollback rehearsal remain open.

## Safety change

- `supplierLatestCostService` now validates persisted latest evidence on read, including amount, currency, timestamp, hashes, terminal run state, run/supplier/namespace identity, and recalculated observed-cost hash.
- `supplierCostAuthorityService` exposes latest-evidence requirement through its repository boundary. In latest-only mode, a missing row raises `SUPPLIER_LATEST_COST_EVIDENCE_REQUIRED`; corrupt/ineligible evidence raises `SUPPLIER_LATEST_COST_EVIDENCE_INVALID`; catalog/latest identity disagreement raises `SUPPLIER_LATEST_COST_EVIDENCE_MISMATCH`.
- Both review and promotion use the same fail-closed `trustedContext` boundary.
- Legacy mode does not require a latest row and retains its prior catalog-offer path.

## Explicit release overlay allowlist

The candidate at `/private/tmp/aziel-latest-only-rc.EQXeU7/app` was created from clean `HEAD` and only these workspace files were overlaid:

1. `backend/config/supplierCostEvidencePolicy.js`
2. `backend/models/SupplierCatalogCostVersion.js`
3. `backend/models/SupplierCatalogLatestCost.js`
4. `backend/models/SupplierCatalogRunEvidenceManifest.js`
5. `backend/services/supplierCatalog/supplierCostEvidenceService.js`
6. `backend/services/supplierCatalog/supplierLatestCostService.js`
7. `backend/services/supplierCatalog/supplierCatalogMongoRepositories.js`
8. `backend/services/supplierCatalog/supplierCostAuthorityService.js`
9. `backend/services/supplierCatalog/weeklySupplierCostSyncService.js`
10. `backend/services/supplierCatalog/providers/fazerCardsCatalogIngestionService.js`
11. `backend/services/supplierCatalog/providers/wonddCatalogIngestionService.js`
12. `backend/scripts/recover-fazercards-catalog-production.js`
13. `backend/scripts/verify-commerce-pricing-production-integration.js`
14. `backend/scripts/verify-fazercards-catalog-recovery.js`
15. `backend/scripts/verify-shared-payment-checkout.js`
16. `backend/scripts/verify-wondd-catalog-ingestion.js`
17. `backend/scripts/verify-supplier-cost-authority-actions.js`
18. `backend/scripts/verify-supplier-cost-evidence-v2.js`
19. `backend/scripts/verify-supplier-latest-cost.js`
20. `backend/scripts/verify-supplier-observation-growth-optimization.js`
21. `backend/scripts/verify-legacy-terminal-run-evidence.js`
22. `backend/scripts/verify-fazercards-final-isolated-integration.js`
23. `backend/scripts/verify-fazercards-os-process-restart.js`
24. `backend/scripts/verify-fazercards-replica-set-faults.js`
25. `backend/scripts/fixtures/fazercards-restart-worker.js`
26. `backend/scripts/lib/assertIsolatedMongoUri.js`
27. `docs/audits/aziel-supplier-latest-only-cost-implementation.md`
28. `docs/audits/aziel-supplier-latest-only-production-migration-cleanup-runbook.md`
29. `docs/audits/aziel-supplier-latest-only-readiness-fixes-and-release-candidate.md`
30. `package.json`

The candidate uses the clean tracked base for every other file. Environment files/backups, local archives, media uploads, prototypes, patch/tar artifacts, and unrelated payment/UI work from the dirty workspace were not overlaid. `node_modules` is not part of the candidate; local verification used the workspace dependency directory through `NODE_PATH`.

## Verification

All commands below ran from the isolated candidate unless noted.

| Verification | Result |
|---|---|
| Changed runtime/test syntax checks | **PASS** |
| Runtime import/dependency load | **PASS** |
| Candidate-vs-clean-HEAD overlay inventory | **PASS; only allowlisted differences** |
| Supplier cost authority | **PASS — 97 checks** |
| Latest-only disposable replica set | **PASS — 25 checks** |
| V2 compatibility | **PASS — 77 checks** |
| FazerCards ingestion | **PASS — 39 checks** |
| WonDD ingestion | **PASS — 40 checks** |
| Weekly supplier cost sync | **PASS — 90 checks** |
| Manual supplier cost sync | **PASS — 38 checks** |
| Commerce pricing production integration | **PASS** |
| Shared-payment checkout | **PASS** |
| Commerce customer checkout | **PASS** |
| Public checkout price refresh | **PASS** |
| Wallet paid auto-fulfillment | **PASS** |
| Both-supplier paid auto-fulfillment | **PASS** |
| WonDD MLBB fulfillment | **PASS; mock transport** |
| FazerCards generic fulfillment | **PASS** |

The authority suite covers missing latest rows, invalid/corrupt evidence, failed and interrupted runs, wrong run identity, wrong supplier identity, valid latest evidence, review blocking, promotion blocking, and unchanged legacy behavior. The replica-set suite additionally corrupts persisted rows directly and proves hash, amount, missing-run, failed-run, and supplier/run identity failures are rejected.

## Remaining blockers

- The release candidate is a local directory, not a commit or deployable approved release artifact.
- Production transaction topology and explicit majority durability remain unverified.
- Current Atlas M0 headroom and growth remain unmeasured.
- `suppliercataloglatestcosts` does not yet have an approved production collection-creation operation.
- Full isolated restoration of the USB dump remains unverified.
- Production monitoring and operator rollback rehearsal remain incomplete.
- The single latest-only flag still couples latest publication and latest readers.

## Verdicts

| Decision | Verdict |
|---|---|
| Cost-authority fail-closed blocker | **RESOLVED locally** |
| Clean candidate/dependency blocker | **RESOLVED locally** |
| Candidate code verification | **GO** |
| Production deployment | **NO-GO** |
| Latest-only activation | **NO-GO** |
| Legacy-write retirement | **NO-GO** |
| Historical cleanup | **NO-GO** |
