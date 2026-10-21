# AZIEL Supplier Catalog Latest-Only Cost Implementation

**Date:** 2026-10-21  
**Scope:** Local code and synthetic/disposable-database verification only. No production database, supplier endpoint, Render setting, deployment, migration, deletion, TTL, index operation, commit, or push was performed.

## Outcome

A default-OFF latest-only mode now maintains at most one validated supplier-cost document per supplier offer. The document is replaced on every terminal successful observation, including unchanged prices. It retains exact supplier/offer identity, amount, currency, source revision, snapshot hash, freshness, and ingestion-run identity, but no price history or per-run manifest.

The activation flag is `SUPPLIER_COST_LATEST_ONLY_ENABLED=true`. It defaults OFF. While enabled it suppresses V2 version/manifest writes. Legacy observation writes remain fail-safe ON unless the operator also explicitly sets `SUPPLIER_COST_EVIDENCE_LEGACY_WRITE_ENABLED=false`.

## Architecture

- `SupplierCatalogOffer` remains the current catalog row and retains its existing ingestion, availability, mapping, pricing, and fulfillment semantics.
- `SupplierCatalogLatestCost` uses the offer ID as `_id`, guaranteeing one document per offer through MongoDB's built-in primary-key index.
- Run finalization and latest-cost publication execute in one MongoDB transaction. A validation or write failure rolls both back, leaving the run nonterminal and the previous latest costs intact.
- Replacement uses `validatedObservedAt` compare-and-set semantics. An older run cannot replace a newer published cost. An identical replay is idempotent.
- Complete and partial successful runs publish only offers genuinely present in the validated current response. Missing offers are not updated.
- Weekly reconciliation in latest-only mode reads the one latest record and requires its `ingestionRunId` to equal the requested reconciliation run. It overlays this validated evidence onto the catalog identity, so a newer failed/interrupted catalog write cannot become approval evidence or block the last validated value.
- Cost-authority review and promotion use the latest validated record when latest-only mode is enabled. Existing `SupplierCostAuthorityChange` records and `WeeklySupplierCostApproval` records are unchanged.
- Customer selling-price authority remains `SupplierProductMapping.supplierCostAuthority`; ingestion does not publish selling prices.
- Checkout quotes, frozen order amounts, payments, wallet balances, and frozen fulfillment routes were not modified.

## Modified files

- `backend/config/supplierCostEvidencePolicy.js`
- `backend/models/SupplierCatalogLatestCost.js` (new)
- `backend/services/supplierCatalog/supplierLatestCostService.js` (new)
- `backend/services/supplierCatalog/supplierCatalogMongoRepositories.js`
- `backend/services/supplierCatalog/providers/fazerCardsCatalogIngestionService.js`
- `backend/services/supplierCatalog/providers/wonddCatalogIngestionService.js`
- `backend/services/supplierCatalog/weeklySupplierCostSyncService.js`
- `backend/services/supplierCatalog/supplierCostAuthorityService.js`
- `backend/scripts/verify-supplier-latest-cost.js` (new)
- `backend/scripts/recover-fazercards-catalog-production.js`
- `backend/scripts/verify-fazercards-catalog-recovery.js`
- `backend/scripts/verify-commerce-pricing-production-integration.js`
- `backend/scripts/verify-shared-payment-checkout.js`
- `package.json`
- `docs/audits/aziel-supplier-latest-only-cost-implementation.md` (new)
- `docs/audits/aziel-supplier-latest-only-production-migration-cleanup-runbook.md` (new)

The working tree contained pre-existing modifications and untracked V2 files before this work. No unrelated changes were removed or reset.

## Verification results

### New disposable replica-set suite

Command:

```sh
npm run verify:supplier-latest-cost
```

Result: **PASS — 20 checks**.

Verified:

- latest-only and all other new behavior default OFF;
- latest-only mode suppresses V2 history writes;
- legacy history can be explicitly disabled only after latest-only is enabled;
- unchanged price replaces freshness/run identity without increasing document count;
- changed price still retains one document;
- older concurrent completion cannot overwrite newer evidence;
- partial success advances only an observed offer;
- a missing partial-run offer receives no evidence;
- failed runs are rejected;
- invalid/interrupted transactional publication rolls back both run finalization and latest cost;
- exact-run weekly evidence resolves only for the currently published run;
- superseded runs cannot masquerade as current latest evidence;
- weekly reconciliation uses validated latest evidence instead of a newer unvalidated catalog-offer value;
- identical retry converges without growth.

Environment: one-node `mongodb-memory-server` replica set on loopback, synthetic data only, zero supplier calls and zero production connections.

### Passing existing suites

