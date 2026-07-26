# AZIEL Commerce Promotion Resolver Specification

Sprint: 2.3.0

Status: Architecture specification only

This document defines the future Promotion Resolver architecture that will sit above the Sprint 2.2 base Pricing Engine. It is documentation only. It does not implement resolver runtime, calculations, APIs, checkout, quote creation, UI, database writes, migrations, or deployment changes.

## First-Audit Summary

The current `PromotionRule` foundation supports the core future resolver shape:

- lifecycle status through `PROMOTION_RULE_STATUS`
- promotion type through `PROMOTION_TYPE`
- generic scope records through `scopes`
- direct region and currency fields
- package targeting through canonical package identity
- game inclusion/exclusion arrays
- payment method and user segment targeting
- structural eligibility tree
- stackable and exclusive flags
- usage limits
- coupon requirements
- effective date windows
- refund eligibility restoration flag

The current `CommerceCampaign` foundation supports:

- campaign lifecycle status
- campaign date windows
- campaign-linked promotion IDs
- target regions, games, categories, tiers, packages, and user segments
- budget and redemption limits
- priority
- placement metadata

Known future gaps are intentional for this sprint:

- no runtime resolver
- no redemption ledger
- no user-level usage counter
- no mutually-exclusive group field yet
- no campaign budget consumption model
- no promotion/order snapshot writer
- no quote integration
- no checkout integration

## 1. Promotion Lifecycle

The future resolver should interpret the promotion lifecycle as:

Draft

↓

Scheduled

↓

Active

↓

Expired

↓

Archived

### Draft

`DRAFT` promotions are editable configuration. They must never apply to storefront, quote, or checkout calculations.

### Scheduled

`SCHEDULED` promotions have future timing metadata. They are visible to admin tooling and validation but are not applicable until their active window begins.

### Active

`ACTIVE` promotions are eligible for resolver consideration only when every runtime eligibility check passes.

### Expired

Expired is a runtime interpretation when `effectiveUntil` is in the past or the attached campaign is out of range. The current model uses `ENDED` as a stored status. A future resolver may report `EXPIRED` as a rejection reason even if the stored status is still `ACTIVE`, but the persisted lifecycle should remain explicit and auditable.

### Archived

`ARCHIVED` promotions are historical configuration and must not apply to new quotes or checkout flows.

## 2. Promotion Scopes

Promotion scopes should resolve from most specific to broadest:

1. Package
2. Category
3. Game
4. Region
5. Global

Additional user scope is eligibility-oriented and should filter applicability rather than override package/catalog specificity.

Supported future scopes:

- Global
- Region
- Game
- Category
- Package
- User

The resolver must support existing `PromotionRule.scopes`, direct region/currency fields, package identity arrays, game inclusion/exclusion arrays, payment method arrays, user segment arrays, and the eligibility tree. A later sprint may add first-class category/tier arrays if needed.

## 3. Promotion Types

Supported architecture-level promotion types:

- Percentage Discount
- Fixed Discount
- Price Override
- Free Bonus
- Bundle
- Wallet Credit (future)

Current model mapping:

- Percentage Discount → `PERCENTAGE_DISCOUNT`
- Fixed Discount → `FIXED_DISCOUNT`
- Price Override → `OVERRIDE_PRICE`
- Free Bonus → `FREE_ITEM`
- Wallet Credit / Bundle → future typed extension, not runtime-supported yet

Price-affecting promotions must produce a deterministic discount or override amount. Non-price rewards must be snapshotted but must not silently change the monetary calculation.

## 4. Eligibility

A promotion is eligible only when all relevant checks pass.

Required future eligibility dimensions:

- date window
- region
- currency
- game
- category
- package
- user tier
- first purchase
- minimum spend
- maximum spend
- total usage limit
- per-user usage limit
- campaign state

The future resolver should use `PromotionRule.eligibility` for structured conditions and first-class fields for high-volume indexed filters.

Eligibility examples:

- Date: current evaluation time is within `effectiveFrom` and `effectiveUntil`.
- Region: order/quote region matches promotion region or scope.
- Currency: calculated original price currency matches promotion currency.
- Game/category/package: package identity and catalog context match.
- User tier: authenticated customer segment matches allowed segments.
- First purchase: customer has no successful paid order before the evaluation time.
- Minimum spend: original price meets or exceeds `minimumOrderAmount`.
- Maximum spend: original price is less than or equal to configured upper bound when present.
- Usage limit: global redemption count is below `usageLimitTotal`.
- Per-user limit: user redemption count is below `usageLimitPerUser`.
- Campaign: attached `CommerceCampaign` is active, in range, and not exhausted.

The resolver must not trust client-supplied eligibility facts. User/order counts and usage counters must be server-owned.

## 5. Stackability

### Stackable

A promotion with `stackable: true` may combine with other stackable promotions only when policy allows it and no exclusive winner has been selected.

### Exclusive

A promotion with `exclusive: true` blocks stacking. If multiple exclusive promotions are eligible, the resolver chooses one deterministic winner.

### Mutually Exclusive Groups

Mutually exclusive groups are deferred. A future typed field such as `exclusiveGroupKey` may be added when real campaign needs require it. Until then, exclusivity is global for the promotion.

