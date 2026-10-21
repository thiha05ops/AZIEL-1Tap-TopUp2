# AZIEL Supplier Latest-Only Production Migration and Cleanup Runbook

This is a proposed future runbook. It was not executed. Every production phase requires separate owner approval.

## Safety principles

- Never combine deployment, activation, legacy-write retirement, and cleanup into one change window.
- Preserve `SupplierCostAuthorityChange`, `WeeklySupplierCostApproval`, ingestion runs, mappings, quotes, orders, payment records, wallet ledgers, and fulfillment attempts.
- Do not rewrite historical hashes or frozen prices.
- Do not treat file copy completion as restore proof. The existing USB archive remains untouched, but full restoration is unverified.
- MongoDB document deletion does not guarantee immediate WiredTiger file shrinkage or Atlas quota reclamation. Measure Atlas accounting after any future cleanup before claiming reclaimed capacity.

## Historical dependency inventory

Current source inspection found no durable foreign key from approvals or authority changes to an observation document `_id`:

- weekly approvals freeze ingestion-run ID, amount, currency, observed time, offer/mapping identities, and observed-cost hash;
- authority changes freeze observed cost, revision, snapshot hash, observed-cost hash, actor, reason, and before/after authority state.

Dependencies that still query `suppliercatalogcostobservations` include:

- legacy weekly reconciliation mode;
- legacy cost-authority recent-history display;
- V2 missing-manifest fallback;
- `recover-fazercards-catalog-production.js`;
- production verification/index scripts and legacy test harnesses.

Cleanup is forbidden until all runtime and operator dependencies are either latest-only capable or formally retired.

## Phase 0 — prerequisites

1. Confirm the locally repaired Commerce Pricing, Shared-Payment, and FazerCards recovery verifiers pass in the reviewed release artifact.
2. Produce a clean reviewed release diff.
3. Confirm the production deployment uses a replica-set topology supporting transactions.
4. Obtain current Atlas storage/headroom figures.
   - Use separately approved read-only `dbStats`/`collStats` or Atlas metrics; never infer headroom from logical BSON alone.
   - Measure representative `SupplierCatalogLatestCost` BSON and multiply by the current offer count, then include the `_id` index and a conservative storage-engine overhead allowance.
   - Require remaining capacity after projected initial population to cover at least twice that projected population plus seven days of measured current growth. If Atlas limits/alerts impose a larger reserve, use the larger reserve.
   - Do not rely on deleting observations in the same window to create headroom.
5. Complete and document an actual restore rehearsal to an isolated database.
6. Add alerts for transaction aborts, latest rows attempted/published, stale-run rejections, missing latest rows, and weekly exact-run mismatches.
7. Train operators that FazerCards same-run recovery is legacy-only. In latest-only mode it deliberately fails before database/supplier access; recovery is a fresh normal manual sync with a new run ID.
8. Keep scheduler automation and Weekly Approval disabled unless separately authorized.

Gate: **NO-GO unless every item is complete.**

## Phase 1 — deploy dormant code

1. Create the `suppliercataloglatestcosts` collection through a separately reviewed migration. The built-in `_id` index is sufficient for the implemented access pattern; do not add speculative indexes.
2. Deploy with `SUPPLIER_COST_LATEST_ONLY_ENABLED` absent/OFF.
3. Keep legacy writes ON and both V2 flags OFF.
4. Verify checkout, pricing, payment, wallet, manual sync, and fulfillment health.

Rollback: deploy the prior build. No new data path was active.

## Phase 2 — controlled dual-write activation

This is not a true write-only shadow phase: the current flag couples latest reads and writes. Activation must occur only after the latest collection is ready, Weekly Approval remains paused, and an operator-approved controlled window can populate both suppliers. Keep legacy writes ON throughout.

