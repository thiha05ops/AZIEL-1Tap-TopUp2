# AZIEL Commerce Pricing Quote Architecture

Sprint: 2.4.0

Status: Architecture specification only

This document defines the future Pricing Quote architecture that connects:

Base Pricing Engine

↓

Promotion Resolver

↓

Pricing Quote

↓

Future Checkout

This sprint does not implement runtime code, APIs, database writes, checkout changes, UI changes, or deployment changes.

## First-Audit Summary

Reviewed architecture foundations:

- `docs/commerce-calculation-specification.md`
- `docs/commerce-calculation-engine.md`
- `docs/commerce-promotion-resolver-specification.md`
- `docs/commerce-promotion-resolver.md`
- `docs/commerce-architecture-decisions.md`
- `backend/models/PricingPolicy.js`
- `backend/models/PricingRule.js`
- `backend/models/PromotionRule.js`
- `backend/models/CommerceCampaign.js`
- `backend/models/PriceVersion.js`
- `backend/models/Order.js`
- `backend/models/ManualPaymentAttempt.js`
- `backend/models/PromoRedemption.js`
- `backend/services/catalogService.js`
- `backend/models/commerceSchemas.js`

Findings:

- No `PricingQuote` model exists today, so there is no model-name collision.
- `Order` already snapshots customer, package, amount, currency, promotion, payment method, and manual QR fields, but it is an order lifecycle record, not a quote.
- `ManualPaymentAttempt` snapshots amount, currency, product/package, promotion fields, dynamic QR data, and payment instructions, but it is payment-attempt state, not a commercial quote.
- Current catalog validation accepts package identity and client-presented amount/currency only as compatibility checks. Future checkout must stop treating browser totals as authoritative.
- Commerce package identity is already standardized around `packageId`, `packageCode`, and nullable `packageRef`.
- Region/currency conventions are `MM`/`MMK` and `TH`/`THB`; quotes must freeze both and must never sum currencies.
- `PriceVersion` provides future lineage through `versionId`, `versionNumber`, `branchKey`, parent/source/rollback references, and lists of policy/rule/promotion/campaign ids.

## 1. Quote Purpose

A Pricing Quote is a temporary, server-generated commercial offer. It freezes the commercial truth presented to checkout for one package, region, currency, quantity, pricing calculation, and promotion resolution.

A quote is not:

- an order
- a payment record
- a wallet transaction
- a supplier reservation
- a promotion redemption consumption record
- a permanent price list

The quote must freeze:

- selected package identity
- region and currency
- supplier cost context
- pricing calculation input and result
- applied pricing rules
- selected promotion result
- original price
- discount amount
- quoted final price
- calculation engine version
- promotion resolver version
- pricing specification version
- promotion specification version
- price version and branch lineage
- issue time
- expiry time
- integrity metadata

Initial quote creation does not reserve stock unless a future inventory sprint explicitly adds reservation semantics.

## 2. Quote Lifecycle

Future quote states:

- `ISSUED`
- `USED`
- `EXPIRED`
- `INVALIDATED`
- `CANCELLED`

Permitted transitions:

| From | To | Meaning |
| --- | --- | --- |
| `ISSUED` | `USED` | Checkout consumed the quote and created or reused the intended order/payment flow. |
| `ISSUED` | `EXPIRED` | Server-owned expiry time has passed and the quote can no longer be accepted. |
| `ISSUED` | `INVALIDATED` | Admin/system policy invalidated the quote before expiry. |
| `ISSUED` | `CANCELLED` | Customer/session abandoned or explicitly cancelled before use. |

Terminal states:

- `USED`
- `EXPIRED`
- `INVALIDATED`
- `CANCELLED`

`USED` and `EXPIRED` must be terminal. A used quote must never return to issued. An expired quote may be refreshed only by issuing a new quote ID.

## 3. Quote Expiry Policy

Every quote must have a finite expiry.

Recommended default validity:

- 10 minutes for ordinary catalog/package quotes.
- 3 to 5 minutes for volatile exchange-rate or supplier-cost contexts.
- 15 minutes only when the price version, supplier cost, and promotion usage policy are stable enough for the longer window.

The server owns both:

- `issuedAt`
- `expiresAt`

Timezone policy:

- Store timestamps as UTC instants.
- Render local display according to user/admin locale only at presentation time.
- Never compare quote expiry using browser time.

Expiry comparison:

- A quote is valid only when `serverNow < expiresAt`.
- Checkout must reject at `serverNow >= expiresAt`.

Refresh:

- Refresh may accept an expired or near-expiry quote ID.
- Refresh performs full package, price, promotion, campaign, and eligibility resolution again.
- Refresh creates a new quote ID.
- The old quote remains unchanged.
- The customer must explicitly accept the refreshed price.
- No silent price substitution may happen during checkout.

Future policy may vary quote duration by region, game, payment method, supplier volatility, or campaign volatility, but the duration must be server-owned and snapshotted.

## 4. Quote Identity

Recommended public-safe quote ID format:

`AZQ_<base32-or-base62-random>_<short-check>`

Requirements:

- High entropy.
- Non-sequential.
- Public-safe.
- No Mongo ObjectId exposure.
- No embedded user id, package id, price, timestamp, or supplier data.

Internal database identity:

- Future `PricingQuote` documents may use Mongo `_id` internally.
- Public flows must reference `quoteId`, not `_id`.

Idempotency:

- Quote creation should support a caller-provided idempotency key.
- Scope should include owner/session, package identity, region, currency, coupon code, quantity, and intended payment method when supplied.
- Replaying the same idempotency key within the valid creation window should return the same issued quote or a safe terminal-state explanation.

Ownership:

- Authenticated quote: bind to canonical `userId` and optional session id.
- Anonymous quote: bind to signed session id or equivalent server-owned anonymous session. Anonymous quotes must not be reusable by other sessions.
- A quote may later be upgraded from anonymous to authenticated only through an explicit ownership handoff policy. That policy is deferred.

Package identity fields:

- `packageId`: operational stable identity.
- `packageCode`: existing catalog/display/integration code.
- `packageRef`: nullable future `CatalogPackage` ObjectId.

## 5. Server-Owned Inputs

Only trusted server-side sources may provide authoritative commercial facts:

- catalog package/product facts
- package availability and purchasability
- supplier cost
- supplier currency
- exchange rate and metadata
- pricing policy
- pricing rules
- promotion candidates
- campaign facts
- promotion usage counters
- user eligibility facts
- tax and fee configuration
- currency
- normalized region
- quote timestamps
- calculation versions
- resolver versions
- price version lineage

Client may request:

- package identity
- region
- intended payment method
- coupon code
- quantity where supported

Client must never submit authoritative:

- supplier cost
- exchange rate
- pricing rules
- promotion eligibility facts
- usage counters
- discount amount
- final amount
- quote timestamps
- integrity hash/signature

Browser-submitted amount/currency may remain as compatibility hints only until quote checkout is implemented. They must not become commercial authority.

## 6. Quote Snapshot Contract

The future immutable quote snapshot should use these sections.

### A. Identity

```js
{
  quoteId,
  owner: {
    userId,
    sessionId,
    anonymous: false
  },
  package: {
    packageId,
    packageCode,
    packageRef,
    packageName,
    productCode,
    productName,
    gameId,
    gameName,
    categoryId
  },
  region,
  currency
}
```

### B. Pricing Input Snapshot

```js
{
  supplierCost,
  supplierCurrency,
  exchangeRate: {
    sourceCurrency,
    targetCurrency,
    rate,
    asOf,
    source,
    providerVersion
  },
  policy: {
    pricingPolicyId,
    policyCode,
    policyVersion,
    supplierFee,
    businessCost,
    gatewayFee,
    platformCost,
    tax,
    profitRule,
    roundingRule,
    minimumProfitAmount,
    minimumProfitMarginPercent
  },
  appliedPricingRules: [
    {
      ruleId,
      code,
      ruleType,
      scopeType,
      scopeReference,
      priority,
      value,
      configurationHash,
      version
    }
  ]
}
```

### C. Pricing Result Snapshot