- `npm run verify:supplier-cost-evidence-v2` — **PASS, 77 checks**
- `npm run verify:legacy-terminal-run-evidence` — **PASS, 16 checks** after rerun with loopback permission
- `npm run verify:weekly-supplier-cost-sync` — **PASS, 90 checks**
- `npm run verify:manual-supplier-cost-sync` — **PASS, 38 checks**
- `npm run verify:fazercards-catalog-ingestion` — **PASS, 39 checks**
- `npm run verify:wondd-catalog-ingestion` — **PASS, 40 checks**
- `npm run verify:supplier-cost-authority-actions` — **PASS, 75 checks**
- `npm run verify:paid-auto-fulfillment-end-to-end` — **PASS for WonDD and FazerCards, TH and MM, success and failure paths**
- `node backend/scripts/verify-wondd-mlbb-fulfillment.js` — **PASS, mock transport only**
- `npm run verify:fazercards-generic-fulfillment-contract` — **PASS**
- `npm run verify:wallet-paid-auto-fulfillment` — **PASS**
- `npm run verify:commerce-customer-checkout-integration` — **PASS**
- `npm run verify:public-checkout-price-refresh` — **PASS**
- syntax checks and `git diff --check` — **PASS**

### Production-readiness follow-up (2026-10-21)

- `npm run verify:commerce-pricing-production-integration` — **PASS**. The earlier `CATALOG_UNAVAILABLE` was a pre-existing verifier-boundary mismatch: the July 26 fixture mocked `CatalogPackage.findOne`, while the checkout path had used the public/explicit catalog resolver since September. The verifier now injects its synthetic package at the supported `loadCatalogPackage` dependency boundary. Application pricing logic was not changed.
- `npm run verify:shared-payment-checkout` — **PASS**. The verifier referenced product-specific HTML files removed by the generic `frontend/product.html` storefront migration. It now verifies the current generic product page plus wallet page. Application checkout logic was not changed.
- `npm run verify:fazercards-catalog-recovery` — **PASS, 16 checks**. Legacy same-run observation repair remains available with latest-only OFF. With latest-only ON the script fails closed before MongoDB connection or supplier access and requires a fresh normal manual sync. Reusing an abandoned run after a newly timed supplier fetch would violate latest evidence's run/freshness binding.
- Repeated broader suites passed: latest-only **20**, FazerCards ingestion **39**, WonDD ingestion **40**, weekly sync **90**, cost authority **75**, pricing quote runtime, customer checkout, public checkout price refresh, wallet paid fulfillment, both-supplier end-to-end fulfillment, WonDD mock fulfillment, and FazerCards generic fulfillment.
- `git diff --check` and syntax checks for all four follow-up scripts — **PASS**.

Still unavailable: exact process kill during a multi-document transaction, real Atlas primary election, production collection creation/capacity/query plans/telemetry, current storage headroom, restore rehearsal, and production rollback rehearsal.

## Compatibility conflict and retained protections

Latest-only storage cannot provide historical per-run cost evidence after a record has been replaced. Historical approval documents and authority-change audit records are therefore preserved permanently; they contain frozen amount, currency, hashes, actor, reason, and ingestion-run identity but do not reference an observation document by `_id`.

An old, unconsumed approval cannot safely be replayed after its offer's latest record has advanced. Existing exact-candidate comparison correctly forces re-preparation rather than silently approving a different run. This is an intentional integrity constraint, not removed to satisfy latest-only storage.

## Remaining blockers

- The application changes are in a dirty working tree and require normal review/release isolation.
- The latest collection does not exist in production; production auto-create is disabled.
- Transactions require a replica-set-capable MongoDB topology and appropriate write concern.
- Latest-only recovery intentionally requires a fresh normal ingestion run; the old same-run recovery remains legacy-only and fails closed in latest-only mode.
- Production shadow parity and current Atlas storage headroom are unverified.
- Backup restoration has not been proven. The USB archive is preserved but **full restoration remains unverified**.
- No operational telemetry for latest publication count, stale compare-and-set rejection, or transaction abort has yet been connected to production monitoring.
- The single latest-only flag couples publishing and reading. It does not provide a true write-only shadow phase; activation needs a controlled window in which complete successful syncs for both suppliers can populate the collection before latest-only readers are relied upon.

## Verdicts

| Stage | Verdict |
|---|---|
| Local architecture and isolated continuation | **GO** |
| Code review | **GO; the reported verifier blockers are resolved locally** |
| Production deployment with flag OFF | **NO-GO pending clean release review and operational prerequisites** |
| Latest-only feature activation | **NO-GO pending migration prerequisites and operational verification** |
| Disable legacy observation writes | **NO-GO** |
| Delete or archive historical observations | **NO-GO** |