1. Set `SUPPLIER_COST_LATEST_ONLY_ENABLED=true` only after approval.
2. Keep `SUPPLIER_COST_EVIDENCE_LEGACY_WRITE_ENABLED` unset/true.
3. Keep V2 flags OFF; latest-only policy suppresses V2 writing even if misconfigured.
4. Activate during a controlled window in which cost-authority/approval preparation is not used until both suppliers have a successful sync.
5. Run one controlled manual sync per supplier. A FAILED, RUNNING, EMPTY, or unacceptable PARTIAL result does not satisfy population readiness.
6. Verify the first supplier's run before starting the second, but do not declare latest-reader readiness until both complete.
7. Confirm exactly one latest record per successfully observed offer.
8. Confirm partial/missing offers were not advanced.
9. Compare latest rows with same-run legacy observations for identity, amount, currency, source revision, snapshot hash, observed time, and run ID.
10. Repeat across unchanged and changed supplier costs.

Rollback: set latest-only OFF and restart/redeploy through the normal configuration procedure. Legacy observations remain complete because legacy writing stayed ON. Verify one legacy-mode manual sync and the relevant read paths before closing the rollback.

## Phase 3 — reader validation

1. Exercise Admin cost review using latest-only evidence.
2. In an isolated clone or explicitly approved controlled environment, dry-run weekly reconciliation against exact latest run IDs.
3. Verify initial approval preparation, expiry, replay, source-lock conflict, and cost-authority idempotency.
4. Verify historical approval/audit display without mutation.
5. Complete at least two controlled parity cycles, including partial and retry scenarios.

Gate: any stale evidence, wrong-run acceptance, missing selected-offer evidence, or price-authority mismatch is an immediate rollback and **NO-GO**.

## Phase 4 — retire legacy writes

Only after Phases 0–3 pass:

1. Capture counts and hashes without scanning unbounded fields.
2. Confirm no runtime or operator script requires new observation rows.
3. Keep legacy writing ON for one final successful run for each supplier and record the last legacy-covered run IDs.
4. Set `SUPPLIER_COST_EVIDENCE_LEGACY_WRITE_ENABLED=false` while latest-only remains ON.
5. Perform controlled manual syncs for both suppliers.
6. Verify observation count stops growing and latest count remains bounded by offer count.
7. Rehearse rollback. Rolling latest-only OFF after a latest-only interval cannot reconstruct exact-run legacy rows for that interval. The safe rollback sequence is: pause manual sync/approval preparation, re-enable legacy writes while keeping latest-only ON, complete successful syncs for both suppliers, verify new legacy evidence, then switch latest-only OFF.

Gate: **NO-GO until the rollback procedure is demonstrated.**

## Phase 5 — archive planning

1. Take a consistent export of observations plus ingestion-run metadata.
2. Produce a manifest containing collection namespace, document count, BSON byte count, export-tool version, time range, and SHA-256 checksums.
3. Store the archive in versioned, access-controlled object storage with retention policy and separate checksum manifest.
4. Restore into an isolated MongoDB instance.
5. Verify counts, sampled hashes, run relationships, oldest/newest timestamps, and representative historical approval/audit investigations.
6. Obtain owner sign-off on the restore report.

The existing USB copy does not satisfy this gate without a full restore verification.

## Phase 6 — cleanup, separately authorized

Only after a verified archive, sustained latest-only operation, dependency scan, and rollback rehearsal:

1. Produce an exact dry-run candidate count.
2. Reconfirm no legal, accounting, dispute, or audit retention requirement needs the records online.
3. Use bounded batches with checkpoints and stop thresholds; never a single unbounded delete.
4. Preserve all approvals, authority changes, runs, orders, payments, wallet records, and fulfillment records.
5. Measure logical data size, storage size, index size, and Atlas quota before and after.
6. Do not promise immediate physical reclamation. WiredTiger may retain reusable space and Atlas-reported quota behavior must be observed.

No deletion, TTL, archival, or migration is authorized by this document.

## Final production gates

| Action | Current verdict |
|---|---|
| Dormant deployment | **NO-GO pending release review** |
| Latest-only activation with legacy shadow writes | **NO-GO pending operational prerequisites** |
| Legacy-write retirement | **NO-GO** |
| Observation archive | **NO-GO until restore verification** |
| Observation cleanup | **NO-GO; separate explicit approval required** |

