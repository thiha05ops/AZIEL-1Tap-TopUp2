# AZIEL Commerce Checkout From Quote Specification

Sprint: 2.5.0

Status: Architecture specification only

This document defines the future server-side checkout flow that consumes a persisted `PricingQuote` and creates an order. It is documentation only. It does not implement runtime code, APIs, controllers, routes, models, checkout UI, payment behavior, wallet behavior, promotion redemption writes, inventory reservation, migrations, seed data, commits, pushes, or deployment.

## First-Audit Summary

Reviewed foundations:

- `docs/commerce-calculation-specification.md`
- `docs/commerce-calculation-engine.md`
- `docs/commerce-promotion-resolver-specification.md`
- `docs/commerce-promotion-resolver.md`
- `docs/commerce-pricing-quote-specification.md`
- `docs/commerce-pricing-quote-runtime.md`
- `docs/commerce-pricing-quote-persistence.md`
- `docs/commerce-pricing-quote-application-service.md`
- `docs/commerce-architecture-decisions.md`
- `backend/models/PricingQuote.js`
- `backend/services/commerce/pricingQuoteRepository.js`
- `backend/services/commerce/pricingQuoteApplicationService.js`
- `backend/models/Order.js`
- `backend/models/ManualPaymentAttempt.js`
- `backend/models/PromoRedemption.js`
- `backend/routes/order.js`
- `backend/routes/payment.js`
- `backend/routes/wallet.js`
- `backend/services/catalogService.js`
- `backend/services/promoCodeService.js`

Current implementation findings:

- `PricingQuote` persistence exists and already supports immutable commercial snapshots, owner-scoped lookup, terminal lifecycle states, expiry, idempotent create, transaction-compatible repository methods, and atomic `ISSUED -> USED` consumption.
- `pricingQuoteApplicationService` creates and retrieves owned customer-safe quotes, but no checkout consumer exists yet.
- Existing direct order creation in `backend/routes/order.js` still resolves package price at request time and accepts compatibility request fields such as package identity and payment method.
- Existing manual payment flow in `backend/routes/payment.js` creates `ManualPaymentAttempt` before order creation. Receipt upload later creates the `Order` and consumes the attempt, already using a Mongo transaction for the attempt-to-order boundary.
- Existing gateway flow in `backend/routes/payment.js` creates an `Order` and then creates a provider charge. This gives useful sequencing precedent: durable order first, provider call second.
- Existing wallet order flow in `backend/routes/wallet.js` creates an `Order` from already validated wallet balance and package pricing facts.
- `Order` already snapshots package, amount, currency, region, payment, promotion, customer, and manual QR fields, but it has no quote ownership contract yet.
- Current promo handling has legacy amount and redemption behavior. Future quote checkout must separate quote-time promotion eligibility from checkout-time redemption-critical checks.

## Purpose

Checkout From Quote converts one server-issued commercial quote into one order and the next payment step.

The quote is the commercial source of truth. Checkout must not recalculate price and must not trust browser totals.

Canonical future pipeline:

Authenticated customer or bound session

↓

Checkout request

↓

Load owned quote

↓

Validate quote

↓

Validate operational conditions

↓

Build order snapshot

↓

Create order

↓

Consume quote atomically

↓

Return order and payment next step

## Trust Boundary

Server-owned:

- authenticated user id
- authenticated session id
- quote ownership
- quote lifecycle status
- quote expiry comparison time
- package availability revalidation
- payment method availability
- promotion redemption counters
- order id generation
- order status
- payment status
- order monetary snapshot
- quote consumption
- idempotency outcome

Customer-provided:

- `quoteId`
- checkout idempotency key
- selected payment method when not quote-bound
- fulfillment input such as game user id, zone id, server id, account id, note, or region-specific fields
- customer-facing receipt upload in later manual payment steps

Request metadata:

- request id
- IP hash or trusted proxy metadata
- user-agent summary
- device/session id
- locale
- source page
- trace id

Prohibited checkout authority:

- final amount
- original amount
- discount amount
- supplier cost
- exchange rate
- fees
- tax
- rounding
- promotion eligibility proof
- promotion discount
- price version
- quote timestamps
- quote owner
- order id supplied as authority

Browser totals may be accepted only as non-authoritative diagnostics while legacy UI migrates. Any mismatch with the quote must not change the order amount.

## Checkout Input Contract

Future checkout request:

