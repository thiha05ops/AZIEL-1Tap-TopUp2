# Supplier Catalog Reconciliation Architecture — Phase 2G-A

Status: design only. Phase 2G-A authorizes no database mutation, supplier request, mapping creation, canonical creation, publication, pricing, routing, eligibility, or readiness change.

## Authority boundaries

Supplier catalog discovery records provider-owned identity and observations. A reconciliation decision records a human conclusion about canonical semantics. `SupplierProductMapping` records an approved provider-to-canonical relationship. Production readiness, customer-market eligibility, supplier role, availability, pricing, and `PackageMarketPublication` remain independent authorities.

`DISCOVERED != RECONCILED != MAPPED != PRODUCTION_READY != AVAILABLE != PUBLISHED`.

Provider identity is immutable and exact:

- FazerCards: supplier ID/code + namespace + `category_id`/supplierProductCode + `offer_id`/supplierOfferCode.
- WonDD: supplier ID/code + namespace + `serviceid`/supplierProductCode + `packcode`/supplierOfferCode.
- Canonical target: immutable `CatalogProduct._id`/productCode and `CatalogPackage._id`/packageCode.

Mutable names, numeric denomination, prices, market labels, and string similarity are never identity authority.

## Actions and prerequisites

### LINK_TO_EXISTING_CANONICAL_PACKAGE

Requires explicit Admin selection of a non-deleted canonical package; exact source identity and reviewed hash; offer not already mapped; compatible canonical product family; review of semantics, restrictions, input contract, cost observation, availability evidence, existing mappings/roles, publication, and readiness; and a confirmation preview. It creates only a fail-closed mapping after an approved decision. Suggested candidates never auto-select.

### CREATE_CANONICAL_PACKAGE_AND_LINK

Must be two explicit transactions:

1. Use the existing canonical Catalog authority to create an internal draft package.
2. Separately approve reconciliation and create the mapping.

Existing package creation requires `productCode`, unique immutable `packageCode`, and `name`; it also supports family, aliases, notes, order, source, metadata, and regional prices. The safe draft must use `enabled=false`, no enabled regional price, no publication record, and no supplier cost authority. Creation of a new canonical product is outside the package-link action and requires separate catalog governance.

### MARK_INTENTIONALLY_UNSUPPORTED

Records an approved negative decision with a reason and reviewed source hash. It creates no mapping and changes no publication/readiness state. Suitable for products AZIEL deliberately will not sell, not for merely missing evidence.

### MARK_SPECIAL_VARIANT_REVIEWED

Records that special semantics were reviewed without collapsing the offer into a normal denomination. The decision must specify one of: existing special canonical candidate, new canonical design required, intentionally unsupported, or deferred. It creates no mapping unless followed by an independently confirmed mapping-producing action.

### DEFER_REVIEW

Records missing evidence and next-review criteria. It creates no mapping. Appropriate when semantic equivalence, provider authority, canonical ownership, market restrictions, or input compatibility is unresolved.

### REOPEN_REVIEW

Supersedes the current terminal/deferred decision and creates a new pending version. It never deletes history or silently unlinks a mapping.

## Durable decision model

Recommend a new `SupplierCatalogReconciliationDecision` in Phase 2G-B:

- `_id`
- `supplierCatalogOfferId` (required immutable reference)
- exact source identity snapshot: supplierId, supplierCode, catalogNamespace, supplierProductCode, supplierOfferCode
- `decisionType`: the six actions above
- `decisionStatus`: `PENDING_REVIEW`, `APPROVED`, `REJECTED`, `DEFERRED`, `SUPERSEDED`, `REOPENED`
- optional canonicalProductId/canonicalPackageId and immutable code snapshots
- optional mappingId
- `reasonCode`, `reviewNotes`, structured `evidence`
- `reviewedBy`, `reviewedAt`, `approvedBy`, `approvedAt`
- optional `supersedesDecisionId`
- `decisionVersion` (positive monotonic integer per offer)
- required `sourceOfferHash`; `sourceOfferRevision`; `sourceLastChangedAt`
- `idempotencyKey`
- immutable `beforeState`, `afterState`
- timestamps