```js
{
  costBeforeProfit,
  profitAmount,
  supplierFeeAmount,
  businessCostAmount,
  gatewayFeeAmount,
  platformFeeAmount,
  pricingRuleFeeAmount,
  taxAmount,
  preRoundingPrice,
  regularPrice,
  originalPrice,
  totalCost,
  calculatedProfitAmount,
  calculatedMarginPercent,
  breakdown,
  warnings,
  engineVersion,
  specificationVersion
}
```

### D. Promotion Snapshot

```js
{
  couponCodeMasked,
  selectedPromotion: {
    promotionId,
    code,
    name,
    promotionType,
    discountAmount,
    candidateFinalPrice,
    effectiveDiscountPercent,
    scopeSpecificity,
    priority,
    campaignId,
    selectionReason
  },
  eligiblePromotionSummary,
  rejectedPromotionSummary,
  eligibilityTraceSummary,
  resolverVersion,
  promotionSpecificationVersion,
  warnings
}
```

### E. Final Commercial Snapshot

```js
{
  originalPrice,
  discountAmount,
  quotedUnitPrice,
  quantity,
  quotedFinalPrice,
  currency,
  amountPrecision,
  roundingPolicy
}
```

For single-package top-up flows, `quantity` should default to `1`. If quantity support is added later, multiplication must happen after unit price resolution using a documented per-unit versus total-discount policy.

### F. Lifecycle

```js
{
  status,
  issuedAt,
  expiresAt,
  usedAt,
  expiredAt,
  cancelledAt,
  invalidatedAt,
  invalidationReason,
  checkoutOrderId,
  checkoutAttemptId
}
```

Lifecycle metadata may change after issue, but commercial snapshot fields must not.

### G. Integrity

```js
{
  payloadVersion,
  canonicalHash,
  signature,
  hashAlgorithm,
  hmacKeyVersion,
  canonicalizedAt
}
```

The integrity payload must exclude mutable lifecycle fields such as `status`, `usedAt`, `cancelledAt`, `invalidatedAt`, and `checkoutOrderId`.

## 7. Immutability Policy

Immutable after issue:

- identity
- package snapshot
- region
- currency
- supplier cost
- pricing inputs
- pricing result
- promotion result
- final commercial amount
- versions
- issuedAt
- expiresAt
- integrity payload

Mutable lifecycle metadata:

- status
- usedAt
- expiredAt
- cancelledAt
- invalidatedAt
- invalidation reason
- checkout order/attempt linkage
- audit metadata

Rules:

- Quote refresh creates a new quote.
- Price changes do not mutate existing quotes.
- Promotion changes do not mutate existing quotes.
- Rule publication creates new future quotes only.
- Used quote content remains auditable.
- Admin correction must invalidate or supersede, not edit commercial fields.

## 8. Integrity And Hashing

Canonical serialization:

- Use a stable JSON canonicalization strategy with sorted object keys.
- Normalize dates to ISO UTC strings.
- Normalize numbers according to the current commerce precision policy before hashing.
- Exclude undefined fields.
- Include explicit `null` only when the field is part of the payload contract.

Included commercial fields:

- quote id
- owner binding hash or safe owner reference
- package identity and display snapshot
- region/currency
- pricing input snapshot
- pricing result snapshot
- promotion snapshot
- final commercial snapshot
- issuedAt/expiresAt
- engine/resolver/specification/price-version lineage

Excluded mutable lifecycle fields:

- status
- usedAt
- expiredAt
- cancelledAt
- invalidatedAt
- invalidation reason
- checkout order id
- retry counters
- updatedAt

Hash algorithm:

- Recommended: SHA-256 over canonical payload.

Signature/HMAC decision:

- Use HMAC-SHA-256 for tamper detection once quote payloads cross client boundaries.
- Store `hmacKeyVersion`.
- Rotate by accepting active and previous key versions for verification during the maximum quote lifetime.
- Never expose HMAC keys or raw server secrets.

Important trust rule:

- A client-provided quote payload is not trusted merely because it contains a hash.
- Checkout must load trusted server-owned quote data by `quoteId` or reconstruct it from authoritative storage.
- Hash verification is a defense-in-depth integrity check, not a replacement for server ownership.

Verification failure:

- Reject checkout.
- Mark or log integrity mismatch for audit.
- Do not create an order from a mismatched quote.
- Do not recalculate silently and proceed.

## 9. Checkout Validation Contract

Future checkout sequence:

1. Receive `quoteId`.
2. Load server-owned quote.
3. Verify user/session ownership.
4. Verify status is `ISSUED`.
5. Verify `serverNow < expiresAt`.
6. Verify quote integrity.
7. Verify package is still purchasable.
8. Verify inventory policy where applicable.
9. Verify payment method compatibility.
10. Recheck promotion usage limits if no redemption reservation exists.
11. Create order/payment attempt from quote snapshot.
12. Mark quote `USED` atomically or idempotently.

Checkout must not recalculate price from browser totals.

Retry behavior:

- Same idempotency key and same valid quote should return the same order/payment attempt result.
- Duplicate checkout with an already used quote should return the existing linked order/attempt when ownership and idempotency match.
- Duplicate checkout with conflicting idempotency should fail with a duplicate-consumption error.

Concurrency:

- Quote consumption must be atomic.
- Only one transition from `ISSUED` to `USED` may win.
- Losers must receive the existing consumed result or a deterministic conflict response.

## 10. Invalidation Policy

Issued quotes may be invalidated when:

- package disabled
- package hidden or no longer purchasable
- supplier unavailable
- inventory unavailable when reservation is required
- legal/compliance block
- critical pricing defect
- currency or exchange emergency
- promotion revoked for fraud
- campaign compliance issue
- payment method no longer compatible before checkout
- admin manual invalidation

Normal price-rule updates should not mutate or invalidate issued quotes unless a future policy explicitly marks the change as critical.

Invalidation must record:

- reason code
- actor/source
- timestamp
- safe detail

## 11. Quote Refresh

Refresh semantics:

- Accept an expired or near-expiry quote id.
- Verify ownership before refresh.
- Load current authoritative package/pricing/promotion/campaign facts.
- Perform a full new base calculation.
- Perform a full new promotion resolution.
- Issue a new quote id.
- Keep the previous quote unchanged.
- Link `refreshedFromQuoteId` for audit.

The refreshed quote may have:

- a different selected promotion
- a different original price
- a different discount amount
- a different final price
- a different expiry time
- a different price version lineage

The client must display the refreshed amount and require explicit acceptance. Checkout must not substitute refreshed pricing silently.

## 12. Idempotency

Quote creation idempotency:

- Key scope: owner/session + package identity + region + currency + coupon + quantity + intended payment method + request key.
- Repeated creation with the same key should return the same active quote if still valid.
- If the old quote is terminal, the response should explain the terminal state or require a new key according to future policy.

Checkout consumption idempotency:

- Key scope: owner/session + quoteId + intended checkout action.
- One quote may create only one order/payment attempt.
- Repeated checkout attempts with the same key return the same result.
- Conflicting keys for a consumed quote must not create a second order.

Idempotency record retention:

- At least the maximum quote lifetime plus operational retry window.
- Longer retention may be needed for payment attempts and audit, but that belongs to checkout/payment services.

## 13. Price And Currency Rules

Currency:

- A quote has exactly one storefront currency.
- Supplier currency and exchange metadata are preserved separately.
- Currency cannot change after quote issue.
- MMK and THB must never be summed.

Quantity:

- Initial top-up flow should default to quantity `1`.
- If quantity is supported later, the quote must specify whether discounts apply per unit or to the total.
- Recommended initial policy: calculate unit price, apply promotion to unit price, multiply by quantity only for explicitly quantity-supported packages.

Rounding:

- Base price rounding occurs inside `calculateBasePrice`.
- Promotion result should preserve the resolver output.
- Future post-promotion rounding must be explicit; do not invent hidden rounding in checkout.

Zero and negative prices:

- Negative quoted prices are prohibited.
- Zero-price quotes may be blocked until a typed free-order policy exists.
- Maximum amount must respect the current commerce engine `MAX_SAFE_AMOUNT` limit unless a future Decimal/minor-unit migration replaces it.

Precision:

- Current commerce runtime uses JavaScript `Number` with six-decimal normalization.
- Future high-volume financial work should migrate to integer minor units or Decimal128-style arithmetic.
- A quote must snapshot the precision strategy used at issue time.

