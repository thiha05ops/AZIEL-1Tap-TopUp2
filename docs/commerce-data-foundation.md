# AZIEL Commerce Data Foundation

This document describes the Commerce Data Foundation introduced for future pricing, promotion, campaign, inventory, and versioning engines. It is a storage foundation only. It does not implement runtime calculations, publishing, checkout integration, storefront changes, migrations, or seed data.

## Model Purposes

### PricingPolicy

Stores reusable pricing configuration such as default supplier fee, business cost, platform cost, gateway fee, tax, profit rule, rounding rule, and margin guard settings. A policy is configuration, not a calculated customer price.

### PricingRule

Stores scoped pricing overrides under a policy. Rules can target global, region, game, category, tier, or package scopes through `scopeType` and `scopeReference`. No precedence resolver is implemented in this sprint.

### PromotionRule

Stores discount or reward configuration for future promotion resolution. It is intentionally separate from the existing `PromoCode` runtime engine. Coupon compatibility is represented structurally through `requiresCoupon` and `couponCode`, but no redemption or eligibility runtime behavior is changed.

### CommerceCampaign

Stores future commerce campaign scheduling, targeting, limits, budget, and presentation metadata. It is intentionally named `CommerceCampaign` to avoid collision with the existing public popup/banner `Campaign` model.

### PackageInventoryState

Stores the current purchasability state for a catalog package. It is intentionally named `PackageInventoryState` to avoid ambiguity with generic operational inventory concepts.

### PriceVersion

Stores draft and published pricing-configuration version metadata. It references policies, pricing rules, promotion rules, and commerce campaigns. It does not store mutable live calculation results.

## Relationships

- `PricingRule.policyId` references `PricingPolicy`.
- `CommerceCampaign.promotionRuleIds` references `PromotionRule`.
- `PriceVersion.pricingPolicyId` references `PricingPolicy`.
- `PriceVersion.pricingRuleIds` references `PricingRule`.
- `PriceVersion.promotionRuleIds` references `PromotionRule`.
- `PriceVersion.campaignIds` references `CommerceCampaign`.
- `PackageInventoryState.packageId` stores the catalog package identity as a string, compatible with the existing Catalog package-code architecture.
- Scope references remain polymorphic strings for product/game/category/tier/package identifiers until future resolver phases define authoritative lookup behavior.

## Ownership Boundaries

- Catalog owns product and package identity.
- Inventory owns package purchasability.
- Pricing owns base and regular price configuration.
- Promotion owns discounts and rewards.
- Campaign owns scheduling, targeting, and customer-facing campaign metadata.
- Display owns presentation only.
- Checkout will perform final server-side verification in a later sprint.
- Orders will preserve immutable pricing snapshots in a later sprint.

## Status Lifecycle Meanings

### Pricing Policy Status

- `DRAFT`: configuration is being prepared.
- `ACTIVE`: configuration is eligible for future runtime use.
- `INACTIVE`: configuration is intentionally disabled.
- `ARCHIVED`: configuration is retained for history and should not be used.

### Promotion Rule Status

- `DRAFT`: promotion configuration is being prepared.
- `SCHEDULED`: promotion has future timing metadata.
- `ACTIVE`: promotion is eligible for future runtime use.
- `PAUSED`: promotion is temporarily disabled.
- `ENDED`: promotion timing has completed.
- `ARCHIVED`: promotion is retained for history and should not be used.

### Campaign Status

- `DRAFT`: campaign configuration is being prepared.
- `SCHEDULED`: campaign has future timing metadata.
- `ACTIVE`: campaign is eligible for future runtime use.
- `PAUSED`: campaign is temporarily disabled.
- `ENDED`: campaign timing has completed.
- `CANCELLED`: campaign was stopped before completion.
- `ARCHIVED`: campaign is retained for history and should not be used.

### Price Version Status

- `DRAFT`: version is being assembled.
- `VALIDATED`: version has passed future validation.
- `APPROVED`: version has been approved for future publishing.
- `PUBLISHED`: version is the future live configuration.
- `SUPERSEDED`: version has been replaced.
- `ROLLED_BACK`: version was reverted by a future rollback flow.
- `ARCHIVED`: version is retained for history.

## Availability-State Semantics

- Manual override has higher priority than supplier state.
- `AVAILABLE` is visible and purchasable.
- `OUT_OF_STOCK` remains visible but cannot be purchased.
- `TEMPORARILY_UNAVAILABLE` remains visible with a message.
- `COMING_SOON` remains visible but cannot be purchased.
- `HIDDEN` is excluded from storefront display.
- `DISCONTINUED` preserves historical records.
- Delete is not an operational availability state.

These rules are documented only. No checkout or storefront behavior is modified in this sprint.

## Intended Future Rule Precedence

Future pricing resolution can evaluate rules in this broad order:

1. Active policy defaults.
2. Global rules.
3. Region rules.
4. Game/category/tier rules.
5. Package rules.
6. Priority ordering.
7. `stopFurtherProcessing` boundaries.
8. Rounding.

No resolver, calculator, or precedence engine is implemented in this sprint.

## Draft vs Published Concepts

`PriceVersion` separates configuration assembly from future published pricing. Draft versions can reference draft policies and rules. Published versions are planned to represent a future immutable configuration selection, not calculated package prices.

Each `PriceVersion` has an immutable `versionId` for external lineage, a positive `versionNumber`, and a `branchKey` that defaults to `main`. The `(branchKey, versionNumber)` pair is unique, which allows future draft branches without assuming every version number is globally unique. `parentVersionId`, `sourceVersionId`, and `rollbackOfVersionId` describe lineage only; they do not execute publish, rollback, merge, storefront switching, or calculated-price generation.

