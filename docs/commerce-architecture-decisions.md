# AZIEL Commerce Architecture Decisions

## ADR-001 Package Identity

Status: Accepted

AZIEL keeps the existing string/code-based catalog identity for now. Commerce foundation models use `packageId` as the operational stable identifier, `packageCode` as optional display/integration metadata, and nullable `packageRef` for future `CatalogPackage` ObjectId support.

This avoids a forced catalog migration while allowing future relational lookups. Historical commerce records must remain readable even if future catalog package documents are renamed, merged, or replaced.

## ADR-002 Typed Domain Rules vs Generic BusinessRule

Status: Accepted

AZIEL should prefer typed domain configuration over a generic key-value `BusinessRule` collection. Pricing rules, promotion eligibility, inventory availability, and campaign policy need explicit schema validation, indexes, ownership, and migration paths.

A generic `BusinessRule` model is not introduced because it would hide business behavior behind arbitrary keys, reduce discoverability, weaken validation, and make future migrations harder to audit.

If cross-domain commerce settings become necessary, introduce a typed `CommercePolicy` model in a later sprint.

## ADR-003 Price Version Lineage

Status: Accepted

`PriceVersion` represents configuration lineage, not live calculated customer prices. Each version has an immutable `versionId`, positive `versionNumber`, `branchKey`, and optional parent/source/rollback references.

Version publishing, rollback execution, branch merge, live activation, calculated package price storage, and storefront switching are explicitly deferred.

## ADR-004 PricingQuote Deferred

Status: Accepted

`PricingQuote` is required for a secure future checkout flow, but it is not implemented in Sprint 2.1.1. Quote creation belongs to a later runtime sprint after pricing calculation, promotion resolution, inventory readiness, and checkout ownership are designed together.

Future quotes must be server-generated, short-lived, immutable for monetary results, bound to user ownership, and verified at checkout. Frontend-submitted amounts must never be trusted.

Sprint 2.4.0 defines the detailed quote architecture in `docs/commerce-pricing-quote-specification.md`. It keeps the same decision: no quote model, API, persistence, checkout integration, or UI is implemented yet.

## ADR-005 Calculation Order

Status: Accepted

Future pricing calculation should resolve in this order:

Supplier Cost → Business Cost → Profit → Exchange → Fees → Tax → Rounding → Original Price → Promotion → Final Price

This order keeps the economic base clear, applies business margin before customer-facing discounts, preserves a clean original price for storefront display, and makes promotion impact auditable. Promotions happen after original price calculation so discounts do not hide supplier cost, fee, tax, rounding, or margin policy.

No calculation engine is implemented in Sprint 2.1.2.

## ADR-006 Promotion Resolver Position

Status: Accepted

The future Promotion Resolver sits above the base Pricing Engine. It consumes the calculated `originalPrice`, server-owned customer/package/campaign context, and candidate `PromotionRule` records, then returns eligible promotions, rejected promotions, deterministic winner details, reasons, warnings, and applied strategy.

The resolver must use explicit sorting and tie-break rules. It must not depend on database natural order, JavaScript object insertion order, client-supplied eligibility facts, or metadata-hidden business rules.

Initial runtime direction should prefer one best price-affecting promotion per order. Stackability, mutually-exclusive groups, wallet-credit rewards, bundle rules, redemption ledgers, and quote/order promotion snapshots are deferred to future sprints.

No promotion resolver runtime is implemented in Sprint 2.3.0.

## ADR-007 Quote Is Checkout Commercial Authority

Status: Accepted

Future checkout must consume a persisted `PricingQuote` as the commercial source of truth. Checkout must not rerun base pricing, exchange, fee, tax, rounding, or promotion resolution, and it must not trust browser-submitted totals.

Operational facts such as package availability, fulfillment input validity, payment method availability, and promotion redemption-critical constraints may be revalidated, but they must never mutate the locked quote amount.

Sprint 2.5.0 defines this contract in `docs/commerce-checkout-from-quote-specification.md`.

## ADR-008 Atomic Quote Consumption And Order Creation

Status: Accepted

The production target for quote checkout is one atomic business operation: create the order snapshot and consume the quote in the same transaction.

