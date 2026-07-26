# AZIEL Commerce Calculation Specification

Sprint: 2.1.2

Status: Architecture specification only

This document defines the intended calculation contract for the future AZIEL Pricing Engine. It is not runtime code. It does not implement pricing calculations, APIs, checkout integration, admin UI, storefront UI, migrations, seed data, or deployment changes.

The specification builds on:

- `PricingPolicy`
- `PricingRule`
- `PromotionRule`
- `CommerceCampaign`
- `PackageInventoryState`
- `PriceVersion`
- the canonical package identity contract

## 1. Calculation Flow

The future calculation engine should resolve prices in this order:

Supplier Cost

↓

Business Cost

↓

Profit

↓

Exchange

↓

Fees

↓

Tax

↓

Rounding

↓

Original Price

↓

Promotion

↓

Final Price

### Why This Order Exists

1. Supplier cost is the economic base. It represents the direct package acquisition cost before AZIEL policy is applied.
2. Business cost is added before profit because operational costs should be recovered before margin is evaluated.
3. Profit is applied before exchange when the supplier cost is denominated in the supplier/source currency. This lets margin policy describe the business target before customer-region currency presentation.
4. Exchange converts the subtotal into the customer currency. Exchange must be server-owned and versioned or snapshotted.
5. Gateway, platform, and payment fees are added after exchange when the fee is tied to the customer currency or payment rail.
6. Tax is applied after taxable fees are known. Tax rules must be explicit per region and must not be hidden in metadata.
7. Rounding is applied to the regular customer-facing price so storefront prices are predictable.
8. Original price is the pre-promotion customer price.
9. Promotion applies after the original price is known so the discount can be audited and displayed.
10. Final price is the immutable amount a quote/order should verify.

The exact fee/tax inclusivity rules must be encoded in typed policy fields in a later runtime sprint. This document defines ordering, not implementation.

## 2. Pricing Rule Priority

Rule precedence should move from most specific to least specific:

Package

↓

Tier

↓

Category

↓

Game

↓

Region

↓

Global

Within the same scope, higher `priority` wins first. If two rules have the same priority, the future engine must use deterministic tie-breaking such as creation order or code ordering and report a validation warning during publish.

### Override Behavior

- Package rules override tier/category/game/region/global rules for the same pricing dimension.
- Tier rules override category/game/region/global rules.
- Category rules override game/region/global rules.
- Game rules override region/global rules.
- Region rules override global rules.
- `stopFurtherProcessing` should stop lower-priority or broader rules only for the relevant dimension. It must not accidentally skip unrelated dimensions such as tax or availability.
- Policy defaults apply when no scoped rule exists.

Rules should not be evaluated directly from arbitrary metadata. Runtime behavior belongs to typed policy and rule fields.

## 3. Promotion Resolution

Promotion resolution is deferred, but the future resolver should follow this contract.

### Eligibility

A promotion is eligible only when all required checks pass:

- promotion status is active for the runtime context
- effective date range is valid
- campaign, if attached, is active and in range
- region and currency match
- package/game/category/tier/payment/user segment conditions match
- coupon requirements are satisfied
- usage limits are available
- inventory and checkout context permit purchase
- refund-restoration rules do not exclude the customer

`PromotionRule.eligibility` is a structural condition tree only. Evaluation belongs to a later runtime sprint.

### Priority

Eligible promotions should be sorted by:

1. exclusivity
2. explicit priority
3. best customer benefit
4. earliest expiry
5. deterministic code ordering

### Exclusive Promotions

An exclusive promotion prevents other promotions from stacking with it. If multiple exclusive promotions are eligible, the future engine should choose the best customer benefit unless a stronger business policy is explicitly defined.

### Stackable Promotions

Stackable promotions may combine only when:

- each promotion explicitly allows stacking
- no exclusive promotion has been selected
- stacking does not violate minimum margin or minimum profit
- stacking does not violate one-promotion-per-order policy

### One Promotion Per Order Policy

Default policy should be one price-affecting promotion per order. Multiple non-price rewards may be allowed later only through typed policy.

