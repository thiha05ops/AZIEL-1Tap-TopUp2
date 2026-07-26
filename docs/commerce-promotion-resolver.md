# AZIEL Commerce Promotion Resolver Runtime

Sprint: 2.3.1

Status: Pure runtime foundation

This document describes the implemented Promotion Resolver runtime. The resolver is intentionally side-effect free: it performs no database queries, no writes, no network calls, no checkout mutation, no usage counter mutation, and no quote persistence.

## Runtime Entry Point

`backend/services/commerce/promotionResolver.js` exports:

- `resolvePromotion(input)`
- `PromotionResolverError`
- `ERROR_CODES`
- `REASON_CODES`
- `WARNING_CODES`
- `RESOLVER_VERSION`
- `SPECIFICATION_VERSION`

The public function is synchronous and deterministic. Identical normalized input produces deeply equal output. The resolver requires `context.evaluationTime`; it never uses implicit server time.

## Input Contract

The resolver accepts normalized promotion candidates and server-owned context facts:

```js
{
  originalPrice: 1490,
  currency: "THB",
  promotions: [],
  campaigns: [],
  context: {
    evaluationTime: "2026-07-26T12:00:00.000Z",
    region: "TH",
    currency: "THB",
    packageId: "MLBB-7740",
    packageCode: "MLBB_7740",
    packageRef: "optional-catalog-package-id",
    gameId: "mlbb",
    categoryId: "mobile-games",
    userId: "user-1",
    userTier: "VIP",
    isFirstPurchase: false,
    orderSubtotal: 1490,
    couponCode: "SAVE10",
    usage: {
      promotionUsageTotal: {},
      userPromotionUsage: {}
    }
  },
  strategy: {
    mode: "BEST_PRICE",
    allowPriceOverride: false
  }
}
```

`usage` facts must be supplied by server-owned counters in future integration. If a promotion has usage limits and those facts are missing, the promotion fails safely and emits `USAGE_FACTS_MISSING`.

## Supported Promotion Types

Price-comparable types:

- `PERCENTAGE_DISCOUNT`
- `FIXED_DISCOUNT`
- `PRICE_OVERRIDE`
- existing model alias `OVERRIDE_PRICE`

Deferred non-price types:

- `FREE_BONUS`
- `BUNDLE`
- `WALLET_CREDIT`
- existing model aliases `FREE_ITEM`, `NON_PRICE_REWARD`

Deferred types are rejected with `UNSUPPORTED_PROMOTION_TYPE`; they are not silently applied to money.

## Eligibility Checks

The resolver evaluates:

- enabled flag
- lifecycle status
- effective start/end dates
- region and currency
- explicit scopes
- package include/exclude identity
- game include/exclude identity
- category include identity
- user tier/user segment
- first purchase
- minimum and maximum spend
- coupon requirement
- total and per-user usage limits
- attached campaign status, schedule, and targeting
- structured eligibility tree

The eligibility tree supports `ALL`, `ANY`, and `NOT`, with the comparators already declared by the commerce foundation. `NOT` requires exactly one child. Nesting is capped at the shared commerce depth of five.

## Winner Selection

Sprint 2.3.1 supports the `BEST_PRICE` strategy only.

Tie-break order:

1. lowest candidate final price
2. higher scope specificity
3. higher explicit priority
4. earlier `createdAt`
5. lexical promotion code
6. lexical promotion id
7. original candidate index

Only one selected promotion is returned. Stackability is snapshotted for future policy work but is not applied yet.

## Output Contract

The resolver returns:

```js
{
  resolverVersion: "2.3.1",
  specificationVersion: "2.3.0",
  strategy: { mode: "BEST_PRICE", allowPriceOverride: false },
  originalPrice: 1490,
  currency: "THB",
  selectedPromotion: null,
  candidateFinalPrice: 1490,
  discountAmount: 0,
  effectiveDiscountPercent: 0,
  eligiblePromotions: [],
  rejectedPromotions: [],
  warnings: [],
  resolutionTrace: []
}
```

The output is frozen to discourage accidental mutation by future integration layers.

## Integration Boundary

Future quote or checkout integration should call the resolver after base price calculation and before creating a customer-visible quote. The integration layer must:

- supply server-owned customer/order facts
- supply usage counters
- supply campaigns already loaded from the authoritative data source
- snapshot the resolver result into quotes/orders
- write usage only after the payment/order policy permits it

The resolver itself must remain pure.
