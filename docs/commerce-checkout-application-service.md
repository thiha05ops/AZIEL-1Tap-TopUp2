# AZIEL Commerce Checkout Application Service

Sprint: 2.5.4

Status: Checkout persistence integration

This document describes `backend/services/commerce/checkoutApplicationService.js`, the server-side orchestration layer for converting an owned persisted `PricingQuote` into a persisted `CommerceOrder` plus a customer-safe checkout result.

This sprint does not implement Express routes, controllers, public APIs, legacy `Order` model changes, payment provider calls, wallet debit, promotion redemption persistence, inventory reservation, supplier fulfillment, frontend UI, deployment, commits, or pushes.

## Purpose

The service owns deterministic checkout orchestration:

1. Validate and normalize checkout input.
2. Reject prohibited commercial fields.
3. Load an owned quote.
4. Validate quote state and expiry.
5. Validate operational package state.
6. Validate fulfillment input.
7. Validate payment-method compatibility.
8. Optionally validate promotion redemption-critical constraints.
9. Build an immutable order snapshot.
10. Create a `CommerceOrder` through `orderRepository.createOrderRecord()`.
11. Atomically mark the quote `USED` through `pricingQuoteRepository.markQuoteUsed()`.
12. Return a customer-safe checkout result.

The service does not calculate prices, rerun promotion resolution, trust client totals, call payment providers, create manual payment attempts, debit wallets, fulfill supplier orders, or manipulate legacy order flows.

## Public API

Exports:

- `checkoutFromQuote(input, dependencies?)`
- `getCheckoutResult(input, dependencies?)`
- `toPublicCheckoutResult(orderOrResult, options?)`
- `createOrderSnapshot(args)`
- `CheckoutApplicationError`
- `ERROR_CODES`
- `WARNING_CODES`
- `CHECKOUT_APPLICATION_SERVICE_VERSION`

## Dependency Contract

Runtime dependencies are explicit:

```js
{
  findOwnedQuote,
  findOrderByQuoteId,
  findOrderByCheckoutIdempotency,
  findOrderById,

  validateOperationalPackageState,
  validateFulfilmentInput,
  validatePaymentMethod,
  validatePromotionRedemption,

  createOrderSnapshot,
  createOrderRecord,
  markQuoteUsed,

  transactionRunner,
  getCheckoutTime,
  generateOrderId,
  generateCheckoutId,

  hashCheckoutIdempotencyKey,
  fingerprintCheckoutRequest
}
```

Production defaults now wire the completed persistence repositories:

- `findOwnedQuote`
- `findOwnedOrderById`
- `findOwnedOrderByQuoteId`
- `findOwnedOrderByCheckoutIdempotency`
- `createOrderRecord`
- `markQuoteUsed`
- Mongo session transaction runner
- default pure `createOrderSnapshot`
- default canonical fingerprint builder

The service still requires injected providers for:

- checkout time
- checkout id
- order id
- operational validation
- fulfillment validation
- payment validation

This prevents the service from inventing runtime business facts. Routes/controllers are still out of scope.

## Input Contract

Supported input:

```js
{
  quoteId,
  owner: {
    userId,
    sessionId
  },
  idempotencyKey,
  paymentSelection: {
    paymentMethodId,
    paymentChannel
  },
  customerInput: {
    gameAccount: {
      userId,
      serverId,
      zoneId,
      playerName
    },
    contact: {
      email,
      phone
    },
    notes,
    customFields
  },
  requestMetadata: {
    traceId,
    source,
    ipHash,
    userAgentHash
  }
}
```

At least one owner identity is required. The service never permits quote id-only checkout.

## Prohibited Commercial Input

The service rejects request fields named:

- `amount`
- `total`
- `unitPrice`
- `discount`
- `currency`
- `promotion`
- `exchangeRate`
- `supplierCost`
- `tax`
- `fee`
- `paid`
- `orderStatus`
- `packageSnapshot`

