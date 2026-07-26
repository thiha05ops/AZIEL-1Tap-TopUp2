# AZIEL Commerce Pricing Quote Runtime

Sprint: 2.4.1

Status: Pure in-memory runtime

This document describes the implemented Pricing Quote runtime. It orchestrates:

Base Pricing Engine

↓

Promotion Resolver

↓

Immutable Pricing Quote Snapshot

It does not implement database persistence, quote lookup, APIs, checkout integration, order creation, payment behavior, UI, HMAC signing, lifecycle transitions, or deployment configuration.

## Public API

`backend/services/commerce/pricingQuoteRuntime.js` exports:

- `createPricingQuote(input)`
- `canonicalSerialize(value)`
- `PricingQuoteRuntimeError`
- `ERROR_CODES`
- `WARNING_CODES`
- `QUOTE_RUNTIME_VERSION`
- `QUOTE_SPECIFICATION_VERSION`
- `DEFAULT_PAYLOAD_VERSION`

`createPricingQuote(input)` is synchronous and side-effect free.

It:

- performs no database access
- performs no network access
- reads no environment variables
- calls no random or clock APIs
- mutates no input objects
- uses no global mutable state
- returns a deeply frozen quote object

## Deterministic Input Requirements

The caller must supply all nondeterministic values:

- `quoteId`
- `issuedAt`
- `expiresAt` or `validitySeconds`
- owner binding
- trace id, if used
- integrity metadata, if used

The runtime never calls `Date.now()`, `new Date()` without supplied input, `Math.random()`, or `crypto.randomUUID()`.

## Quote Snapshot Contract

Returned quote shape:

```js
{
  quoteRuntimeVersion: "2.4.1",
  quoteSpecificationVersion: "2.4.0",
  quoteId,
  status: "ISSUED",
  payloadVersion,
  owner,
  packageSnapshot,
  commercialSnapshot,
  pricingSnapshot,
  promotionSnapshot,
  lifecycle,
  integrityPayload,
  integrityMetadata,
  trace,
  warnings
}
```

The quote starts as `ISSUED`. This runtime does not implement `USED`, `EXPIRED`, `INVALIDATED`, or `CANCELLED` transitions.

## Pricing Orchestration

The runtime calls `calculateBasePrice(pricingInput)` and snapshots:

- input summary
- full calculation result
- breakdown
- warnings
- engine version
- specification version
- supplied price-version metadata

The runtime does not reproduce pricing formulas. It rejects a quote when:

- pricing calculation fails
- pricing result does not succeed
- pricing result currency does not match the quote request currency
- pricing original price is invalid

## Promotion Orchestration

When `promotionInput` is supplied, the runtime calls `resolvePromotion()` with trusted values:

- `originalPrice` from the pricing result
- `currency` from the pricing result
- `evaluationTime` from quote `issuedAt`
- package identity from the quote request
- region from the quote request
- owner id/session context
- coupon code from the quote request
- subtotal from the pricing result

Conflicting `promotionInput.originalPrice`, `promotionInput.currency`, and `promotionInput.context.evaluationTime` are not trusted. The quote issue time is the single promotion evaluation time for this runtime.

When `promotionInput` is omitted:

- `promotionSnapshot` is `null`
- `discountAmount` is `0`
- `quotedUnitPrice` equals the pricing result `originalPrice`

The runtime does not write usage counters, reserve redemptions, or consume promotions.

## Quantity And Total Rules

Quantity defaults to `1`.

Quantity must be a positive integer.

Initial policy:

- base price is treated as a unit price
- promotion applies to the unit price
- `quotedTotalAmount = quotedUnitPrice * quantity`

The runtime does not apply fees, tax, exchange, rounding, or promotion a second time.

Negative and unsafe amounts are rejected. Zero-price quotes are allowed at the pure runtime layer and emit a warning.

## Expiry Handling

`issuedAt` is required.

Either `expiresAt` or `validitySeconds` is required.

If both are supplied, they must agree exactly. Contradictory windows are rejected.

All stored timestamps are normalized to ISO 8601 UTC strings.

The runtime does not determine whether a quote is currently expired. Future service/checkout layers own that comparison.

## Canonical Integrity Payload

The runtime prepares a canonical commercial payload and canonical serialized string.

Included:

- quote id
- owner binding
- package identity
- region
- currency
- original price
- discount
- quoted unit price
- quantity
- quoted total amount
- pricing version metadata
- promotion version and selected promotion identity
- issuedAt
- expiresAt
- payload version

Excluded:

- mutable lifecycle fields such as used/cancelled/invalidated timestamps
- order ids
- retry counters
- updatedAt

The runtime does not create a hash or HMAC signature. `canonicalHash` and `signature` are `null`, and `INTEGRITY_SIGNATURE_NOT_GENERATED` is emitted.

`canonicalSerialize()` uses stable key ordering, omits `undefined`, normalizes dates to ISO strings, normalizes negative zero to zero, rejects functions/symbols/bigints, and rejects circular references.

## Version Metadata

The quote includes:

- quote runtime version: `2.4.1`
- quote specification version: `2.4.0`
- pricing engine version
- pricing specification version
- promotion resolver version when promotions are evaluated
- promotion specification version when promotions are evaluated
- payload version
- supplied price version metadata

Missing price-version metadata is not inferred and emits `NO_PRICE_VERSION_REFERENCE`.

## Errors

Runtime errors are `PricingQuoteRuntimeError` with codes:

- `INVALID_INPUT`
- `INVALID_QUOTE_ID`
- `INVALID_OWNER`
- `INVALID_PACKAGE_IDENTITY`
- `INVALID_ISSUED_AT`
- `INVALID_EXPIRES_AT`
- `INVALID_VALIDITY_DURATION`
- `INVALID_QUOTE_WINDOW`
- `INVALID_QUANTITY`
- `PRICING_CALCULATION_FAILED`
- `PRICING_CURRENCY_MISMATCH`
- `INVALID_PRICING_RESULT`
- `PROMOTION_RESOLUTION_FAILED`
- `PROMOTION_CURRENCY_MISMATCH`
- `INVALID_PROMOTION_RESULT`
- `INVALID_FINAL_AMOUNT`
- `QUOTE_AMOUNT_OVERFLOW`
- `INVALID_INTEGRITY_PAYLOAD`
- `CANONICALISATION_FAILED`

The errors are not Express-specific.

## Warnings

Quote warning codes:

- `NO_PROMOTION_APPLIED`
- `PRICING_WARNINGS_PRESENT`
- `PROMOTION_WARNINGS_PRESENT`
- `ZERO_PRICE_QUOTE`
- `SESSION_BOUND_QUOTE`
- `NO_PRICE_VERSION_REFERENCE`
- `INTEGRITY_SIGNATURE_NOT_GENERATED`

Warnings are informational only in Sprint 2.4.1.

## Immutability

The quote root and nested snapshots are deeply frozen:

- owner
- package snapshot
- commercial snapshot
- pricing snapshot
- promotion snapshot
- breakdown arrays
- warning arrays
- integrity payload
- trace metadata

The quote does not share mutable references with caller input, pricing engine results, or promotion resolver results.

## Known Limitations

Deferred:

- `PricingQuote` model
- persistence
- lookup/read service
- lifecycle transitions
- expiry job
- quote refresh service
- HMAC signing
- key rotation
- checkout validation
- order mapping
- inventory reservation
- promotion reservation/consumption
- API routes
- UI
- payment integration
- Decimal/minor-unit money migration