```js
{
  quoteId: "AZQ_...",
  checkoutIdempotencyKey: "client-generated-retry-key",
  paymentSelection: {
    methodKey: "promptpay",
    flow: "manual",
    region: "TH",
    currency: "THB"
  },
  fulfillmentInput: {
    userId: "game-user-id",
    zoneId: "zone-or-server",
    note: "optional customer note"
  },
  metadata: {
    locale: "en",
    source: "game-checkout"
  }
}
```

Validation:

- `quoteId` must be a bounded public quote identifier.
- `checkoutIdempotencyKey` must be non-empty, bounded, and owner-scoped.
- `paymentSelection` must include a valid customer-visible method when payment is required.
- `fulfillmentInput` must pass server-owned schema for the quoted package/game.
- `metadata` is diagnostic only and cannot affect commercial facts.

`quoteId` alone is forbidden. Every quote read and consume must include the authenticated owner or a valid bound session owner.

## Ownership Policy

Authenticated quotes:

- Must be consumed only by the same `owner.userId`.
- Session id may be used as additional defense but must not replace user ownership.
- A quote bound to user A cannot be consumed by user B, even if the browser has the quote id.

Session-bound quotes:

- Must be consumed only by the same server-owned session id.
- A session-bound quote cannot be consumed after login as a user unless a future explicit session-to-user claim policy exists.

Deferred handoff:

- Session-to-user quote claiming is deferred.
- The future handoff must verify the session owner, authenticated user, quote status, expiry, and immutable commercial payload before rebinding.
- No automatic anonymous-to-user quote consumption is allowed in this specification.

## Quote Validation

Eligible:

- status is `ISSUED`
- `lifecycle.status` is `ISSUED`
- owner matches
- `checkoutTime < lifecycle.expiresAt`
- quote integrity metadata verifies when signing is implemented
- quote payload version is supported
- quote currency and region are supported

Terminal states:

- `USED`
- `EXPIRED`
- `INVALIDATED`
- `CANCELLED`

Boundary rule:

- A quote is expired when `checkoutTime >= lifecycle.expiresAt`.
- The final atomic consume condition must include `lifecycle.expiresAt > checkoutTime`.

Idempotent used behavior:

- `USED` with the same `consumedOrderId` and same checkout idempotency fingerprint may return the existing order safely.
- `USED` with a different order association must reject as a conflict.

Unsupported quote versions:

- Must reject with a stable error.
- Must not silently reinterpret old commercial snapshots.

## Operational Revalidation

Checkout does not recalculate price, promotion discount, fee, tax, exchange, or rounding. It does revalidate operational facts that can make fulfillment or payment unsafe.

Required package checks:

- package still exists or the quote snapshot has a supported legacy fulfillment adapter
- package is still purchasable for the quoted region
- package is not disabled, blocked, or removed from customer purchase
- package quantity from the quote remains supported
- package fulfillment input schema remains compatible
- supplier/fulfillment route is not in a hard stop state when required

Required region/currency checks:

- quote region remains supported
- quote currency remains supported
- payment method supports quote region and currency
- MMK and THB remain separate

Customer account input checks:

- required identifiers are present
- values are normalized and bounded
- values match the game/product schema
- forbidden fields are rejected
- input is safe for order snapshot display and fulfillment handoff

Operational revalidation must never mutate the quote amount.

## Price Lock Policy

The persisted quote commercial snapshot is the locked price.

Checkout must use exactly:

- `commercialSnapshot.originalPrice`
- `commercialSnapshot.discountAmount`
- `commercialSnapshot.unitPrice`
- `commercialSnapshot.totalAmount`
- `commercialSnapshot.currency`
- quote quantity
- quote promotion snapshot
- quote price version lineage

Checkout must not rerun:

- base pricing
- supplier cost lookup
- exchange calculation
- fee calculation
- tax calculation
- rounding
- promotion resolver

Admin price changes after quote issuance do not affect a valid quote unless the quote is explicitly invalidated by a future policy or admin/system operation.

If the storefront needs a new amount, it must request a new quote.

## Promotion Policy

Quote time:

- Promotion resolver determines eligibility, winner, discount, original price, and final price.
- The selected promotion and rejected/warning context are snapshotted.

Checkout time:

- Do not rerun the resolver.
- Revalidate only redemption-critical constraints:
  - coupon ownership
  - customer identity
  - total usage availability
  - per-user usage availability
  - campaign budget availability
  - legal/fraud revocation
  - hard invalidation of the promotion or campaign

Redemption reservation:

- A future redemption ledger should reserve or consume promotion usage inside the same checkout transaction when the promotion affects price.
- If redemption cannot be reserved, checkout must reject without consuming the quote or creating an order.