## Canonical Package Identity

The current catalog remains the source of truth for package identity and continues to use `productCode + packageCode` in runtime paths. This sprint does not migrate existing package records.

New commerce foundation models use this compatibility contract wherever package identity is needed:

- `packageId`: the operational stable identifier for now. It is required, trimmed, and normalized uppercase where package codes are uppercase.
- `packageCode`: optional display or integration metadata, trimmed and normalized uppercase.
- `packageRef`: optional future `CatalogPackage` ObjectId reference. It is nullable and must not be required until a future catalog migration explicitly makes it safe.

`packageId` is the durable historical handle. `packageRef` may supplement it later but must not replace it for old records. No new Package model is introduced in this sprint.

## Promotion Eligibility Tree

`PromotionRule.eligibility` stores future eligibility structure only. It does not evaluate promotions. The tree supports group operators:

- `ALL`
- `ANY`
- `NOT`

Leaf conditions support:

- `field`
- `comparator`
- `value`
- `values`
- `metadata`

Comparators are structural only: `EQUALS`, `NOT_EQUALS`, `IN`, `NOT_IN`, `GREATER_THAN`, `GREATER_THAN_OR_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL`, `EXISTS`, `NOT_EXISTS`, `BETWEEN`, and `CONTAINS`.

Example only:

```json
{
  "operator": "ALL",
  "conditions": [
    { "field": "region", "comparator": "IN", "values": ["TH"] },
    { "field": "accountAgeDays", "comparator": "LESS_THAN_OR_EQUAL", "value": 7 },
    { "field": "successfulPaidOrders", "comparator": "EQUALS", "value": 0 }
  ]
}
```

No Welcome Discount runtime, user-profile coupling, resolver, or best-offer logic exists in this sprint.

## Metadata Policy

Metadata is optional extension data only. It must not contain or override core price, discount, inventory, lifecycle, approval, or identity fields. Runtime business rules must be first-class typed fields, not hidden in metadata.

Metadata keys should be namespaced where practical:

- `integration.*`
- `migration.*`
- `display.*`
- `diagnostics.*`

New commerce metadata fields validate as plain objects, reject dangerous keys such as `__proto__`, `constructor`, and `prototype`, and are bounded to a reasonable serialized size. Existing older models are not retrofitted in this sprint.

## Business-Rule Architecture Decision

AZIEL should prefer typed domain configuration over a generic key-value `BusinessRule` model.

Values such as welcome-offer duration, one-price-promotion-per-order, minimum-margin behavior, refund eligibility restoration, and default campaign policy should live in typed commerce configuration such as `PricingPolicy`, `PromotionRule`, or a future typed `CommercePolicy` model if a cross-domain need becomes real.

A generic `BusinessRule` model is intentionally not created because it weakens validation, discoverability, safety, ownership boundaries, and migration quality.

## Future PricingQuote Contract

`PricingQuote` is deferred. No model or service is implemented in this sprint.

Future quote fields are expected to include:

- `quoteId`
- `userId`
- package identity
- `region`
- `currency`
- `quantity`
- `paymentMethodId`
- `pricingVersionId`
- `regularPrice`
- `finalPrice`
- `discountAmount`
- `appliedPromotionId`
- `supplierOfferId`
- `expiresAt`
- `status`
- `calculationHash`
- reservation references
- `createdAt`

Expected lifecycle:

- `CREATED`
- `RESERVED`
- `CONSUMED`
- `EXPIRED`
- `CANCELLED`

Future security rules:

- quotes are server-generated
- quotes are short-lived
- monetary results are immutable
- checkout verifies quote ownership and expiry
- frontend amount is never trusted
- quote creation belongs to a later sprint

## Monetary Storage Note

The current repository stores monetary values as ordinary JavaScript numbers in catalog, order, wallet, and promo models. The commerce foundation preserves that convention to avoid a partial Decimal128 migration. Future calculation phases must account for floating-point precision risk and may choose integer minor units or Decimal128 as a coherent platform-wide migration.

## Deferred Migration Notes

- No current package identity migration.
- No ObjectId-only package references.
- No runtime promotion resolver.
- No pricing calculation engine.
- No generic `BusinessRule` key-value model.
- No `PricingQuote` implementation.
- No live version switching.
- No API/UI integration.

## Backward-Compatibility Guarantees

- Existing catalog records are unchanged.
- Existing `PromoCode` behavior is unchanged.
- Existing `Campaign` behavior is unchanged.
- Existing checkout, wallet, payment, order, notification, and admin runtime behavior is unchanged.
- Commerce foundation records can reference current string package identities and later supplement them with nullable `packageRef` values.

## Intended Future Flow

Catalog → Inventory → Pricing → Promotion → Campaign → Display → Checkout → Immutable Order Snapshot

In a later sprint, checkout should verify current server-side price, promotion, inventory, and campaign state before order creation. Orders should store immutable pricing snapshots for auditability.

## Explicitly Deferred Runtime Features

- Pricing calculations.
- Exchange-rate services.
- Profit calculations.
- Profit guard runtime.
- Promotion resolver.
- Best-offer selection.
- Coupon redemption.
- Campaign scheduler.
- Inventory synchronization.
- Supplier APIs.
- Published-price generation.
- Price quote generation.
- Checkout integration.
- Storefront integration.
- Order snapshot persistence.
- Admin UI.
- API routes.
- Database migrations.
