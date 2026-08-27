# Market-Decoupled Fulfillment Phase 5A Audit

Phase 5A is read-only. Production remains `LEGACY_REGION`; existing product gates and the disabled Phase 4 pilot remain unchanged.

## `mapping.region` dependency inventory

| File / authority | Function or use | Current behavior | Classification | Phase 5C/5D action | Removal risk |
|---|---|---|---|---|---|
| `models/SupplierProductMapping.js` | schema and indexes | Requires `MM/TH`; uniqueness and one-PRIMARY constraints include region | LEGACY_COMPATIBILITY | 5C stops using it for selection; retain for v1/history in 5D | Removing early breaks indexes, old mappings and v1 snapshots |
| `services/supplierProductionSelectionService.js` | `assessProductionMapping` | Checks supplier `supportedRegions`, price and readiness using `mapping.region` | CUSTOMER_MARKET_ROUTING_COUPLING | Replace with entitlement eligibility plus separately supplied customer-market price | Could approve an unpriced market or reject cross-market entitlement |
| same | `setProductionRole` | PRIMARY/backup uniqueness and manual fallback are region-keyed | CUSTOMER_MARKET_ROUTING_COUPLING | Move uniqueness to canonical product/package authority after ambiguity migration | Duplicate primary routes or removal of sole safe route |
| same | `resolvePrimaryRouteSnapshot` | Selects PRIMARY by product/package/region and emits v1 `region` | CUSTOMER_MARKET_ROUTING_COUPLING | 5C uses eligibility resolver and v2; preserve this function for v1 compatibility | Changes current checkout routing |
| same | `resolveLegacyCheckoutRouteSnapshot` | Region-bound automated route and region-based manual fallback | LEGACY_COMPATIBILITY | Keep during compatibility; deprecate only after v2 cutover | Breaks existing storefront fallback |
| `services/supplierEligibilityRouteResolver.js` | eligibility resolver | Intentionally does not query `mapping.region`; v1-shaped shadow route carries customer market in `region` until snapshot promotion | LEGACY_COMPATIBILITY | Emit only v2 when primary; remove intermediate v1-shaped field | Snapshot-shape regression |
| `services/fulfillmentCapabilityService.js` | mapping candidate/load functions | Queries and filters mappings by customer region; WonDD readiness hardcodes TH | CUSTOMER_MARKET_ROUTING_COUPLING | Replace automated candidate path; retain manual-market policy separately | Incorrect checkout availability/manual fallback |
| `services/fulfillmentService.js` | supplier/mapping CRUD | Validates supplier supported region, writes mapping region, projects it | SAFE_NON_ROUTING_USE | Keep as legacy metadata until admin contract migration | Admin/API incompatibility |
| same | `startFulfillmentForOrder` | v1 requires mapping region equal order market; exact Phase 4 v2 exception is snapshot/eligibility based | LEGACY_COMPATIBILITY | Generalize v2 validation in 5C; keep v1 branch indefinitely | Historical orders could dispatch against wrong mapping |
| same | WonDD readiness/pricing | Legacy uses `prices[mapping.region]`; pilot uses customer market separately | PRICING_ONLY | Generalize customer-market price boundary without comparing unlike currencies | Cross-currency profitability error |
| same | FulfillmentAttempt creation | Stores mapping region; v2 also stores customerMarket | LEGACY_COMPATIBILITY | Keep region for historical/provider metadata; use customerMarket commercially | Reporting/history loss |
| `services/paidFulfillmentRoutingService.js` | paid orchestration | v1 reads snapshot region; v2 reads customerMarket; never resolves mapping by current region | LEGACY_COMPATIBILITY | Must remain dual-version | Duplicate or redirected fulfillment |
| `services/commerce/orderSnapshotRuntime.js` | route normalization | v1 validates `region`; v2 validates `customerMarket` and eligibility | LEGACY_COMPATIBILITY | Must keep v1 reader; v2 becomes canonical | Existing orders become unreadable |
| `services/suppliers/fazercardsFulfillmentProcessor.js` | mapping validation | Requires `mapping.region === TH`; provider category mapping separately represents TH entitlement | PROVIDER_ENTITLEMENT_METADATA | Replace region guard only after canonical TH entitlement coverage is verified | Could send a regional entitlement to an incompatible provider category |
| `services/catalogService.js` | availability and fulfillment projections | Uses mapping region to report regional fulfillment availability/readiness | STOREFRONT_AVAILABILITY | Consume eligibility/capability result instead in 5C | Incorrect public availability |
| `services/commerce/adminPricingControlCenterService.js` | supplier pricing rows | Associates supplier mapping and regional price through mapping region | PRICING_ONLY | Separate supplier cost authority from customer price region | Cost/price currency leakage |
| `frontend/js/admin-fulfillment.js` | mapping editor/display | Sends/displays legacy region field | SAFE_NON_ROUTING_USE | Relabel as legacy/provider metadata before making optional | Admin may unknowingly alter routing today |
| Onboarding/rollout scripts: `onboard-fazercards-hok.js`, `stabilize-fazercards-hok.js`, `archive-orphan-supplier-mapping.js` | exact mapping creation/lookup | Creates or locates legacy TH/MM mappings by region | LEGACY_COMPATIBILITY | Freeze old scripts; replacements should use canonical entitlement identity | Duplicate or wrong migration target |
| Audit/migration scripts: `audit-fazercards-aziel-reconciliation.js`, `backfill-supplier-fulfillment-eligibility.js` | historical evidence | Uses region as legacy scope, not provider eligibility | TEST_OR_VERIFIER | Keep evidence semantics | Misclassification as provider confirmation |
| Verifiers: Phase 1–5, production activation, WonDD rollout, catalog/admin fulfillment verifiers | compatibility assertions | Assert legacy region behavior or controlled exceptions | TEST_OR_VERIFIER | Update only alongside the owning phase | Loss of regression coverage |