These fields are prohibited anywhere in the checkout request because quote checkout must use persisted server-owned commercial truth.

## Normalization

The service normalizes:

- quote id
- owner ids
- idempotency key
- payment method id
- payment channel
- game account fields
- contact email and phone
- notes
- scalar custom fields
- request metadata

Notes and custom fields are bounded. Nested custom field objects are rejected.

## Orchestration Sequence

`checkoutFromQuote()`:

1. Clones original input for immutability verification.
2. Validates and normalizes input.
3. Gets checkout time from `getCheckoutTime`.
4. Gets checkout id from `generateCheckoutId`.
5. Gets order id from `generateOrderId`.
6. Builds request fingerprint from quote id, owner, payment selection, and normalized fulfillment input.
7. Hashes or uses the checkout idempotency key.
8. Loads quote with `findOwnedQuote`.
9. Checks existing order by quote id.
10. Checks existing order by owner-scoped idempotency.
11. Resolves idempotent retry or conflict.
12. Validates quote status and expiry.
13. Runs operational package validation.
14. Runs fulfillment validation and uses the normalized fulfillment result.
15. Runs payment method validation.
16. Runs optional promotion redemption validation.
17. Creates an immutable order snapshot.
18. Enters `transactionRunner`.
19. Creates the `CommerceOrder` through `createOrderRecord`.
20. Calls `markQuoteUsed` with the same transaction context.
21. Commits only after both persistence operations succeed.
22. Returns customer-safe checkout data.

No payment provider call happens inside or after this service in Sprint 2.5.4.

## Quote Validation

Only `ISSUED` quotes may create a new order.

Rejected states:

- `USED`
- `EXPIRED`
- `INVALIDATED`
- `CANCELLED`

Expiry boundary:

- `checkoutTime >= lifecycle.expiresAt` rejects with `QUOTE_EXPIRED`.

The injected `markQuoteUsed` dependency must still enforce status and expiry atomically.

## Ownership Behaviour

The service uses owner-aware lookup. It does not fall back to quote id-only lookup.

Public checkout failure maps missing or owner-mismatched quotes to ownership-safe unavailable behavior. Internal `causeCode` can preserve the distinction for trusted callers.

User-bound quotes require the matching user id. A session id alone cannot consume a user-bound quote.

## Operational Validation

`validateOperationalPackageState()` receives:

```js
{
  quote,
  checkoutTime,
  owner,
  transactionContext
}
```

It may block disabled packages, disabled games, disabled regions, legal unavailability, maintenance blocks, deletion, and hard supplier outage.

It must not block solely because price, display name, promotion, or exchange rate changed.

## Fulfillment Validation

`validateFulfilmentInput()` receives:

```js
{
  quote,
  customerInput,
  transactionContext
}
```

The service uses only `normalisedFulfilmentInput`, `normalizedFulfilmentInput`, or `fulfilmentInput` returned by the dependency. Browser-provided field definitions are not trusted.

## Payment Validation

`validatePaymentMethod()` receives:

```js
{
  quote,
  paymentSelection,
  owner,
  checkoutTime,
  transactionContext
}
```

It must validate existence, enabled status, customer visibility, region, currency, amount range, flow/channel support, maintenance state, and owner restrictions.

If the quote is payment-method-bound, the selected payment method must match exactly.

Validation may return:

```js
{
  valid: true,
  paymentSnapshot,
  nextAction
}
```

Suggested next actions:

- `OPEN_MANUAL_PAYMENT`
- `CREATE_GATEWAY_PAYMENT`
- `WALLET_PROCESSING`
- `NO_PAYMENT_REQUIRED`
- `NONE`

No provider SDK/API call belongs here.

## Promotion Redemption Boundary

The service does not rerun `resolvePromotion()`.

Optional `validatePromotionRedemption()` may check:

- coupon ownership
- single-use availability
- global usage limit
- per-user usage limit
- first-purchase exclusivity
- campaign budget
- legal/fraud revocation

