# Supplier cost and availability operations — Phase 2H-A

Status: read-only production audit and architecture decision, 2026-08-31. Phase 2H-B is not implemented.

## Authority boundaries

Supplier observation, mapping cost authority, Pricing Engine authority, availability evidence, operational readiness, customer eligibility, routing, and publication are independent authorities. `SupplierCatalogOffer.supplierCost` and `SupplierOfferAvailability` record provider evidence. `SupplierProductMapping.supplierCostAuthority` records an AZIEL-approved supplier-specific acquisition-cost input. `CatalogPackage.prices[market]`, the pricing policy/version pipeline, `PricingQuote`, `CommerceOrder`, production readiness, mapping role, and `PackageMarketPublication` remain separate.

Ingestion may replace current supplier observations. It must not promote cost authority, publish pricing, modify mappings or roles, reconcile offers, or alter orders. Availability evidence must never be fabricated to express an AZIEL operational decision.

## Current schemas

`SupplierCatalogOffer.supplierCost` is an optional strict subdocument: `amount` (Number, required, minimum 0), `currency` (uppercase String, required, maximum 12), and `observedAt` (Date, required). Zero is schema-valid. Currency is per offer. No gross/net, discount, tax, or funding-cost semantics are encoded; FazerCards captures authenticated `price_usd`, while WonDD captures `netpricedealer`. `rawSnapshotHash`, optional `sourceRevision`, `lastObservedAt`, and `lastChangedAt` carry source revision context. Provider raw snapshot changes, including provider cost changes, change `rawSnapshotHash`; normalized `observedAt` itself is not included in the provider snapshot hash. Only the latest cost is retained; no cost-observation history model exists.

`SupplierProductMapping.supplierCostAuthority` contains `rawSupplierCost` (Number, minimum 0, nullable), `supplierCurrency` (the commerce supplier-currency enum, nullable), `capturedAt`, `source`, `providerProductCode`, `providerOfferCode`, `fundingCost`, and `otherAcquisitionCost`. Mongoose mapping timestamps provide mapping-level `updatedAt`, but there is no cost-specific actor, confidence, approval status, version, or append-only history. A mapping can exist without cost authority; production readiness then blocks with `CURRENT_SUPPLIER_COST_MISSING`. The one legacy catalog-unlinked mapping is the production example without complete authority.

`SupplierOfferAvailability` has `state` in `AVAILABLE | UNAVAILABLE | UNKNOWN`, `evidenceCode`, `observedAt`, `staleAt`, `lastAvailableAt`, `lastUnavailableAt`, `consecutiveMissingCount`, `observationRunId`, `coverageComplete`, `metadata`, and timestamps. The offer relationship is unique through `supplierCatalogOfferId`; supplier/product identity is reached through the offer. There is no configured freshness TTL.

## Cost consumer graph

| From | To | Edge | Current behavior |
|---|---|---|---|
| `SupplierCatalogOffer.supplierCost` | `SupplierProductMapping.supplierCostAuthority` | NO CONNECTION | Ingestion never promotes it. |
| Mapping cost authority | Admin Pricing Workspace | READ + DERIVE | `adminPricingControlCenterService` prefers mapping authority and supplies cost, provenance, funding, and acquisition inputs. |
| Admin Pricing Workspace | `CatalogPackage.prices[market]` | EXPLICIT WRITE | Owner publishing is a separate mutation; preview is non-publishing. |
| `CatalogPackage.prices[market]` | Pricing context/engine | READ | Current canonical regional supplier/business inputs feed calculation. |
| Pricing Engine | `PricingQuote` | DERIVE + SNAPSHOT | Server calculation is frozen into immutable quote snapshots. |
| `PricingQuote` | `CommerceOrder` | COPY + SNAPSHOT | Quote-backed checkout copies immutable commercial/pricing truth. |
| Mapping cost authority | production readiness/routing eligibility | READ | Missing or older-than-configured authority blocks readiness. It does not choose a cheaper supplier. |
| Mapping cost authority | `FulfillmentAttempt` | SNAPSHOT | `fulfillmentService` copies supplier-cost evidence into attempt request context; fulfillment does not recalculate retail price. |
| Supplier availability | readiness, storefront, checkout, routing | NO CONNECTION | Current operational paths do not read this collection. |

## Retail pricing and history

Updating mapping cost authority alone does not write canonical regional price or publication. The Admin Pricing Workspace reads the mapping authority on its next load and can therefore produce a different preview, but public price changes only through the existing explicit Owner publish path. Customer quote creation reads the published canonical pricing context; it does not read `SupplierCatalogOffer` directly.

Phase 2H-B must preserve that separation. It must not call pricing publish or package update from cost promotion. The confirmation must state that the new authority may change future Admin previews and readiness, while published retail price, publication intent, existing quotes, and existing orders stay unchanged.

