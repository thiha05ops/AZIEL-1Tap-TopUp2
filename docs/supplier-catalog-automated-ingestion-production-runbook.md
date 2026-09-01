# Supplier Catalog Automated Ingestion Production Runbook

## Authority boundary

This subsystem may update only durable supplier catalog products, offers, availability evidence, ingestion runs, lease locks, and append-only cost observations. It never changes canonical packages, supplier mappings, eligibility, supplier roles, pricing authority, publication, orders, fulfillment, or routing. UNKNOWN and partial coverage remain fail-closed. No automatic failover exists.

## Activation gates

Both global gates default to disabled and accept only the exact string `true`:

- `SUPPLIER_CATALOG_INGESTION_EXECUTION_ENABLED`: permits a controlled catalog ingestion, including an OWNER manual request.
- `SUPPLIER_CATALOG_AUTOMATED_INGESTION_ENABLED`: permits scheduler registration only when execution is also enabled.

Each supplier additionally requires `SUPPLIER_CATALOG_<SUPPLIER>_AUTOMATION_ENABLED=true`. Interval, timeout, retry, backoff, and lease TTL are independently configured with the corresponding `INTERVAL_MS`, `TIMEOUT_MS`, `MAX_ATTEMPTS`, `RETRY_BASE_MS`, `RETRY_MAX_MS`, and `LOCK_TTL_MS` variables. FazerCards and WonDD must be activated and monitored independently.

## Required deployment prerequisite

Deploy and verify the three `SupplierCatalogIngestionLock` indexes before any execution gate is enabled: unique `one_supplier_catalog_ingestion_lock`, `supplier_catalog_ingestion_lock_expiry`, and `supplier_catalog_ingestion_lock_supplier_expiry`. Phase 2I does not authorize that production metadata write.

## Controlled first manual ingestion

1. Keep automated ingestion disabled.
2. Verify lock indexes, provider credentials, no active lease, no RUNNING ingestion, and healthy database connectivity.
3. Record pre-run fingerprints for protected canonical, mapping, pricing, publication, order, and fulfillment collections.
4. Enable only the execution gate during the approved window.
5. An OWNER with `SUPPLIER_CATALOG_INGEST` invokes exactly one supplier from Admin Catalog Automation.
6. Observe the persisted run, coverage evidence, counts, errors, lease release, availability changes, and cost observations.
7. Verify protected fingerprints and public storefront are unchanged, then disable the execution gate.

## Automated activation

After separate review of successful controlled manual runs for each supplier, enable execution, the global automated gate, and only one supplier gate. Confirm exactly one timer and one lease owner, observe at least two intervals, then repeat separately for the other supplier. Do not infer WonDD completeness; do not treat partial coverage as proof of removal.

## Failure and rollback

Disable the automated gate to stop new scheduled runs; restart or graceful shutdown clears local timers. Disable the execution gate to block both scheduled and manual execution. Do not delete durable catalog or run history. Expired leases may be taken over atomically; active leases must never be manually overwritten. Investigate FAILED/PARTIAL runs, repeated retries, stale offers, and persistent lock ownership before reactivation.

## Verification commands

Run the five Phase 2I verifiers from the repository root. The production-readiness verifier is read-only and requires `MONGO_URI`; it performs no supplier network calls and no writes.
