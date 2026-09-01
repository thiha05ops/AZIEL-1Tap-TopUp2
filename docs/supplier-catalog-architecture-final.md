# AZIEL Supplier Catalog Architecture

## Purpose and authority model

The Supplier Catalog records provider-owned facts without converting them into AZIEL business authority. Discovery, observation, reconciliation, mapping, cost approval, readiness, pricing, publication, routing, and fulfillment are independent stages.

Supplier-owned evidence includes provider product and offer identities, market/restriction evidence, availability evidence, observed cost, source revisions, and sanitized snapshots. AZIEL owns canonical products/packages, mappings, roles, customer-market eligibility, execution mode, approved supplier-cost authority, retail pricing, publication, routing, quotes, orders, and fulfillment history.

```text
                         ┌── Scheduler (execution + automation gates)
                         │
Supplier APIs ──> Supplier Catalog Ingestion ──> Mongo lease
                         │
                         ├──> SupplierCatalogProduct
                         ├──> SupplierCatalogOffer
                         ├──> SupplierOfferAvailability
                         ├──> SupplierCatalogCostObservation
                         └──> SupplierCatalogIngestionRun
                                      │
                                      ├── Admin read/health
                                      │
                                      └── Explicit reconciliation (permission + gate)
                                                    │
                                                    v
                                         SupplierProductMapping
                                           │       │       │
                          explicit cost approval   │   explicit role/eligibility
                                           │       │
                                           v       v
                                     Cost authority + Production readiness
                                           │                    │
                         Pricing Engine / publication       Explicit PRIMARY routing
                                  │            │                    │
                                  │      PackageMarketPublication   │
                                  │            │                    │
                                  └────> Public Storefront          │
                                               │                    │
                                         PricingQuote               │
                                               │                    │
                                         CommerceOrder ─────────────┘
                                               │
                                       FulfillmentAttempt
```

## Durable data model

| Model | Authority | Lifecycle |
|---|---|---|
| `SupplierCatalogProduct` | Provider product identity and evidence | Current observed state, identity-upserted |
| `SupplierCatalogOffer` | Provider offer identity, semantics, observed cost | Current observed state, identity-upserted |
| `SupplierOfferAvailability` | Current provider availability evidence | One current record per supplier offer |
| `SupplierCatalogIngestionRun` | Operational run history | Durable per run key |
| `SupplierCatalogIngestionLock` | Short-lived execution lease | Per-supplier scope, owner-checked |
| `SupplierCatalogCostObservation` | Immutable observed-cost evidence | Append-only and hash-idempotent |
| `SupplierCatalogReconciliationDecision` | Human review history | Versioned; one current decision |
| `SupplierCostAuthorityChange` | Human cost-approval history | Append-only and idempotent |
| `SupplierProductMapping` | AZIEL bridge to canonical fulfillment | Explicit mutable business authority |
| `CatalogProduct` / `CatalogPackage` | Canonical customer identity | AZIEL-owned |
| `PackageMarketPublication` | Market publication intent | Explicit Admin authority |
| `PricingPolicy` / `PriceVersion` | Retail pricing authority | Explicit pricing workflow |
| `PricingQuote` / `CommerceOrder` | Customer transaction snapshots | Historical and immutable by ingestion |
| `FulfillmentAttempt` | Explicit supplier execution history | Transactional history |

## Ingestion, coverage, and availability

Provider adapters own HTTP contracts. Normalizers preserve identities and semantic distinctions; display-name similarity never creates canonical identity.

FazerCards coverage is `COMPLETE` only when discovery and every supported category succeed. A positive observation is `AVAILABLE`. Absence from a proven complete snapshot becomes `UNKNOWN`/stale with an incremented missing count, never immediate `UNAVAILABLE`. Partial or failed reads suppress missing transitions.

WonDD coverage remains `PARTIAL` because its single package response has no completeness proof. Absence never causes missing, retirement, mapping, publication, role, or routing changes.

Availability is evidence used as a suppressive readiness input. It is not publication, mapping, or routing authority.

## Reconciliation and mapping

Reconciliation is an OWNER-only reviewed action protected by `SUPPLIER_CATALOG_RECONCILIATION_MUTATIONS_ENABLED=true`. It requires an exact source/revision/cost lock, explicit target and decision, idempotency, and a Mongo transaction. A new mapping is fail-closed: disabled, role `DISABLED`, execution `MANUAL`, eligibility `UNKNOWN`, no approved cost, and no publication/pricing impact. Canonical creation is a separate authority.