### Best Promotion Selection

Best promotion means the lowest final valid customer price after all guards. The resolver must not select a discount that violates margin, inventory, region, coupon, usage, or campaign rules.

## 4. Profit Guard

Profit guard is a publish and calculation safety layer.

### Minimum Margin

Minimum margin compares profit against the final pre-promotion or post-promotion basis defined by policy. The basis must be explicit. A future engine should avoid hidden assumptions.

### Minimum Profit

Minimum profit is an absolute amount in the relevant currency. MMK and THB must be evaluated separately.

### Publish Blocking

Publishing a `PriceVersion` should be blocked when:

- a package falls below minimum profit
- a package falls below minimum margin
- required exchange data is missing
- a rule produces invalid or negative pricing
- rounding produces a value below guard thresholds

### Warning Behavior

Warnings should be generated when:

- margin is close to threshold
- a fallback policy is used
- a broad rule overrides many packages
- two same-priority rules conflict
- a promotion materially reduces profit but remains within allowed guardrails

Warnings do not block by default unless policy says they should.

### Founder Override

Founder override may permit below-margin publishing only when:

- the actor has explicit owner/founder authority
- the override reason is captured
- affected packages are listed
- the override is snapshotted into `PriceVersion`
- checkout/order snapshots preserve the final verified result

Founder override must not be a metadata flag.

## 5. Currency Policy

### MMK

MMK prices should use region-specific rounding suitable for Myanmar storefront expectations. Future policy should define whether prices round to nearest 50, 100, 500, or another increment.

### THB

THB prices should use Thai storefront rounding rules. Future policy should define whether prices round to whole baht, nearest 5/10 baht, or psychological endings.

### Future Currencies

Future currencies require:

- explicit currency enum expansion
- exchange source policy
- rounding rule
- tax/fee policy
- minimum profit amount
- display formatting
- order snapshot support

No implicit fallback currency should be used for calculation.

### Rounding Behavior

Rounding applies after fees and tax and before promotion to define `originalPrice`. If a promotion produces a fractional final amount, policy must explicitly decide whether to round the discount amount, final amount, or both.

## 6. Failure Matrix

| Failure | Expected Future Behavior |
| --- | --- |
| Supplier missing | Use approved fallback supplier cost only if policy permits; otherwise block quote/publish. |
| Supplier offer disabled | Treat package as unavailable unless manual override permits display. |
| Promotion expired | Exclude promotion; do not fail base price calculation. |
| Campaign expired | Exclude campaign-linked promotions and placements. |
| Inventory unavailable | Block checkout quote; storefront may display unavailable state. |
| Pricing rule missing | Fall back to policy defaults; warn if package-specific pricing was expected. |
| Pricing policy missing | Block calculation for affected scope. |
| Exchange unavailable | Block cross-currency calculation; do not use stale exchange unless explicitly versioned and allowed. |
| Fee rule missing | Use policy default if present; otherwise warn or block according to policy. |
| Tax rule missing | Use explicit zero-tax policy only when configured; otherwise warn or block by region. |
| Rounding rule missing | Use `NONE` only when policy explicitly allows it. |
| Promotion conflicts | Choose valid best promotion or block publish if conflict cannot be resolved deterministically. |
| Margin below threshold | Block publish/quote unless founder override is valid. |

## 7. Calculation Input Contract

Future calculation input should include:

- calculation request id
- actor/system context
- user id when authenticated
- package identity: `packageId`, optional `packageCode`, optional `packageRef`
- product/game/category/tier context
- region
- currency
- quantity
- supplier id or supplier offer id when relevant
- supplier cost
- supplier currency
- exchange context and source
- payment method id/key/provider
- pricing policy id
- pricing version id
- candidate pricing rules
- candidate promotion rules
- campaign context
- inventory state
- coupon code when supplied
- timestamp
- preview/live mode

The frontend amount must never be a trusted input.

## 8. Calculation Output Contract

Future calculation output should include:

- calculation id/hash
- package identity
- region
- currency
- quantity
- supplier cost
- business cost
- profit amount
- profit margin
- exchange rate and source
- gateway fee
- platform fee
- tax amount
- rounding adjustment
- original price
- applied promotion id/code
- discount amount
- final price
- inventory readiness
- margin guard result
- warnings
- blocking errors
- policy ids/rule ids used
- pricing version id
- calculation timestamp

Outputs should be deterministic for the same versioned inputs.

## 9. Quote Contract

`PricingQuote` remains future-only.

Expected fields:

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

Lifecycle:

- `CREATED`
- `RESERVED`
- `CONSUMED`
- `EXPIRED`
- `CANCELLED`

Security rules:

- server-generated
- short-lived
- immutable monetary result
- checkout verifies quote ownership and expiry
- quote cannot be reused after consumption
- frontend-submitted amount is never trusted

## 10. Order Snapshot Contract

When checkout eventually consumes a verified quote, the order should freeze:

- quote id
- pricing version id
- package identity
- product/game/package display names
- region
- currency
- quantity
- original price
- final price
- discount amount
- applied promotion snapshot
- applied campaign snapshot
- supplier offer snapshot
- exchange rate and source
- fee/tax/rounding breakdown
- margin guard outcome
- payment method snapshot
- inventory state at quote/order time
- calculation hash
- created timestamp

Order snapshots must preserve historical truth even if catalog, pricing rules, promotions, or payment methods change later.

## 11. Architecture Decisions

### Calculation Belongs Server-Side

All pricing, promotion, fee, tax, rounding, and guard decisions must execute server-side. Frontend display is projection only.

### Typed Configuration Over Metadata

Metadata must not hide business rules. Pricing and promotion behavior must live in typed fields or future typed policy models.

### Versioned Configuration Before Checkout Trust

Checkout should verify against a versioned configuration or short-lived quote. Direct package amount submission is not trusted.

### Currency Separation

MMK and THB must remain separate. Reporting, margin checks, discounts, and snapshots must not sum currencies without explicit FX conversion policy.

### Promotions After Original Price

Promotion resolution occurs after the original customer price is calculated. This preserves clean customer display and discount auditability.

### Inventory Gates Checkout

Inventory availability should gate quote/checkout even if a price can be calculated.

## 12. Worked Examples

These examples are illustrative only and are not executable test vectors.

### MMK Example

Input:

- supplier cost: 8,000 MMK
- business cost: 500 MMK
- profit: 20%
- gateway fee: 2%
- platform fee: 300 MMK
- tax: 0%
- rounding: nearest 100 MMK
- promotion: 5% discount

Example flow:

1. supplier cost: 8,000
2. add business cost: 8,500
3. add profit 20%: 10,200
4. exchange: not required, already MMK
5. add gateway fee 2%: 10,404
6. add platform fee: 10,704
7. tax 0%: 10,704
8. round nearest 100: 10,700 original price
9. promotion 5%: 535 discount
10. final price: 10,165 MMK, subject to final rounding policy

If final-price rounding is configured, the final amount must state whether it rounds to 10,200, 10,100, or remains 10,165.

### THB Example

Input:

- supplier cost: 950 THB
- business cost: 20 THB
- profit: 15%
- gateway fee: 2.5%
- platform fee: 10 THB
- tax: 0%
- rounding: psychological ending 9
- promotion: fixed 50 THB discount

Example flow:

1. supplier cost: 950
2. add business cost: 970
3. add profit 15%: 1,115.50
4. exchange: not required, already THB
5. add gateway fee 2.5%: 1,143.39
6. add platform fee: 1,153.39
7. tax 0%: 1,153.39
8. psychological rounding: 1,159 original price
9. fixed promotion: 50 discount
10. final price: 1,109 THB

The future engine must preserve the full breakdown so support/admin can explain why the final price exists.

## Deferred Items

This sprint does not implement:

- calculation engine
- exchange service
- promotion resolver
- quote model/service
- order snapshot writes
- checkout verification
- admin UI
- storefront UI
- APIs/routes/controllers
- database migrations
- seed scripts
- deployment