## 14. Promotion Interaction

At quote issue:

- Promotion eligibility is evaluated.
- Resolver winner is snapshotted.
- Promotion redemption is not consumed.
- Usage counters may be checked but are not mutated by the resolver.

At checkout:

- If no reservation exists, usage limits must be rechecked.
- If usage is exhausted, checkout should reject or require quote refresh according to policy.
- If the promotion is expired but the quote is still valid, the default policy should honor the snapshotted promotion unless fraud/compliance invalidation applies.
- If promotion is revoked for fraud/compliance, invalidate the quote.

Explicit distinction:

- Eligibility snapshot: what the resolver decided when quote was issued.
- Redemption reservation: optional future hold against promotion limits.
- Redemption consumption: permanent usage record after successful checkout/order policy.

Coupon policy:

- Store coupon code only in normalized uppercase form where needed.
- Customer/admin display may show masked code when appropriate.
- Do not store raw sensitive customer eligibility facts inside the public-safe quote payload.

## 15. Inventory And Supplier Interaction

Current initial policy:

- Quote does not reserve supplier inventory.
- Quote does not reserve wallet balance.
- Quote does not reserve promotion redemption unless a future reservation layer is added.

Checkout must revalidate:

- package still purchasable
- inventory state
- supplier availability
- payment method compatibility

Supplier cost changes:

- Do not rewrite existing quotes.
- New quotes use current supplier cost.
- Checkout may reject if supplier unavailability makes fulfillment impossible.

Future reservation support is deferred and should be designed with expiry, release, and failure recovery.

## 16. Order Snapshot Handoff

Future order creation should copy from quote:

- `quoteId`
- package/product/game snapshot
- region
- currency
- original price
- discount amount
- final amount
- pricing input snapshot
- pricing result snapshot
- promotion snapshot
- engine/resolver/specification versions
- price version lineage
- integrity hash/signature reference
- issuedAt
- expiresAt
- checkout consumption time

Order must not depend on later quote mutation. Once an order is created, order lifecycle owns fulfillment/payment state, while quote remains a commercial audit source.

Current `Order` fields such as `originalAmount`, `discountAmount`, `finalAmount`, `promoSnapshot`, `promoRedemptionId`, `currency`, `region`, and `packageCode` provide a compatible landing zone, but a future sprint should add explicit quote references rather than overloading promo fields.

## 17. Failure Matrix

| Future Code | Condition | Expected Behavior |
| --- | --- | --- |
| `QUOTE_NOT_FOUND` | No server-owned quote for id. | Reject checkout; customer may request a new quote. |
| `QUOTE_OWNER_MISMATCH` | User/session does not own quote. | Reject and audit. |
| `QUOTE_EXPIRED` | `serverNow >= expiresAt`. | Reject; allow explicit refresh. |
| `QUOTE_ALREADY_USED` | Quote is terminal `USED`. | Return existing result only when idempotency/owner match. |
| `QUOTE_CANCELLED` | Customer/session cancelled quote. | Reject; require new quote. |
| `QUOTE_INVALIDATED` | Admin/system invalidated quote. | Reject; explain safe reason. |
| `QUOTE_INTEGRITY_MISMATCH` | Hash/signature does not verify. | Reject; audit security event. |
| `PACKAGE_UNAVAILABLE` | Package disabled/hidden/unpurchasable. | Reject or refresh when package returns. |
| `INVENTORY_UNAVAILABLE` | Stock/supplier state blocks purchase. | Reject checkout; do not consume quote. |
| `SUPPLIER_UNAVAILABLE` | Supplier cannot fulfill. | Reject or route to future fallback policy. |
| `PAYMENT_METHOD_MISMATCH` | Quote payment constraints do not match selected method. | Reject or require refresh with new intended method. |
| `PROMOTION_USAGE_EXHAUSTED` | Usage limit reached after quote issue. | Reject or require refresh without that promotion. |
| `UNSUPPORTED_CURRENCY` | Currency unsupported by quote/payment/order. | Reject. |
| `STALE_CLIENT_PRICE` | Browser total differs from quote. | Ignore browser total; use quote or reject if tampering suspected. |
| `DUPLICATE_CHECKOUT_REQUEST` | Same quote consumed concurrently. | Return idempotent result or deterministic conflict. |
| `CONCURRENT_CONSUMPTION` | Two atomic consumes race. | One wins; others receive existing result/conflict. |