Forbidden outcomes are:

- a `USED` quote without an order
- an active order with an unconsumed quote
- two orders created from one quote

Mongo transaction support, or an equivalent explicitly documented atomic strategy, is a readiness requirement before quote-backed checkout becomes production traffic.

## ADR-009 Checkout Payment Orchestration Boundary

Status: Accepted

Payment provider calls must occur after durable order creation and quote consumption commit. The database transaction creates the commercial/order truth; provider calls then create the next payment step.

If a provider call fails after commit, checkout should return or expose a recoverable unpaid/payment-pending state instead of attempting to roll back quote consumption or order creation.

Manual PromptPay and manual bank flows remain manual verification flows. Quote checkout must not auto-mark those orders as paid.

## ADR-010 Checkout Idempotency Is Separate From Quote Creation

Status: Accepted

Checkout idempotency must be separate from quote creation idempotency.

Quote creation idempotency protects repeated quote requests. Checkout idempotency protects order creation and quote consumption. The checkout fingerprint should include quote id, owner, payment selection, and fulfillment input, while excluding trace metadata, locale, IP, and user-agent data.

Replaying the same checkout key and fingerprint may return the existing order. Reusing the same key with a different fingerprint must reject.

## ADR-011 Quote Ownership Is Mandatory At Checkout

Status: Accepted

Quote id-only checkout is forbidden.

Authenticated quotes require the same canonical user owner. Session-bound quotes require the same server-owned session. A user-bound quote cannot be consumed with only session ownership, and anonymous/session-to-user quote claim is deferred until an explicit handoff policy is designed.

## ADR-012 Payment-Method-Dependent Pricing Requires Bound Method

Status: Accepted

If a pricing rule, fee rule, promotion, or tax rule depends on payment method, the quote must bind the payment method used during calculation. Checkout must require the selected payment method to match the quote-bound method.

Changing to another payment method requires a new quote. This prevents customers from accepting a quote calculated for one payment rail while checking out with another rail that has different costs or eligibility.

## ADR-013 Legacy Orders Remain Quote-Less

Status: Accepted

Existing orders without quote ids remain valid historical records. AZIEL must not backfill fake quote ids or infer quote snapshots from historical order data.

New quote-backed orders should store a non-empty quote association and quote commercial snapshot. Any uniqueness rule for order quote ids must be partial/non-null to avoid breaking legacy records.

## ADR-014 Dedicated CommerceOrder Persistence

Status: Accepted

Sprint 2.5.3 introduces a dedicated `CommerceOrder` model and repository for quote-backed commerce orders instead of extending the existing legacy `Order` model.

The legacy `Order` model is already the source of truth for current production checkout, manual payment, wallet, refund, fulfillment, admin, and email flows. It has required legacy fields and route-specific semantics that do not map cleanly to immutable quote snapshots.

`CommerceOrder` stores quote-commerce records in a separate `commerceorders` collection with immutable product, commercial, pricing, promotion, payment-selection, checkout, and quote snapshot fields. Mutable fields are limited to operational status, payment status, fulfillment status, references, and status history.

This preserves every existing order flow while giving future quote checkout a clean persistence boundary. Any future migration or unified order view must use explicit adapters and must not rewrite historical legacy orders into inferred quote records.

## ADR-015 Checkout Service Owns Persistence Transaction

Status: Accepted

Sprint 2.5.4 wires the checkout application service to `PricingQuote` persistence and `CommerceOrder` persistence.

The checkout service owns the Mongo transaction boundary. Repositories remain transaction participants only: they receive a caller-owned session and do not start, commit, or abort transactions.

The durable transaction contains exactly:

1. create `CommerceOrder`
2. mark `PricingQuote` as `USED`

Preflight quote loading, existing-order lookup, quote validation, operational validation, fulfillment validation, payment validation, promotion-redemption validation, and immutable snapshot construction happen before the transaction. Database constraints and quote-consumption filters remain the authority for concurrent races.

Payment provider calls, manual payment attempts, wallet debit, supplier fulfillment, inventory reservation, and promotion redemption ledger writes remain outside this sprint.