`PricingQuote.commercialSnapshot`, `pricingSnapshot`, and related package/integrity fields are immutable. `CommerceOrder` copies quote, pricing, package, and commercial snapshots into immutable fields. A future mapping update cannot rewrite them. Existing fulfillment attempts retain their captured request/result context. No migration of historical documents is permitted.

## Deterministic comparison states

Comparison order:

1. `NO_OBSERVED_COST`: supplier observation absent.
2. `NO_MAPPING_COST_AUTHORITY`: authoritative amount or currency absent.
3. `INVALID_OBSERVATION`: non-finite/negative amount, blank currency, or missing `observedAt` (the current schema normally prevents this).
4. `UNCOMPARABLE`: invalid authority or another comparison prerequisite is absent.
5. `CURRENCY_MISMATCH`: normalized uppercase currencies differ. No FX conversion is attempted.
6. `STALE_OBSERVATION`: reserved for a future approved freshness policy. It is not emitted today because no TTL is configured.
7. `MATCH`, `INCREASE`, or `DECREASE`: exact numeric comparison in the same currency.

For comparable pairs: `delta = observed - authority`; `percentage = delta / authority * 100`. When authority is zero, an exact zero match is 0%; a non-zero delta has no finite percentage and must be reviewed as an exceptional increase. Both increases and decreases require review. Floating display should use currency-appropriate formatting, but the source-locked values and comparison use the stored numbers.

No production price-spike thresholds exist for this workflow. Phase 2H-B should introduce configuration before assigning thresholds. Missing, negative, non-finite, zero-to-nonzero, currency-mismatch, or threshold-exceeding observations require explicit exceptional review; none auto-promote.

## Future cost promotion

The action is `PROMOTE_OBSERVED_COST_TO_MAPPING_AUTHORITY`. It means only that an authorized Admin approved one exact observed supplier cost for one exact mapping. Begin with single-mapping review; no row-level one-click or bulk promotion.

Preconditions:

- OWNER has a new, separate `SUPPLIER_COST_MANAGE` permission.
- Mapping is linked to the exact `supplierCatalogOfferId`; supplier, namespace, provider product, and offer identities all agree.
- Observation has a valid non-negative amount, supported currency, timestamp, source hash/revision, and satisfies an approved freshness policy.
- Review carries mapping ID and version/`updatedAt`, offer ID, `rawSnapshotHash`, effective `sourceRevision`, `observedAt`, amount, currency, and an `observedCostHash` over those values.
- Confirmation re-reads mapping and offer transactionally. Any identity, source revision/hash, observation, current authority, or mapping-version change aborts with `COST_RECONFIRMATION_REQUIRED`.
- Explicit confirmation, bounded reason, request ID, and unique idempotency key are required.

The narrow write boundary is `SupplierProductMapping.supplierCostAuthority` plus one append-only audit event. It writes the reviewed amount/currency/captured time/source/provider identity; funding and other acquisition costs must be preserved unless separately reviewed. It must not write canonical package price, pricing policy/version, publication, role, eligibility, readiness flags, routing, quote, order, fulfillment history, reconciliation, or availability.

An append-only `SupplierCostAuthorityChange` (or repository-wide Admin audit event with equivalent guarantees) should store mapping and offer IDs; supplier/provider identity; complete previous/new authority; reviewed observation and source lock; actor; timestamp; reason; request ID; idempotency key; and outcome. Mapping timestamps alone are insufficient.

Add an append-only, deduplicated `SupplierCatalogCostObservation` in Phase 2H-B. Dedupe on offer plus observed cost/source revision/hash (not polling time alone), retain amount/currency/observed time and ingestion run. This supports supplier debugging and change analysis. It does not replace immutable quote/order snapshots or become pricing authority. Storage growth is bounded by change-based insertion and retention policy.

For any future batch workflow, every row must carry an independent source lock and audit result. Prefer an all-or-nothing transaction when within MongoDB limits; otherwise explicitly report independently committed rows and never call a partial result “success.” Phase 2H-B should not include batch promotion.

## Multi-supplier behavior

Cost is always mapping- and supplier-specific. There is no canonical blended cost and no cheapest-supplier selection. Admin rows should show Supplier, Role, Observed Cost, Current Authority, Delta, Observation Freshness, Availability, Coverage, and Readiness independently. MLBB_570 remains WonDD PRIMARY and FazerCards BACKUP. Neither a lower FazerCards observation nor an availability event changes that assignment.

## Availability semantics

Positive listing can establish `AVAILABLE`. WonDD coverage is incomplete, so absence produces no missing transition. FazerCards coverage becomes complete only when every configured category completes; on complete coverage, a missing existing offer becomes `UNKNOWN`, gets `staleAt`, and increments `consecutiveMissingCount`. It does not become `UNAVAILABLE`. Partial FazerCards runs also suppress missing transitions. Explicit retirement is represented separately by offer lifecycle (`RETIRED`), not inferred by a single absence.

