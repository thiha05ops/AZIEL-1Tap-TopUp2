# AZIEL Commerce Order Snapshot Runtime

Sprint: 2.5.2

Status: Runtime-only snapshot foundation

This document describes `backend/services/commerce/orderSnapshotRuntime.js`, the pure runtime that converts a validated persisted `PricingQuote` and trusted checkout context into an immutable internal order commercial snapshot.

This sprint does not implement Order model changes, repositories, MongoDB writes, checkout routes/controllers, payment-provider calls, wallet debit, promotion redemption persistence, inventory reservation, supplier fulfillment, frontend UI, deployment, commits, or pushes.

## Purpose

The runtime owns one narrow responsibility:

Pricing Quote commercial truth

↓

Trusted checkout context

↓

Immutable order snapshot

It does not own checkout orchestration, quote lookup, quote consumption, idempotency lookup, transaction execution, payment initiation, wallet debit, promotion redemption writes, supplier fulfillment, or public response mapping.

## Public API

Exports:

- `createOrderSnapshot(input)`
- `validateOrderSnapshotInput(input)`
- `toOrderSnapshotPayload(snapshot)`
- `ORDER_SNAPSHOT_RUNTIME_VERSION`
- `ORDER_SNAPSHOT_SPECIFICATION_VERSION`
- `ORDER_SNAPSHOT_SCHEMA_VERSION`
- `OrderSnapshotRuntimeError`
- `ORDER_SNAPSHOT_ERROR_CODES`

The runtime is synchronous, deterministic, side-effect free, independent of Express, independent of Mongoose, independent of payment SDKs, independent of the system clock, and independent of random ID generation.

## Input Contract

`createOrderSnapshot()` accepts trusted, already validated operational input:

```js
{
  orderId,
  checkoutId,
  checkoutTime,
  quote,
  owner,
  idempotencyKey,
  requestFingerprint,
  paymentSnapshot,
  fulfilmentInput,
  contact,
  notes,
  requestMetadata,
  policy,
  promotionRedemptionSnapshot
}
```

The runtime still structurally validates all inputs so malformed snapshots cannot be produced.

## Prohibited Overrides

The runtime rejects commercial override fields at unexpected input locations:

- `amount`
- `total`
- `totalAmount`
- `currency`
- `quantity`
- `unitPrice`
- `originalUnitPrice`
- `quotedUnitPrice`
- `discount`
- `discountAmount`
- `promotion`
- `pricing`
- `packageSnapshot`
- `exchangeRate`
- `fee`
- `tax`
- `supplierCost`
- `costPrice`
- `salePrice`

Payment metadata and fulfilment custom fields are also checked for commercial overrides and unsafe credential-like fields.

Commercial fields must come only from the persisted quote.

## Quote Requirements

Required quote sections:

- `quoteId`
- `owner`
- `packageSnapshot`
- `commercialSnapshot`
- `pricingSnapshot`
- `promotionSnapshot`, nullable
- quote runtime/specification/payload versions
- `lifecycle.issuedAt`
- `lifecycle.expiresAt`
- safe integrity metadata when present

The runtime does not rerun pricing, rerun promotion resolution, derive discounts, derive exchange rates, apply rounding, apply tax, apply fees, inspect current package pricing, or mutate quote lifecycle status.

## Canonical Output Shape

The snapshot uses:

```js
{
  schemaVersion,
  runtimeVersion,
  specificationVersion,
  orderId,
  quoteId,
  checkoutId,
  commerce,
  owner,
  product,
  fulfilment,
  customer,
  commercial,
  pricing,
  promotion,
  payment,
  checkout,
  quoteMetadata,
  status,
  paymentStatus,
  checkoutIdempotencyKeyHash,
  checkoutFingerprint,
  checkedOutAt,
  createdAt,
  updatedAt,
  quoteSnapshot
}
```

Compatibility aliases are currently included for the Sprint 2.5.1 checkout service:

- `packageSnapshot`
- `commercialSnapshot`
- `promotionSnapshot`

These aliases preserve existing public mapper behavior until the future Order model/repository sprint defines the final persisted shape.

## Owner Binding

Rules:

- User-bound quote must match supplied `userId`.
- Session-bound quote must match supplied `sessionId`.
- User-bound quote cannot become a session order.
- Session-bound quote cannot silently transfer to a user.
- Missing quote ownership fails.
- Quote records with both user and session are treated as user-bound, with session as an optional defensive match when supplied.

The snapshot owner is copied from the quote owner, not reconstructed from arbitrary caller input.

## Commercial Source Of Truth

Commercial values are copied exactly:

- order currency equals quote currency
- order quantity equals quote quantity
- original unit price equals quote original price
- discount amount equals quote discount amount
- quoted unit price equals quote quoted unit price
- total amount equals quote quoted total amount
- product identity/display fields equal quote package snapshot
- promotion equals selected quote promotion snapshot or `null`

The runtime validates finite non-negative numbers and quantity structure, but it does not recompute totals.

## Money Representation

The runtime preserves the quote’s existing numeric money representation.