## 18. Security And Privacy

Security requirements:

- High-entropy public quote ids.
- Strict user/session ownership checks.
- Rate limit quote creation.
- Do not expose supplier credentials.
- Do not expose payment credentials.
- Do not expose internal sequential identifiers.
- Do not trust client-provided quote payloads.
- Do not trust client-provided price totals.
- Audit quote creation, refresh, invalidation, and consumption.

Privacy requirements:

- Store minimal user data in the quote.
- Prefer user id/session id over email/phone.
- Mask coupon codes in customer-safe displays when needed.
- Do not snapshot unnecessary customer profile details.
- Define retention/deletion policy before implementing persistence.

## 19. Observability And Audit

Future trace fields:

- `traceId`
- `quoteId`
- `engineVersion`
- `resolverVersion`
- `pricingSpecificationVersion`
- `promotionSpecificationVersion`
- `priceVersionId`
- `priceVersionNumber`
- `branchKey`
- `pricingPolicyId`
- applied pricing rule ids/codes
- selected promotion id/code
- campaign id/code
- user/session owner
- issue source
- refresh source
- invalidation reason
- checkout order id
- checkout attempt id

Admin/debug visibility may include rule ids, trace ids, version lineage, and rejection summaries.

Customer-safe output should include only package, original price, discount, final price, currency, expiry, selected public promotion label, and safe warnings.

## 20. Model And Service Roadmap

Future components:

- `PricingQuote` model: persistent quote record and immutable commercial snapshot.
- `PricingQuoteService`: high-level quote issue/refresh/read lifecycle API.
- `QuoteIntegrityService`: canonical payload hashing/signing and verification.
- `QuoteCandidateLoader`: loads trusted package, policy, rule, promotion, campaign, usage, exchange, and inventory facts.
- `QuoteCreationOrchestrator`: runs base calculation and promotion resolver, then stores the quote.
- `QuoteValidationService`: validates ownership, expiry, status, integrity, package, inventory, usage, and payment compatibility.
- `QuoteInvalidationService`: invalidates issued quotes under critical policy conditions.
- `QuoteCleanupJob`: expires and eventually deletes/archives old quotes according to retention policy.
- `QuoteToOrderMapper`: copies immutable quote snapshots into order/payment attempt creation.

Boundaries:

- Pricing engine calculates base price only.
- Promotion resolver selects a promotion only.
- Quote orchestrator owns the combined commercial offer.
- Checkout consumes quotes; it does not calculate price.
- Order owns fulfillment/payment lifecycle after quote consumption.

## Architecture Decisions

### ADR-Q01 Server-Owned Quote

PricingQuote must be generated server-side from trusted data. Browser totals are compatibility hints only.

### ADR-Q02 Short-Lived Immutable Commercial Snapshot

Every quote has finite expiry. Commercial fields cannot be edited after issue.

### ADR-Q03 Quote Is Not Reservation

Initial quote does not reserve stock, supplier capacity, wallet balance, or promotion redemption. Checkout revalidates critical facts.

### ADR-Q04 HMAC For Boundary Integrity

When implemented, quote integrity should use canonical payload hashing plus HMAC. Plain hashes are insufficient once payloads cross client boundaries.

### ADR-Q05 New Quote On Refresh

Refreshing creates a new quote id. Existing quotes are never silently repriced.

### ADR-Q06 One Storefront Currency Per Quote

A quote freezes exactly one storefront currency and preserves supplier/exchange metadata separately.

## Deferred Work

Deferred to future sprints:

- `PricingQuote` model
- quote APIs
- quote creation service
- quote checkout validation
- quote integrity implementation
- quote cleanup/expiry job
- quote refresh UI
- quote-to-order mapper
- promotion reservation/consumption integration
- inventory reservation
- payment compatibility enforcement
- Decimal/minor-unit money migration