No relevant frontend customer routing code reads `SupplierProductMapping.region`; frontend occurrences are admin presentation only. Product `supportedRegions` occurrences in catalog/storefront code are customer storefront availability and are not supplier mapping-region authority.

## Supplier product-gate inventory

| Supplier | Product | Current gate | Selection | Startup | Adapter/processor | Missing/false behavior |
|---|---|---|---|---|---|---|
| WONDD | mlbb | `WONDD_MLBB_AUTO_FULFILLMENT_ENABLED` | `assessProductionMapping` and eligibility shadow call adapter gate | `startFulfillmentForOrder` checks gate | `submitTopup` checks again; recovery startup/recovery checks gates | Missing/false is disabled; missing credentials makes adapter unconfigured |
| WONDD | freefire and canonical splits resolving to family | `WONDD_FREEFIRE_AUTO_FULFILLMENT_ENABLED` | same | same | same | Missing/false is disabled |
| WONDD | other configured products | membership in `WONDD_AUTO_FULFILLMENT_ENABLED_PRODUCTS` | same | same | submit and recovery use list | Missing/list omission is disabled; MLBB cannot bypass its dedicated gate and Free Fire uses its dedicated gate |
| FAZERCARDS | pubg | `FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED` | both production assessors | startup check | adapter submit checks; server/processor recovery checks any supported product | Missing/false disabled; missing API key unconfigured |
| FAZERCARDS | mlbb | `FAZERCARDS_MLBB_AUTO_FULFILLMENT_ENABLED` | same | same | same | Missing/false disabled |
| FAZERCARDS | freefire | `FAZERCARDS_FREEFIRE_AUTO_FULFILLMENT_ENABLED` | same | same | same | Missing/false disabled |
| FAZERCARDS | hok | `FAZERCARDS_HOK_AUTO_FULFILLMENT_ENABLED` | same | same | same | Missing/false disabled |
| FAZERCARDS | valorant | `FAZERCARDS_VALORANT_AUTO_FULFILLMENT_ENABLED` | same | same | adapter submit checks; server recovery list currently omits Valorant | Missing/false disabled; unknown product has no key and is disabled |