One promotion per order:

- Initial checkout should preserve the quote's single winning price-affecting promotion.
- Stacked or bonus promotions may be snapshotted only when the quote runtime explicitly supports them.

## Payment Method Policy

Payment selection must be validated against current operational payment facts.

Checks:

- method exists
- method is enabled
- method is customer-visible
- method supports the quote region
- method supports the quote currency
- method supports the order amount
- method supports the requested flow
- method supports authenticated customer type
- method is not in maintenance
- receipt upload requirements are compatible with the payment flow

Payment method and pricing:

- If a pricing rule depends on payment method, the quote must bind `paymentMethodId`.
- Checkout must require the selected payment method to match the quote-bound method.
- If the customer chooses a different method, checkout must reject and require a new quote.

Manual payment:

- Manual PromptPay and manual bank flows remain `pending_payment`.
- Manual receipt upload remains required where configured.
- Manual admin verification remains the confirmation authority.

Gateway payment:

- Provider charge/payment intent creation happens only after order creation and quote consumption commit.
- Provider failure after commit leaves an order in a recoverable unpaid/payment-pending state.

Wallet:

- Wallet checkout is a future specialized branch.
- It must validate balance and debit atomically with order creation and quote consumption.

## Order Snapshot Contract

Order created from a quote must freeze:

- `quoteId`
- quote payload/specification/runtime versions
- quote price version lineage
- order id
- customer user id
- customer username and email snapshot where available
- package identity
- package display name
- product/game identity
- region
- currency
- quantity
- original amount
- discount amount
- final amount
- promotion id/code/name/type/discount snapshot
- payment method key
- payment method display name
- payment flow
- customer fulfillment input
- quote issued and expiry timestamps
- checkout idempotency key or fingerprint reference
- trace id

The order snapshot must be sufficient to audit why the customer paid that amount even after catalog, pricing, promotion, or payment configuration changes.

Do not expose supplier cost, internal pricing diagnostics, or integrity secrets in public order responses.

## Order Identity And Indexing

Order identity:

- Order id is server-generated.
- Public order id must be unique and non-guessable enough for the existing order-tracking policy.
- Browser-supplied order id must not be trusted as the canonical order id in quote checkout.

Quote association:

- Orders created from quotes should have a unique non-null `quoteId` association.
- Avoid a globally unique nullable `quoteId` field that could collide on multiple legacy orders without quotes.
- Use a partial unique index only for documents where `quoteId` exists and is non-empty.

Checkout idempotency:

- Store owner-scoped checkout idempotency information separately from quote creation idempotency.
- Do not reuse quote creation idempotency keys for checkout.

## Idempotency Contract

Checkout idempotency key scope:

- owner user id or session id
- quote id
- normalized payment selection
- normalized fulfillment input

Fingerprint includes:

- `quoteId`
- owner
- payment method key
- payment flow
- fulfillment input canonical form

Fingerprint excludes:

- request id
- trace id
- user agent
- IP metadata
- locale

Outcomes:

- Same owner + same key + same fingerprint returns the existing order/payment next step.
- Same owner + same key + different fingerprint rejects with `CHECKOUT_IDEMPOTENCY_CONFLICT`.
- Different owners may reuse the same key.
- Replaying after a provider call failure should return the durable order and current payment recovery step when possible.

## Transaction Boundary

Preferred production target is one atomic business operation for order creation and quote consumption.

Within one Mongo transaction:

1. Load owned quote with session.
2. Validate quote status and expiry using server time.
3. Validate package operational facts.
4. Validate payment method operational facts.
5. Validate fulfillment input.
6. Check checkout idempotency record.
7. Reserve or consume promotion redemption if applicable.
8. Create order snapshot.
9. Atomically transition quote `ISSUED -> USED` with `consumedOrderId` and `usedAt`.
10. Store checkout idempotency association.
11. Commit.

After commit:

- start manual payment attempt continuation, or
- create provider payment intent/charge, or
- return wallet debit result in a future wallet-specific transaction design.

Forbidden outcomes:

- `USED` quote without an order.
- Active order with an unconsumed quote.
- Two orders from one quote.
- Payment provider call before durable order/quote commit for quote checkout.

If Mongo transactions are unavailable in a future environment, quote checkout must not silently downgrade to unsafe behavior. It must either use a documented compensating lock strategy with equivalent invariants or fail readiness.

## Concurrency Policy

Same quote consumed simultaneously:

- One transaction wins and creates the order.
- Loser observes quote `USED` with same order only if it is the same idempotent request.
- Loser with different request rejects with `QUOTE_ALREADY_USED` or `ORDER_ALREADY_EXISTS_FOR_QUOTE`.

Same checkout idempotency key simultaneously:

- One request owns the key.
- Same fingerprint returns the same order.
- Different fingerprint rejects.

Quote expires during checkout:

- If `checkoutTime >= expiresAt` before final consume, reject.
- The final consume condition must include `expiresAt > checkoutTime`.

Payment provider failure after commit:

- Do not roll back order/quote commit.
- Return a recoverable payment next step or payment initialization failure state.
- Preserve idempotent retry.

Promotion redemption contention:

- If quota is exhausted before reservation, reject without order or quote consumption.
- If reservation succeeds, snapshot reservation id on order.

## Payment Next Step Contract

Checkout response should return customer-safe order and next payment instruction:

```js
{
  order: {
    orderId,
    status,
    paymentStatus,
    amount,
    currency,
    region,
    packageName,
    gameName
  },
  paymentNextStep: {
    type: "manual_promptpay_qr",
    methodKey: "promptpay",
    displayName: "PromptPay",
    status: "pending_payment",
    instructions: {},
    recovery: {}
  }
}
```

Allowed next-step types:

- `manual_promptpay_qr`
- `manual_bank_transfer`
- `gateway_payment_intent`
- `wallet_debit`
- `payment_waived`

No payment next step may expose credentials, raw provider secrets, internal quote integrity payloads, or supplier cost.

## Zero-Price Policy

Zero-price checkout is allowed only when all conditions hold:

- quote explicitly permits zero price
- final quote amount is exactly zero
- payment is waived by server policy
- promotion or policy reason is snapshotted
- quote is consumed atomically
- order is created atomically
- promotion redemption is recorded when applicable
- fraud controls and per-user limits are enforced

Zero price must not be inferred from client amount, frontend discount, missing payment method, or failed payment method selection.

Recommended status:

- order status: `paid` or a future explicit `payment_waived` lifecycle depending on existing state-machine compatibility
- payment status: `waived` or compatible explicit field
- fulfillment status: unchanged from normal paid order readiness rules

## Order Status Policy

Standard payment-required checkout:

- order status starts as `pending_payment` or existing compatible unpaid state.
- payment status starts as `pending` or `unpaid`.
- fulfillment must not begin until payment is confirmed according to existing state-machine policy.

Manual payment:

- upload/verification controls the transition.
- quote checkout does not auto-mark paid.

Gateway payment:

- provider confirmation/webhook controls the transition.
- payment intent creation is not payment success.

Wallet:

- future wallet branch may mark paid only when debit and order are atomically committed.

Do not conflate:

- commercial quote status
- order lifecycle status
- payment status
- fulfillment status

## Failure Matrix

| Condition | Behavior | Error Code |
| --- | --- | --- |
| Invalid body shape | Reject before lookup | `INVALID_CHECKOUT_INPUT` |
| Missing owner | Reject | `INVALID_OWNER` |
| Invalid quote id | Reject | `INVALID_QUOTE_ID` |
| Invalid idempotency key | Reject | `INVALID_CHECKOUT_IDEMPOTENCY_KEY` |
| Quote not found | Reject | `QUOTE_NOT_FOUND` |
| Quote owner mismatch | Reject | `QUOTE_OWNERSHIP_MISMATCH` |
| Quote status not `ISSUED` | Reject by terminal state | `QUOTE_NOT_AVAILABLE` |
| Quote expired at boundary | Reject | `QUOTE_EXPIRED` |
| Quote already used for same request | Return existing order | none or idempotent metadata |
| Quote already used for another order | Reject | `QUOTE_ALREADY_USED` |
| Quote invalidated | Reject | `QUOTE_INVALIDATED` |
| Quote cancelled | Reject | `QUOTE_CANCELLED` |
| Package disabled or removed | Reject | `PACKAGE_UNAVAILABLE` |
| Region no longer supported | Reject | `REGION_UNAVAILABLE` |
| Currency mismatch | Reject | `CURRENCY_MISMATCH` |
| Payment required but missing | Reject | `PAYMENT_METHOD_REQUIRED` |
| Payment method disabled/hidden | Reject | `PAYMENT_METHOD_UNAVAILABLE` |
| Payment method incompatible | Reject | `PAYMENT_METHOD_INCOMPATIBLE` |
| Fulfillment input invalid | Reject | `INVALID_FULFILMENT_INPUT` |
| Promotion quota unavailable | Reject | `PROMOTION_REDEMPTION_UNAVAILABLE` |
| Same idempotency key, different request | Reject | `CHECKOUT_IDEMPOTENCY_CONFLICT` |
| Existing order for quote conflict | Reject | `ORDER_ALREADY_EXISTS_FOR_QUOTE` |
| Order create fails before quote used | Abort transaction | `ORDER_CREATION_FAILED` |
| Quote consume fails after order insert in transaction | Abort transaction | `QUOTE_CONSUMPTION_FAILED` |
| Write conflict | Retry bounded or reject | `CHECKOUT_TRANSACTION_CONFLICT` |
| Transaction fails | Reject safely | `CHECKOUT_TRANSACTION_FAILED` |
| Provider call after commit fails | Return recoverable state | `CHECKOUT_ORCHESTRATION_FAILED` |