Indexes: unique `(supplierCatalogOfferId, decisionVersion)`; unique sparse `idempotencyKey`; at most one current non-superseded decision per offer using an explicit `isCurrent` partial unique index. Do not embed decisions in mutable offer metadata.

## Decision state machine

- New review: none → `PENDING_REVIEW`.
- `PENDING_REVIEW` → `APPROVED`, `REJECTED`, or `DEFERRED`.
- `DEFERRED`/`REJECTED`/`APPROVED` → `SUPERSEDED` only when a replacement decision is atomically created.
- Reopen creates a new `REOPENED` decision version referencing the superseded decision; `REOPENED` then follows pending-review validation and may become approved/rejected/deferred.
- `SUPERSEDED` is terminal and immutable.
- Source drift prevents approval and returns `STALE_SOURCE_REVISION`; the existing decision remains unchanged and a fresh review is required.

## Source revision policy

Approval must compare the reviewed `sourceOfferHash`, exact provider identity, `sourceOfferRevision`, normalized semantics, restrictions/input-contract source product revision, and source `lastChangedAt` against fresh reads inside the transaction. `rawSnapshotHash` is the current persisted normalized/sanitized content fingerprint. A materially changed hash, semantics, identity, restriction, product market, or input contract causes `STALE_SOURCE_REVISION` and aborts. Cost-only drift also aborts the current confirmation so the Admin sees the new cost, but does not by itself invalidate an already-approved canonical identity; it creates a new observation/review warning.

Retired offers and `UNKNOWN` availability may be reconciled as identity, but cannot be approved for executable production readiness. Absence under incomplete coverage never implies unavailable.

## Mapping creation contract and safe defaults

The mapping-producing command must receive the approvedDecisionId, supplierCatalogOfferId, supplierId/code, canonical product/package IDs and codes, exact provider product/offer identities, customer-market mapping region, and explicit execution configuration. Server-side fresh reads reconstruct authoritative values; the client cannot supply trusted names, cost, or readiness.

Schema-compatible fail-closed defaults:

- `supplierCatalogOfferId` = reviewed offer
- `enabled = false`
- `productionRole = DISABLED`
- `executionMode = MANUAL` unless separately and explicitly approved with adapter/input evidence
- `fulfillmentEligibility.mode = UNKNOWN`, `allowedCustomerMarkets = []`, empty evidence
- readiness flags `supplierMapped=true` only for identity linkage; `pricingReady=false`, `inputReady=false`, `fulfillmentReady=false`, `storefrontReady=false`
- `supplierCostAuthority.rawSupplierCost = null`, currency/capturedAt/source unset; observed cost is not copied
- `archivedAt = null` for the new disabled mapping
- publication unchanged

The current schema has no `NONE`/`UNASSIGNED` role; `DISABLED` is the safe value. Reconciliation never displaces a `PRIMARY`, assigns `BACKUP`, or changes another mapping. Role assignment is a separate owner-authorized command.

## Eligibility, input, availability, cost, pricing, and publication

Supplier market and publication market do not prove customer eligibility. Eligibility remains `UNKNOWN` until provider-confirmed or controlled-test evidence identifies allowed customer markets through the existing supplier-neutral contract.

Canonical identity may be reconciled while input compatibility is unresolved. Executable readiness requires canonical customer fields to transform losslessly into the supplier contract—for example Fazer MLBB playerId/zoneId → player_id/server_id, WonDD `MLBB_USER_ZONE`, or WonDD `FREEFIRE_PLAYER_ID`. Incompatibility blocks `inputReady`; it does not rewrite canonical identity.

Availability is evidence only. The confirmation must show state, evidence code, observation time, and coverage completeness. `AVAILABLE` never approves a mapping; WonDD `coverageComplete=false` must be labeled partial/completeness unproven.

Observed supplier cost remains informational and is never copied into mapping cost authority or Pricing Engine. Cost promotion requires a separate pricing-authority workflow.

Reconciliation and mapping creation never create or update `PackageMarketPublication`. A new package is private by absence of a publication record. Published=true remains subject to all operational/product/price/fulfillment gates.

## Admin UX for Phase 2G-B