Gate reads live in `wonddAdapter.js` and `fazercardsAdapter.js`. Independent enforcement exists in route assessment, fulfillment startup, adapter submission, processor recovery, and server recovery scheduling. Onboarding, rollout, reconciliation, cost refresh, and supplier verifiers also inspect gates to ensure live submission is off or explicitly controlled.

## Supplier readiness authority

- `supplier.enabled`: active runtime blocker.
- `supplier.mode`: distinguishes API from manual and is enforced by candidate/startup logic.
- `capabilities`: projected and stored, but not a complete route authorization mechanism.
- `configurationStatus`: administrative state; not consistently enforced in routing.
- Adapter credential readiness: `adapter.isConfigured()` is active authority and fails closed.
- Processor availability: supplier-specific mapping validators are active authority.
- `supportedRegions`: code uses it both to validate mapping CRUD and to compare customer/mapping regions. Therefore it is **ambiguous legacy metadata (D)**, mixing operational coverage and AZIEL routing scope; it cannot safely become eligibility evidence without migration.
- Balance metadata: operational/observability information, not route authorization.

## SupplierProductMapping authority

`enabled`, `executionMode`, `productionRole`, canonical product/package identity, exact provider identity, `archivedAt`, readiness flags, eligibility, and fresh cost authority collectively cover most future DB authority. `archivedReason` is audit metadata. `region` remains current legacy routing authority.

The smallest missing future authority is a supplier-level emergency kill switch. It should be environment/operations owned and independent of routing. No new DB field is needed for product authorization if readiness semantics and processor availability are made explicit and consistently enforced.

## Phase 5B compatibility contract (design only)

Recommended variables:

- `WONDD_AUTO_FULFILLMENT_ENABLED`
- `FAZERCARDS_AUTO_FULFILLMENT_ENABLED`

Both default to false. During compatibility, dispatch requires:

`supplier-level kill switch AND existing product gate AND existing DB/readiness checks`.

The supplier-level switch is an emergency permission ceiling, never a selector. False immediately blocks new selection, startup, adapter submission, and automatic recovery. Existing accepted/uncertain submissions retain current safe recovery semantics. Rollback removes use of the new switch while preserving old gates; no mapping changes are required.

## Phase 5C routing contract (design only)

Checkout first validates storefront market, price, currency and payment availability for the selected canonical product/package. Automated routing then queries PRIMARY mappings by canonical product/package without region, applies fulfillment eligibility and readiness, fails on ambiguity, and emits an immutable v2 snapshot. Manual fallback remains a separate customer-market policy.

Production locations requiring change: `supplierProductionSelectionService`, `fulfillmentCapabilityService`, `catalogService` fulfillment projections, `fulfillmentService` generalized v2 startup validation, admin PRIMARY uniqueness/index migration, pricing-control mapping joins, and supplier processor region guards after canonical entitlement verification. `orderSnapshotRuntime` and `paidFulfillmentRoutingService` already provide the required versioned immutable boundary.

Canonical identity must never be rewritten from customer market. Valorant TH/MY/SG must remain distinct canonical entitlements and exact provider mappings.

## Phase 5D disposition (design only)

- **DEPRECATE_AS_AUTHORITY:** mapping region in new route selection; per-product gates after compatibility; `LEGACY_REGION`; Phase 4 package flag.
- **KEEP_AS_HISTORICAL_METADATA:** mapping region, archived reason, provider entitlement evidence.
- **MUST_KEEP_FOR_V1_COMPATIBILITY:** v1 snapshot region reader, legacy paid-order validation, immutable stored snapshots.
- **SAFE_TO_REMOVE_LATER:** legacy write/edit affordances and old rollout scripts only after all live mappings/orders are migrated and retention requirements are met.