`SupplierOfferAvailability` should remain supplier-observation evidence only. Admin must not write `AVAILABLE` or `UNAVAILABLE`. Operational disablement belongs to existing mapping/readiness authorities (for example enabled/role changes under their own guarded workflows), not fake evidence. Suitable Admin actions are read-only acknowledgement/mark-for-review and a later ingestion recheck request; recheck scheduling belongs to Phase 2I. If a dedicated manual operational disable is needed, design it as mapping authority with separate permission and audit.

No arbitrary availability TTL is approved. Preserve stored evidence and add a derived freshness status (`FRESH | STALE | UNDETERMINED`) once per-supplier/configured policy exists. A scheduler in Phase 2I may surface stale signals, but should not rewrite historical evidence merely because time passed. Operational paths should fail closed on stale/UNKNOWN only after that policy is explicitly integrated and verified.

Today availability does not contribute to `assessProductionMappingFromContext`, publication, public catalog, checkout route resolution, or fulfillment preflight. Accordingly, all 167 mapped offers are AVAILABLE while all 167 are currently not production-ready for other blockers; this is expected authority separation, not evidence that availability should override readiness. Publication remains suppressible by all existing product/price/fulfillment gates.

Routing queries only explicit PRIMARY mappings. It does not query availability, BACKUP, or cost rank. An unavailable PRIMARY therefore does not auto-select BACKUP. Phase 2H-B should surface an Admin alert with the affected PRIMARY and configured BACKUP, but never switch roles automatically.

## RBAC and Admin UX

Keep `SUPPLIERS_READ`, `SUPPLIER_CATALOG_RECONCILE`, `SUPPLIER_MAPPINGS_MANAGE`, `CATALOG_MANAGE`, and `OWNER_ROUTING_MANAGE` separate. Add `SUPPLIER_COST_MANAGE`, granted to OWNER only initially.

The mapped-offer detail should show observed cost, authority, delta/percentage, observation age, currencies, comparison state, availability evidence/coverage/time, mapping role, and readiness blockers. “Review Cost Change” opens a confirmation view showing supplier/product/offer/provider identity, canonical product/package, mapping/role, before/after, source time and lock, downstream pricing-preview effect, and explicit statements that publication, existing quotes/orders, readiness flags, and routing are not changed. No one-click promotion.

## Ingestion and Phase 2I boundary

Current ingestion updates `SupplierCatalogOffer` and `SupplierOfferAvailability` through catalog-only repositories and never imports `SupplierProductMapping`. That boundary is correct. Phase 2I owns scheduling, retries, locks, and supplier refresh operations. It should emit/surface cost-changed, availability-changed, observation-stale, coverage-incomplete, and ingestion-failed signals without promoting authority or triggering failover.

## Production audit summary

The deterministic artifact reports 259 offers and availability records, 168 mappings (167 linked), and 167 comparable mapped cost pairs: 147 MATCH, 5 INCREASE, 15 DECREASE, zero currency mismatches, and zero invalid/uncomparable linked pairs. One legacy unlinked mapping lacks cost authority. All 259 offers are observed AVAILABLE: FazerCards 106 complete-coverage and WonDD 153 partial-coverage; 167 mapped and 92 unmapped. No evidence is marked stale, and no freshness TTL is configured.

Largest percentage increase: FazerCards `pubg/PUBG_8100_UC`, USD 88.4081 to 89.00 (+0.5919, +0.669509%). Largest percentage decrease: FazerCards `mlbb/MLBB_570`, USD 5.732 to 5.681 (-0.051, -0.889742%). Exact top-ten lists are in the artifact.

MLBB_570: FazerCards BACKUP is AVAILABLE with complete coverage, observed USD 5.681 versus authority USD 5.732 (DECREASE); WonDD PRIMARY is AVAILABLE with partial coverage, observed/authority THB 197 (MATCH). Both publication records resolve PUBLISHED. Current readiness is false because cost authority is older than the configured 86,400-second maximum; WonDD also has its provider feature gate off. No failover or cheapest routing exists.

## Phase 2H-B implementation plan and gate

1. Add observation and cost-authority audit history models/indexes with isolated tests.
2. Add OWNER-only `SUPPLIER_COST_MANAGE` and RBAC tests.
3. Add a pure comparison/source-lock service and single-mapping review endpoint.
4. Add a transactionally revalidated, idempotent promotion endpoint with the narrow write boundary.
5. Add Supplier Catalog review/confirmation UI and zero-side-effect/readiness/publication regressions.
6. Define configurable cost and freshness policies before enforcing alerts or stale blockers.

Phase 2H-B is a **conditional GO for implementation only** within the six-step scope above. Production activation remains **NO-GO until** the implementation supplies the missing history, dedicated RBAC, source-lock/idempotency transaction, and pricing-impact separation and passes isolated and read-only regressions. Bulk mutation is not authorized.
