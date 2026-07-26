# AZIEL Commerce Calculation Engine

Sprint: 2.2

Status: Pure base-price calculation only

Engine version: `2.2.1`

Specification version: `2.1.2`

This document describes the deterministic calculation engine implemented for Sprint 2.2. The engine does not read the database, call APIs, mutate state, apply promotions, create quotes, write order snapshots, or integrate with checkout.

## Public Function

```js
const { calculateBasePrice } = require("../services/commerce/pricingCalculationEngine");

const result = calculateBasePrice(input);
```

`calculateBasePrice(input)` is synchronous and side-effect-free.

It:

- performs no database access
- performs no network access
- reads no environment variables
- mutates no input objects
- sorts copied rule arrays only
- returns deterministic structured output for identical input
- requires explicit `context.evaluationTime` when pricing rules include effective date windows

## Supported Input

Required:

- `supplierCost`
- `supplierCurrency`
- `targetCurrency`
- `policy.profitRule`

Optional:

- `exchangeRate`
- `policy.supplierFee`
- `policy.businessCost`
- `policy.platformCost`
- `policy.gatewayFee`
- `policy.tax`
- `policy.roundingRule`
- `appliedPricingRules`
- `context`

Supported currencies are currently `MMK` and `THB`.

## Calculation Order

The engine implements base price calculation in this order:

1. Supplier Cost
2. Supplier Fee
3. Business Cost
4. Profit
5. Currency Exchange
6. Gateway Fee
7. Platform Fee
8. Pricing Rule Fees
9. Tax
10. Rounding
11. Optional Price Override

Promotions are not applied in Sprint 2.2, so `regularPrice` and `originalPrice` are equal.

## Percentage Bases

Because Sprint 2.1.2 intentionally avoided hardcoding fee/tax inclusivity rules, Sprint 2.2 uses a conservative compounding interpretation:

- each percentage applies to the current running subtotal at its stage
- fixed amounts are added in the currency active at that stage
- supplier fee, business cost, and profit occur in supplier currency
- gateway fee, platform fee, pricing-rule fee, tax, and rounding occur in target currency

## Pricing Rule Semantics

The caller supplies already-selected candidate rules. The engine does not query `PricingRule` records.

Supported rule types:

- `MARKUP_PERCENT`
- `MARKUP_FIXED`
- `PROFIT_MARGIN_PERCENT`
- `PROFIT_FIXED`
- `FEE_PERCENT`
- `FEE_FIXED`
- `PRICE_OVERRIDE`
- `ROUNDING`

Rules are filtered by date and context, then sorted by:

1. scope specificity: package, tier, category, game, region, global
2. priority descending
3. stable code/id ordering
4. original caller order only as a final tie-breaker when no stable code/id differs

Caller rule arrays are never sorted in place.

Rules with `effectiveFrom` or `effectiveUntil` require `context.evaluationTime` or legacy-compatible `context.now`. The engine does not read wall-clock time internally for dated rules.

`stopFurtherProcessing` stops later rules of the same rule type. It does not stop unrelated calculation dimensions.

`PRICE_OVERRIDE` is an explicit regular-price override. It records the pre-override price, emits `PRICE_OVERRIDE_APPLIED`, and may emit below-cost warnings. It does not enforce profit-guard blocking.

Equal-precedence price overrides fail with `CONFLICTING_PRICE_OVERRIDES`.

## Exchange Handling

If `supplierCurrency` equals `targetCurrency`, no exchange rate is required.

If currencies differ:

- a positive finite `exchangeRate.rate` is required
- `exchangeRate.sourceCurrency` must match `supplierCurrency`
- `exchangeRate.targetCurrency` must match `targetCurrency`
- inverse rates are not inferred
- rates are not fetched or cached

The result preserves exchange metadata.

## Precision Strategy

The engine follows the repository convention of ordinary JavaScript `Number` values.

To reduce uncontrolled drift:

- every stage validates finite numeric values
- intermediate arithmetic is normalized to six decimal places
- final currency rounding happens only when an explicit rounding rule is supplied
- negative zero is normalized to zero
- increment rounding uses normalized quotients to avoid accidental upward rounding on values already aligned to fractional increments

Known limitation: this is not a Decimal128 or integer-minor-unit engine. A future platform-wide monetary precision migration may still be needed before high-volume financial workloads.

## Rounding Behavior

Supported modes:

- `NONE`
- `NEAREST`
- `UP`
- `DOWN`
- `PSYCHOLOGICAL`

`NEAREST`, `UP`, and `DOWN` require a positive `increment`.

`PSYCHOLOGICAL` uses the configured `psychologicalEnding` and never returns a negative price. It rounds upward when needed so the resulting display price does not fall below the pre-rounding amount.

No default MMK or THB rounding increment is invented by the engine.

## Output Contract

The result includes:

- `success`
- `engineVersion`
- `specificationVersion`
- `currency`
- `supplierCurrency`
- `supplierCost`
- `supplierFeeAmount`
- `businessCostAmount`
- `costBeforeProfit`
- `profitAmount`
- `preExchangeSubtotal`
- `exchangeRateApplied`
- `exchangeRateMetadata`
- `postExchangeSubtotal`
- `gatewayFeeAmount`
- `platformFeeAmount`
- `pricingRuleFeeAmount`
- `taxAmount`
- `preRoundingPrice`
- `regularPrice`
- `originalPrice`
- `preOverridePrice`
- `totalCost`
- `calculatedProfitAmount`
- `calculatedMarginPercent`
- `appliedRules`
- `warnings`
- `breakdown`

Every breakdown entry includes:

- `stageId`: stable machine-readable identifier
- `stage`: debug-compatible stage value
- `label`: human-readable label
- `inputAmount`
- `amountAdded`
- `outputAmount`
- `currency`

Stable stage identifiers:

- `SUPPLIER_COST`
- `SUPPLIER_FEE`
- `BUSINESS_COST`
- `PROFIT`
- `EXCHANGE`
- `GATEWAY_FEE`
- `PLATFORM_FEE`
- `PRICING_RULE_FEE`
- `TAX`
- `ROUNDING`
- `PRICE_OVERRIDE`

## Error Codes

- `INVALID_INPUT`
- `INVALID_SUPPLIER_COST`
- `INVALID_MONETARY_RULE`
- `INVALID_RULE_VALUE`
- `INVALID_EXCHANGE_RATE`
- `EXCHANGE_PAIR_MISMATCH`
- `UNSUPPORTED_CURRENCY`
- `INVALID_ROUNDING_RULE`
- `CONFLICTING_PRICE_OVERRIDES`
- `CALCULATION_OVERFLOW`

Errors are represented by `CommerceCalculationError` and are not Express-specific.

## Warning Codes

- `NEGATIVE_EFFECTIVE_PROFIT`
- `ZERO_MARGIN`
- `PRICE_BELOW_COST`
- `STALE_EXCHANGE_RATE_METADATA`
- `PRICE_OVERRIDE_APPLIED`
- `ROUNDING_REDUCED_MARGIN`
- `UNUSED_PRICING_RULE`

Warnings are informational only in Sprint 2.2.

## Explicitly Deferred

- promotion eligibility evaluation
- best-promotion resolver
- campaign activation
- welcome discount runtime
- coupon redemption
- profit-guard blocking
- founder override workflow
- inventory availability runtime
- supplier API integration
- `PricingQuote`
- quote reservation
- checkout
- orders
- order snapshots
- wallet
- payments
- APIs/routes/controllers
- admin UI
- storefront UI
- database migrations
- seed scripts
- deployment