### Maximum Stack Count

Maximum stack count is deferred to a future typed commerce policy. Default future behavior should be one price-affecting promotion per order unless a typed policy explicitly allows stacking.

## 6. Priority

Resolver priority should use this order:

Package

↓

Category

↓

Game

↓

Region

↓

Global

Tie-break rules:

1. higher explicit `priority`
2. better customer benefit after applying guard checks
3. earlier expiry
4. older created date
5. promotion code alphabetical order
6. stable database id only as final deterministic fallback

The resolver must never let Mongo natural order or JavaScript object insertion order decide a winner.

## 7. Resolver Output

The future resolver should return a structured output:

```json
{
  "success": true,
  "strategy": "BEST_SINGLE",
  "eligiblePromotions": [],
  "rejectedPromotions": [],
  "winningPromotion": null,
  "appliedPromotions": [],
  "reasons": [],
  "warnings": []
}
```

### Eligible Promotions

Each eligible promotion should include:

- promotion id/code
- promotion type
- scope match
- priority
- expected benefit
- stackability flags
- campaign reference when applicable

### Rejected Promotions

Each rejected promotion should include:

- promotion id/code
- rejection reason code
- safe detail

### Winning Promotion

The winning promotion is the single promotion selected under the active strategy. With future stackable strategy, `winningPromotion` may represent the primary winner while `appliedPromotions` lists the full stack.

### Reasons

Reasons explain the decision path in admin/debug surfaces. They must be safe and must not leak private user data.

### Applied Strategy

Initial future strategies:

- `BEST_SINGLE`
- `EXCLUSIVE_ONLY`
- `STACKABLE_LIMITED`
- `NO_PROMOTION`

### Warnings

Warnings are non-blocking facts such as:

- campaign near quota
- promotion close to expiry
- promotion reduces margin materially
- stackable promotion skipped by policy
- ambiguous same-priority promotion resolved by tie-breaker

## 8. Failure Rules

Future rejection/failure reason codes:

- `PROMOTION_DRAFT`
- `PROMOTION_DISABLED`
- `PROMOTION_SCHEDULED`
- `PROMOTION_EXPIRED`
- `PROMOTION_ARCHIVED`
- `REGION_MISMATCH`
- `CURRENCY_MISMATCH`
- `PACKAGE_MISMATCH`
- `GAME_MISMATCH`
- `CATEGORY_MISMATCH`
- `USER_TIER_MISMATCH`
- `FIRST_PURCHASE_REQUIRED`
- `MINIMUM_SPEND_NOT_MET`
- `MAXIMUM_SPEND_EXCEEDED`
- `QUOTA_REACHED`
- `USER_LIMIT_REACHED`
- `MISSING_TARGET`
- `CAMPAIGN_INACTIVE`
- `CAMPAIGN_EXPIRED`
- `CAMPAIGN_QUOTA_REACHED`
- `COUPON_REQUIRED`
- `COUPON_MISMATCH`
- `POLICY_BLOCKED_STACKING`

Rules:

- Expired promotions are excluded, not fatal to base price calculation.
- Disabled/draft/archived promotions are rejected with reasons.
- Quota/user-limit failures reject only that promotion.
- Missing target data rejects target-specific promotions.
- Inactive campaigns reject campaign-linked promotions.
- Resolver failure must not silently fall back to a client-provided discount.

## 9. Architecture Decisions

### Resolver Runs After Base Price

The Promotion Resolver runs after the Pricing Engine produces `originalPrice`. This preserves clean price auditability and makes discounts explainable.

### Server-Owned Facts Only

Eligibility facts such as user tier, first purchase, order count, spend, usage, quota, campaign state, and coupon redemption are server-owned. The browser may request a promotion check but cannot supply trusted eligibility truth.

### Typed Fields Before Metadata

Promotion behavior must live in typed model fields or typed future policy. Metadata must not hide resolver logic.

### Deterministic Winner Selection

The resolver must sort explicitly and provide reasons. No winner may depend on database natural order or object insertion order.

### One Price-Affecting Promotion By Default

The initial runtime policy should choose the best single price-affecting promotion. Stackability requires explicit policy and verifier coverage.

### Campaign Is A Constraint, Not A Discount

`CommerceCampaign` schedules and targets promotions. It does not calculate discounts by itself.

### Promotion Snapshot Required Later

Future quote/order integration must snapshot applied promotion id/code, type, benefit, campaign reference, discount amount, rejection/warning context where useful, and resolver strategy.

## 10. Future Runtime Requirements

Before runtime implementation, AZIEL needs:

- promotion candidate loader
- campaign candidate loader
- redemption/usage ledger
- per-user usage counter
- coupon ownership and redemption guard
- user eligibility facts provider
- package/catalog context provider
- resolver strategy policy
- margin/profit guard integration
- quote snapshot integration
- order snapshot integration
- admin debug/audit output
- verifier coverage for deterministic sorting and rejection reasons

## Explicitly Deferred

This sprint does not implement:

- promotion resolver runtime
- promotion calculations
- campaign activation
- usage counters
- coupon redemption
- quote integration
- checkout integration
- order snapshots
- APIs/routes/controllers
- admin UI
- storefront UI
- database writes
- migrations
- deployment