Offer detail → review exact source identity, semantics, restrictions, input contract, observed cost, availability/coverage → choose Link Existing, Create Canonical, Special Variant, Unsupported, or Defer → inspect suggested candidates as non-authoritative → explicitly choose target → view exact before/after → confirm → server validates source revision and target/mapping/decision preconditions → write decision → optionally create a fail-closed mapping only for an approved mapping-producing action.

No list-row one-click mapping. “Create Canonical” launches the separate canonical draft flow and returns for a second reconciliation approval.

Confirmation must show supplier/product/offer/market, exact provider identity, canonical target, proposed mapping, `enabled=false`, role `DISABLED`, eligibility `UNKNOWN`, readiness blockers, execution mode, publication impact `NONE`, pricing impact `NONE`, existing supplier alternatives, and no automatic failover.

## Concurrency and Idempotency

Use one MongoDB transaction for decision approval plus optional mapping creation. Re-read offer/product/target/current decisions/current mappings; compare sourceOfferHash/revision/lastChangedAt; require offer unmapped; require target non-deleted; detect archived/conflicting identities; then insert the decision and mapping with unique constraints. Any mismatch aborts with review-required semantics and no partial write.

The idempotency key is deterministic: `SHA256("supplier-catalog-reconcile:v1|" + approvedDecisionId + "|" + supplierCatalogOfferId + "|" + canonicalPackageId + "|" + decisionVersion)`. Replaying the same request returns the existing result without incrementing decision history. A different target with the same offer/version is a conflict, not an update.

## Duplicate and conflict policy

- Already mapped to the same target: return idempotent existing result only if decision/key match; otherwise `OFFER_ALREADY_MAPPED`.
- Mapped to another target: `OFFER_MAPPING_CONFLICT`; never overwrite.
- Same supplier/provider identity already maps to the canonical package: `DUPLICATE_PROVIDER_MAPPING`.
- Archived candidate mapping: require separate restore/review; do not create around it.
- Retired offer: identity decision may be deferred/unsupported; mapping production approval blocked.
- `UNKNOWN` availability: reconciliation allowed only with warning; readiness remains blocked.
- Cost changed: invalidate confirmation and re-review displayed cost; never promote it.
- Supplier market/input semantics changed: `STALE_SOURCE_REVISION`.
- Double click: same idempotency key returns the original result.
- Two Admins: unique indexes plus transaction permit one winner; loser receives conflict and fresh state.

Current indexes enforce unique `(supplierId, productCode, packageCode, region)` and one `PRIMARY` per canonical package/region. The `supplierCatalogOfferId` index is sparse but not unique, so Phase 2G-B must add an appropriate decision/current-offer constraint and explicitly decide whether one offer may ever back multiple customer-market mappings.

## Rollback and reopen

Never hard-delete decisions or mappings. Reopen by superseding the decision and creating a new version. A wrong unused mapping is disabled and archived with reason, actor, and decision reference; catalog linkage is disconnected only through a reviewed corrective command. A mapping referenced by historical orders/attempts is retained permanently and only disabled/archived. Publication, prices, eligibility, role, and historical route snapshots are not rolled back implicitly.

## Audit trail

Every future command writes both the durable decision and existing Admin audit log using the Admin identity snapshot. Record actor, timestamp, action, request/idempotency key, source identity, sourceOfferHash/revision, canonical target, mapping created/affected, `beforeState`, `afterState`, reason/evidence, route, and request ID. No anonymous mutation and no secret/customer data.

## RBAC

Introduce `SUPPLIER_CATALOG_RECONCILE`; do not reuse `SUPPLIERS_READ`. Initially grant only `OWNER`; optionally grant `CATALOG` after operational review. Package creation continues to require `CATALOG_MANAGE`. Role changes continue to require `OWNER_ROUTING_MANAGE`; eligibility/readiness/pricing/publication retain their existing independent authorities. Operations, Finance, and Support remain read-only unless explicitly granted the new permission.

## Phase 2G-B boundary

Phase 2G-B may implement the decision model, GET candidate/preview endpoints, explicit confirm endpoints, transactions, concurrency/idempotency, audit events, and reviewed fail-closed mapping creation. It must not implement automatic reconciliation, automatic canonical creation, publication, pricing promotion, eligibility approval, readiness activation, role assignment, supplier ingestion, supplier calls, fulfillment, or automatic failover.