Canonical checkout error codes:

- `INVALID_CHECKOUT_INPUT`
- `INVALID_OWNER`
- `INVALID_QUOTE_ID`
- `INVALID_CHECKOUT_IDEMPOTENCY_KEY`
- `QUOTE_NOT_AVAILABLE`
- `QUOTE_NOT_FOUND`
- `QUOTE_OWNERSHIP_MISMATCH`
- `QUOTE_EXPIRED`
- `QUOTE_ALREADY_USED`
- `QUOTE_INVALIDATED`
- `QUOTE_CANCELLED`
- `PACKAGE_UNAVAILABLE`
- `REGION_UNAVAILABLE`
- `CURRENCY_MISMATCH`
- `PAYMENT_METHOD_REQUIRED`
- `PAYMENT_METHOD_UNAVAILABLE`
- `PAYMENT_METHOD_INCOMPATIBLE`
- `INVALID_FULFILMENT_INPUT`
- `PROMOTION_REDEMPTION_UNAVAILABLE`
- `CHECKOUT_IDEMPOTENCY_CONFLICT`
- `ORDER_ALREADY_EXISTS_FOR_QUOTE`
- `ORDER_CREATION_FAILED`
- `QUOTE_CONSUMPTION_FAILED`
- `CHECKOUT_TRANSACTION_CONFLICT`
- `CHECKOUT_TRANSACTION_FAILED`
- `CHECKOUT_ORCHESTRATION_FAILED`

Customer messages must be safe and non-sensitive. Internal details belong in logs and audit traces.

## Retry And Recovery

Customer retry:

- Same idempotency key and same fingerprint should return the same durable order/payment next step.
- New idempotency key for an already used quote must not create a second order.
- Expired quote requires quote refresh and explicit customer acceptance.

Manual payment recovery:

- Existing pending manual payment recovery remains the recovery owner after order/payment attempt creation.
- Quote checkout should include enough metadata for recovery to return the same order or attempt.

Provider payment retry:

- If provider charge creation fails after commit, retry should not recreate the order or consume the quote again.
- Retry should reuse the durable order and create/recover payment intent according to provider idempotency rules.

No automatic retry should create a new order from the same quote.

## Security Requirements

- Never trust browser amounts.
- Never expose supplier cost or pricing internals in checkout response.
- Bind quote consumption to authenticated owner or valid session owner.
- Reject quote id-only consumption.
- Keep idempotency owner-scoped.
- Validate payment method server-side at checkout.
- Validate fulfillment input server-side at checkout.
- Use Mongo transactions or equivalent readiness-gated atomicity.
- Redact customer email and PII in logs.
- Do not log full quote snapshots if they contain sensitive diagnostics.
- Do not expose internal database ids as customer authority.
- Do not call payment providers before durable order/quote commit.

## Observability

Log safe events:

- `checkout.quote.load.started`
- `checkout.quote.load.failed`
- `checkout.quote.validated`
- `checkout.operational.validation.failed`
- `checkout.idempotency.reused`
- `checkout.transaction.started`
- `checkout.order.created`
- `checkout.quote.consumed`
- `checkout.transaction.committed`
- `checkout.transaction.aborted`
- `checkout.payment.next_step.created`
- `checkout.orchestration.failed`

Safe metadata:

- trace id
- quote id
- order id
- owner type, not full PII
- region
- currency
- payment method key
- error code
- duration

Metrics:

- checkout attempts
- quote validation failures by code
- quote expiry failures
- quote already-used conflicts
- transaction conflicts
- payment next-step failures
- idempotent replays
- manual/gateway/wallet branch counts