It does not:

- convert minor units
- convert major units
- round again
- change decimal precision
- convert currency
- stringify numeric quote values

If `commercialSnapshot.totalAmount` and `commercialSnapshot.quotedTotalAmount` both exist and conflict, the runtime rejects with `AMBIGUOUS_MONEY_REPRESENTATION`.

## Package Mapping

Copied from `quote.packageSnapshot`:

- game id/code/name
- package id/code/ref/name/type
- category id/code/display category
- quantity
- fulfilment schema version when present

The runtime never loads the current package and never replaces historical names with current catalog names.

## Pricing Mapping

The runtime preserves available pricing audit metadata:

- calculation version
- price version id/number
- branch key
- pricing rule snapshot
- exchange snapshot
- fee snapshot
- tax snapshot
- rounding snapshot

Public redaction remains the responsibility of `toPublicCheckoutResult()`.

## Promotion Mapping

Only the selected promotion is mapped to the order snapshot:

- promotion id
- code
- name
- promotion type
- benefit snapshot
- campaign id
- eligibility version
- discount amount

When no promotion is selected, `promotion` is `null`.

Rejected promotions, internal scoring, full eligibility traces, and mutable redemption state are not included.

## Payment Mapping

Payment snapshot is operational input, not commercial authority.

Required:

- `paymentMethodId`

Allowed:

- payment channel
- provider
- flow type
- next action
- payment-method-bound flag
- safe metadata

Rejected:

- provider secrets
- raw card data
- bank credentials
- tokens
- signed provider payloads
- amount/currency overrides
- paid status for positive-value orders

## Fulfillment Mapping

Fulfillment input is copied from server-normalized checkout validation output:

- game user id
- server id
- zone id
- player name
- scalar custom fields

The runtime does not trust or process browser field definitions.

## Initial State Policy

Positive paid-later default:

- order status: `pending_payment`
- payment status: `unpaid`
- fulfilment status: `not_started`

Zero-price default when explicitly allowed:

- order status: `paid`
- payment status: `waived`
- fulfilment status: `not_started`
- next action: `NO_PAYMENT_REQUIRED`

Zero-price orders require `policy.zeroPriceAllowed === true`.

Wallet orders cannot claim paid without a future specialized wallet completion policy.

## Timestamp Policy

Only supplied `checkoutTime` is used.

The same canonical timestamp is copied to:

- `checkout.checkedOutAt`
- `checkedOutAt`
- `createdAt`
- `updatedAt`

The runtime does not call the system clock and does not alter quote issued/expiry timestamps.

## Determinism

For structurally equivalent input, the runtime produces structurally equivalent output.

It does not depend on:

- database state
- environment variables
- locale formatting
- current time
- random values
- external services

## Immutability

The runtime deep-clones trusted inputs into the snapshot and deep-freezes the complete result.

The result does not share mutable nested references with:

- quote
- payment snapshot
- fulfillment input
- contact
- request metadata
- policy

The runtime does not mutate input objects.

## Error Contract

`OrderSnapshotRuntimeError` includes:

- `code`
- `message`
- `stage`
- `causeCode`
- safe `metadata`

Error codes are exported as `ORDER_SNAPSHOT_ERROR_CODES`.

The runtime is not HTTP-specific.

## Checkout Service Integration

`backend/services/commerce/checkoutApplicationService.js` keeps its public `createOrderSnapshot()` export but delegates the default implementation to `orderSnapshotRuntime.createOrderSnapshot()`.

Checkout service remains responsible for:

- quote lookup
- quote status and expiry checks
- operational validation
- fulfillment validation
- payment validation
- promotion redemption validation
- idempotency resolution
- transaction execution
- order persistence handoff
- quote consumption
- public response mapping

The snapshot runtime remains responsible only for immutable snapshot construction.

## Persistence Expectations

Future persistence should store the canonical snapshot shape or an intentionally versioned adapter form.

Future Order model additions may include:

- `quoteId`
- `quoteSnapshot`
- `checkoutId`
- `checkoutIdempotencyKeyHash`
- `checkoutFingerprint`
- commerce/source/version metadata
- structured commercial snapshot
- structured product snapshot
- structured payment snapshot

Legacy orders without quote ids remain valid and should not be backfilled with fake quote snapshots.

## Security And Redaction Boundary

The internal snapshot can preserve safe audit metadata, but public responses must still redact:

- supplier cost
- pricing rules
- exchange internals
- fee internals
- tax internals
- quote integrity payload
- request fingerprint
- idempotency key
- internal payment metadata
- raw request metadata
- eligibility details

Public redaction remains in `checkoutApplicationService.toPublicCheckoutResult()`.

## Limitations

Deferred:

- Order model changes
- Order repository
- checkout persistence integration
- Express route/controller
- public API
- payment-provider calls
- manual payment attempt creation
- wallet debit
- promotion redemption writes
- inventory reservation
- supplier reservation
- supplier fulfillment
- frontend checkout
- admin UI
- migrations
- seeds
- deployment