This sprint does not persist `PromoRedemption`.

## Order Snapshot Handoff

Default `createOrderSnapshot()` copies quote truth into a `CommerceOrder`-ready object:

- quote id
- quote versions
- quote owner
- package snapshot
- commercial snapshot
- pricing snapshot
- promotion snapshot
- lifecycle timestamps
- order id
- checkout id
- checkout timestamp
- normalized fulfillment input
- payment snapshot
- checkout idempotency metadata
- request trace metadata

It does not recalculate commercial values.

The persisted `CommerceOrder` repository consumes this snapshot without recalculating commercial values.

## Transaction Semantics

The transaction runner wraps only:

- order creation
- quote consumption

The same transaction context is passed to `createOrderRecord()` and `markQuoteUsed()`.

If order creation fails, quote remains `ISSUED`.

If quote consumption fails after order creation, the transaction must abort so no order remains committed.

There is no silent non-transactional production fallback.

Quote lookup, idempotency/existing-order lookup, operational validation, fulfillment validation, payment validation, promotion-redemption validation, and snapshot construction happen before the transaction. Repository uniqueness and `markQuoteUsed()` status filters remain the authority for concurrent races.

## Idempotency

Checkout idempotency is separate from quote creation idempotency.

Same owner + same idempotency key + same fingerprint:

- returns existing order
- does not create a new order
- does not consume quote again

Same owner + same idempotency key + different fingerprint:

- rejects with `CHECKOUT_IDEMPOTENCY_CONFLICT`

Same quote + different idempotency key after successful checkout:

- rejects with `ORDER_ALREADY_EXISTS_FOR_QUOTE`

Different owners:

- may reuse the same idempotency key

## Public Result Mapping

Customer-safe checkout result includes:

- order id
- quote id
- order status
- payment status
- game/package/quantity
- currency
- original price
- discount amount
- total amount
- public promotion code/name
- payment method id/channel/next action
- created timestamp
- customer-safe warnings

It excludes:

- supplier cost
- pricing rule internals
- exchange internals
- fee internals
- tax internals
- rejected promotions
- eligibility traces
- quote integrity payload
- raw idempotency fingerprint
- idempotency identity
- raw persisted order object
- transaction internals
- fraud details

## Error Contract

`CheckoutApplicationError` includes:

- `code`
- `message`
- `stage`
- `causeCode`
- `retryable`
- safe `metadata`

Error codes are exported from `ERROR_CODES` and match the Sprint 2.5.0 specification.

The service is not HTTP-specific.

## Warning Contract

Customer-safe warnings:

- `EXISTING_CHECKOUT_REUSED`
- `SESSION_BOUND_ORDER`
- `NO_PROMOTION_APPLIED`
- `ZERO_PRICE_ORDER`
- `PAYMENT_INITIATION_REQUIRED`
- `PAYMENT_METHOD_MAINTENANCE_RISK`
- `PACKAGE_TEMPORARILY_DEGRADED`

Raw lower-layer warnings are not exposed automatically.

## Observability

The returned trusted metadata includes:

- checkout id
- trace id
- quote id
- order id
- owner type
- idempotent reuse flag
- outcome

The core service does not log directly in this sprint.

## Security

The service enforces:

- owner required
- no quote id-only checkout
- client commercial fields rejected
- deterministic injected time/id providers
- server-owned fulfillment validation dependency
- payment method validation dependency
- replay protection through idempotency
- public result redaction
- no supplier cost exposure
- no payment provider secrets
- no raw bank/card credentials
- one Mongo transaction for order creation and quote consumption

## Limitations

Deferred:

- Express route/controller
- public checkout API
- real Order model fields/indexes
- CheckoutAttempt model
- payment provider orchestration
- manual payment attempt creation
- wallet debit branch
- promotion redemption ledger
- inventory reservation
- supplier reservation
- supplier fulfillment
- frontend checkout migration
- admin UI
- migrations
- seeds
- deployment