## Legacy Migration Strategy

Phase 1:

- Keep existing checkout paths operational.
- Add quote checkout as an additive route/service later.
- Orders without quote id remain valid historical records.

Phase 2:

- Store `quoteId` on new quote-backed orders.
- Add partial unique order index for non-empty quote ids.
- Keep legacy direct amount fields readable for admin, emails, wallet, and tracking.

Phase 3:

- Gate selected storefront/game pages to request a quote before checkout.
- Checkout uses only quote id and customer input.
- Browser amount fields remain diagnostic only.

Phase 4:

- Remove or restrict legacy direct order amount acceptance after all public surfaces migrate.
- Keep admin/manual compatibility where explicitly needed.

Historical orders:

- Do not backfill fake quote ids.
- Do not infer quote snapshots from old orders.
- Display historical commercial data from existing order fields.

## Future Model Roadmap

Potential additions:

- `Order.quoteId`
- `Order.quoteSnapshot`
- `Order.checkoutIdempotencyKeyHash`
- `Order.checkoutFingerprintHash`
- `Order.paymentFlow`
- `Order.promotionRedemptionId`
- `CheckoutIdempotency` collection or equivalent embedded order association
- partial unique index on `Order.quoteId`
- partial unique index on owner-scoped checkout idempotency key

Avoid:

- globally unique nullable fields
- storing mutable quote references only without snapshot
- coupling checkout idempotency to quote creation idempotency

## Future Service Roadmap

Expected future service:

`backend/services/commerce/checkoutFromQuoteService.js`

Suggested public methods:

- `checkoutFromQuote(input, dependencies)`
- `validateCheckoutInput(input)`
- `loadOwnedCheckoutQuote(context)`
- `validateQuoteForCheckout(quote, context)`
- `validateOperationalCheckoutFacts(context)`
- `buildOrderSnapshotFromQuote(context)`
- `consumeQuoteAndCreateOrder(context)`
- `createPaymentNextStep(context)`
- `mapCheckoutError(error)`

The service should be dependency-injected for:

- clock
- order id generator
- quote repository
- order model/repository
- payment method loader
- package operational validator
- promotion redemption service
- payment orchestration service
- logger/audit emitter

## Architecture Decisions

1. Checkout consumes a persisted quote; it does not recalculate commercial values.
2. Browser totals are never authoritative.
3. Quote consumption and order creation must be one atomic business operation.
4. Payment provider calls occur after the database transaction commits.
5. Checkout idempotency is separate from quote creation idempotency.
6. Quote ownership is mandatory; quote id-only checkout is forbidden.
7. User-bound quotes require user ownership, not session-only ownership.
8. Session-to-user quote claim is deferred and must be explicit.
9. Expiry rejects at `checkoutTime >= expiresAt`.
10. Payment-method-dependent pricing requires a quote-bound payment method.
11. Promotion resolver is not rerun at checkout.
12. Redemption-critical promotion constraints are revalidated at checkout.
13. Orders snapshot quote commercial facts for audit.
14. Legacy orders remain valid without quote ids.
15. Zero-price checkout requires explicit quote permission and waived-payment policy.
16. Mongo transaction support is a production readiness invariant for quote checkout unless replaced by an equivalent documented atomic strategy.

## Verification Requirements For Future Runtime

Future verifiers should prove:

- checkout rejects missing owner
- checkout rejects quote id-only access
- owned `ISSUED` quote creates exactly one order
- order amount equals quote total exactly
- checkout does not call pricing calculation
- checkout does not call promotion resolver
- expired quote at equality boundary rejects
- invalidated and cancelled quotes reject
- same idempotency key/fingerprint returns same order
- same key/different fingerprint rejects
- concurrent checkout creates one order only
- quote is not marked `USED` if order creation fails
- order is not committed if quote consumption fails
- payment method disabled after quote issuance rejects checkout
- payment method changed when quote-bound rejects checkout
- promotion quota exhaustion rejects without consuming quote
- provider failure after commit leaves recoverable order
- legacy orders without quote id still render
- MMK and THB remain separate

## Known Limitations

Deferred:

- runtime checkout service
- Express route/controller
- order model additions
- checkout idempotency persistence
- partial unique indexes
- payment provider orchestration
- wallet debit branch
- promotion redemption ledger
- inventory reservation
- session-to-user quote claim
- frontend quote checkout migration
- admin tools for quote inspection
- cleanup workers
- deployment/readiness enforcement