`SupplierProductMapping` retains provider and canonical identities, linked catalog offer, market eligibility, role, execution mode, enabled state, readiness metadata, and approved supplier-cost authority. Ingestion cannot mutate these fields. Multiple suppliers may map to one canonical package without blended costs, cheapest routing, or automatic failover.

## Cost boundary

`SupplierCatalogOffer.supplierCost` and append-only observations are informational. Comparison requires finite non-negative values and identical currencies; there is no implicit FX. Promotion requires `SUPPLIER_COST_MANAGE`, `SUPPLIER_COST_AUTHORITY_MUTATIONS_ENABLED=true`, explicit confirmation/reason, exact source and mapping locks, idempotency, and a transaction. Promotion changes one mapping authority and appends history; it cannot write retail prices or publication.

## Pricing and publication boundaries

Observed or approved supplier cost does not directly determine customer payable price. Pricing flows through the Pricing Engine, explicit publication, `PricingQuote`, and the `CommerceOrder` snapshot. Supplier ingestion never writes `CatalogPackage` retail pricing.

`PackageMarketPublication` is independent market merchandising intent. A published package can still be suppressed by product, price, readiness, eligibility, or fulfillment gates. Readiness cannot publish, and publication cannot make an unsafe package purchasable.

## Readiness, routing, and fulfillment

Readiness is derived fail-closed from mapping enabled state, API supplier, `PRIMARY` role, exact identities, customer-market eligibility, approved cost/readiness metadata, provider configuration, and availability evidence. It is not persisted by ingestion.

Routing selects an explicitly eligible `PRIMARY`. `BACKUP` is informational/manual contingency and is never automatically selected. There is no cheapest-cost, availability-driven, or ingestion-driven switch. Ambiguous post-submit failures cannot retry or switch suppliers automatically because duplicate fulfillment is possible.

## Automation and distributed locking

Execution requires exact lowercase `true` for `SUPPLIER_CATALOG_INGESTION_EXECUTION_ENABLED`. Scheduling additionally requires exact lowercase `true` for `SUPPLIER_CATALOG_AUTOMATED_INGESTION_ENABLED` and the supplier-specific automation gate. All default false.

The scheduler starts only after Mongo readiness, registers once, contains no provider business logic, and clears timers during disconnect/shutdown. Manual and scheduled runs use the same per-supplier Mongo lease. The unique `lockKey` index prevents duplicate durable scopes; atomic expiry comparison authorizes takeover. Heartbeats and every persistence mutation revalidate ownership. TTL cleanup is not used.

## RBAC and Admin controls

| Permission | OWNER | OPERATIONS | FINANCE | SUPPORT | CATALOG |
|---|---:|---:|---:|---:|---:|
| `SUPPLIERS_READ` | Yes | Yes | Yes | No | Yes |
| `SUPPLIER_CATALOG_INGEST` | Yes | No | No | No | No |
| `SUPPLIER_CATALOG_RECONCILE` | Yes | No | No | No | No |
| `SUPPLIER_COST_MANAGE` | Yes | No | No | No | No |
| `OWNER_ROUTING_MANAGE` | Yes | No | No | No | No |

Admin catalog/health reads do not call suppliers or mutate state. Mutation routes require Admin authentication, their dedicated permission, bounded targets, audit actor data, and their subsystem gate where applicable.

## Production indexes

Products and offers have unique provider-identity indexes. Availability has one-current-per-offer uniqueness. Runs have unique supplier/namespace/run keys. Observations have unique observation hashes. Cost changes have unique server and client idempotency keys. Reconciliation has unique offer/version and idempotency keys plus one partial unique current decision. Locks have unique `lockKey`, expiry lookup, and supplier/expiry lookup indexes. Production index verifiers require exact definitions and never synchronize or drop indexes.

## Failure behavior

DB, supplier, validation, stale-lock, permission, gate, and transaction failures stop the requested authority transition. Failed or partial ingestion preserves the durable catalog. UNKNOWN remains fail-closed. Audit/history writes participate in reconciliation and cost transactions. Reads never refresh providers.

## Operational activation

Architecture completeness is independent from activation. Controlled production ingestion requires a separate approved window with automation disabled. Automated scheduling requires separately reviewed supplier-by-supplier activation after successful manual runs. Cost promotions, reconciliation, pricing, publication, and routing remain independent human decisions.

## Intentional limitations

- No controlled production ingestion has run through the new orchestrator.
- Automated scheduling remains disabled.
- WonDD coverage remains partial/unproven.
- Twenty current comparable cost differences remain unapproved.
- Reconciliation decision history is currently empty.
- Automatic backup failover is intentionally absent.
- One SEAGM weekly-pass mapping remains catalog-unlinked for legacy compatibility and cannot acquire Phase 2 catalog evidence by inference.
