# AZIEL Commerce Order Persistence

Sprint: 2.5.3

Status: Persistence foundation only

This document describes the persistence foundation for quote-based commerce orders produced from `backend/services/commerce/orderSnapshotRuntime.js`.

This sprint does not implement checkout integration, public routes/controllers, payment initiation, payment attempts, wallet debit, promotion redemption writes, inventory reservation, supplier fulfillment, frontend UI, historical migrations, deployment, commits, or pushes.

## Audit Decision

The existing legacy `Order` model is intentionally not extended in this sprint.

Legacy `Order` has required fields such as `game`, `userId`, `packageName`, `amount`, and `paymentMethod`, plus route-specific manual payment, wallet, refund, and admin assumptions. Extending it for quote-commerce snapshots would overload existing field meanings and force future quote orders to duplicate or flatten commercial data into legacy compatibility fields.

Selected strategy:

- create dedicated `CommerceOrder` model/collection
- keep legacy `Order` untouched
- preserve gradual migration
- avoid rewriting historical orders
- keep quote-based order fidelity intact

## Model Strategy

Model:

- `backend/models/CommerceOrder.js`

Collection:

- `commerceorders`

Characteristics:

- `strict: "throw"`
- `minimize: false`
- no TTL index
- caller-owned canonical timestamps
- explicit unique identities
- owner-scoped idempotency indexes
- immutable quote/commercial/product/checkout fields

Mixed fields are used only where the upstream snapshot is intentionally versioned or future-shaped:

- `pricing`
- `promotion`
- `quoteSnapshot`
- fulfillment/payment/operational reference arrays

## Persistence Contract

The persisted record preserves:

- schema/runtime/specification versions
- order id
- quote id
- checkout id
- commerce source/version
- owner binding
- product/package snapshot
- fulfillment input/status
- customer contact/notes
- commercial snapshot
- pricing audit snapshot
- selected promotion snapshot
- payment selection/status snapshot
- checkout idempotency metadata
- request trace metadata
- quote metadata
- order status
- created/updated timestamps

The repository never recalculates prices and never replaces quote commercial fields.

## Immutable Fields

Immutable after creation:

- `orderId`
- `quoteId`
- `checkoutId`
- `commerce`
- `owner`
- product/package snapshot
- original fulfillment input
- customer contact/notes
- commercial snapshot
- pricing snapshot
- selected promotion snapshot
- original payment method selection
- checkout idempotency identity
- request fingerprint
- checked-out timestamp
- quote metadata
- quote snapshot
- created timestamp

## Mutable Fields

Mutable operational fields:

- `status`
- `paymentStatus`
- `payment.status`
- `payment.nextAction`
- `fulfilment.status`
- `payment.references`
- `fulfilment.references`
- `operationalReferences`
- `statusHistory`
- `updatedAt`

Repository APIs do not permit arbitrary replacement of immutable commercial data.

## Owner Binding

Persisted owner shape:

```js
{
  type: "USER" | "SESSION",
  userId,
  sessionId
}
```

Rules:

- `USER` requires `userId`
- `SESSION` requires `sessionId` and forbids user transfer
- customer-facing lookups require owner binding
- wrong owner returns `null`
- no owner-safe lookup falls back to unrestricted lookup

Internal unrestricted lookups are separately named:

- `findOrderById`
- `findOrderByQuoteId`
- `findOrderByCheckoutId`

## Indexes And Uniqueness

Declared indexes:

- unique `orderId`
- unique `quoteId`
- unique `checkoutId`
- owner + order id
- owner + quote id
- owner-scoped checkout idempotency for `USER`
- owner-scoped checkout idempotency for `SESSION`
- order status + created timestamp
- payment status + created timestamp
- fulfillment status + created timestamp
- trace id
- commerce source + created timestamp

No nullable globally unique field is used for checkout idempotency.

## Idempotency

`createOrderRecord(snapshot, options?)` checks owner-scoped checkout idempotency before insert.

Same owner + same idempotency identity + same request fingerprint + same quote id:

- returns existing order
- marks `__commerceOrderPersistenceOutcome: "idempotent"`
- creates no second record

Same owner + same idempotency identity with different fingerprint or quote:

- rejects with `CHECKOUT_IDEMPOTENCY_CONFLICT`

Same quote with different idempotency key:

- rejects with `ORDER_ALREADY_EXISTS_FOR_QUOTE`

Different owners may reuse the same idempotency identity.

## Repository API

`backend/services/commerce/orderRepository.js` exports:

- `createOrderRecord(snapshot, options?)`
- `findOrderById(orderId, options?)`
- `findOwnedOrderById(input, options?)`
- `findOrderByQuoteId(quoteId, options?)`
- `findOwnedOrderByQuoteId(input, options?)`
- `findOrderByCheckoutId(checkoutId, options?)`
- `findOwnedOrderByCheckoutIdempotency(input, options?)`
- `updateOrderStatus(input, options?)`
- `updatePaymentStatus(input, options?)`
- `updateFulfilmentStatus(input, options?)`
- `appendOperationalReference(input, options?)`

Options:

```js
{
  model,
  session,
  mongoSession,
  lean
}
```

The repository returns detached plain records.

## Transaction And Session Behaviour

Repository methods accept a caller-owned Mongo session and propagate it to:

- create
- reads
- status updates
- operational reference appends

The repository does not start transactions and does not own transaction commit/abort.

Future checkout integration remains responsible for wrapping quote lookup, order create, and quote consumption in one transaction.

## Status Transitions

Foundational order transitions:

- `pending_payment -> paid | cancelled | payment_failed | expired`
- `paid -> processing | cancelled | refund_pending`
- `processing -> completed | failed | refund_pending`
- `completed -> refund_pending`
- `failed -> refund_pending`
- `refund_pending -> refunded | cancelled`

Payment transitions:

- `unpaid -> pending | paid | failed | expired | waived`
- `pending -> paid | failed | expired | cancelled`
- `paid -> refunded`

Fulfillment transitions:

- `not_started -> queued | processing | cancelled`
- `queued -> processing | cancelled`
- `processing -> completed | failed | cancelled`

Updates are conditional. Stale expected state rejects with `ORDER_STATE_CONFLICT`.

## Error Contract

`OrderRepositoryError` includes:

- `code`
- `message`
- `stage`
- `causeCode`
- `retryable`
- safe `metadata`

Error codes include validation, uniqueness, idempotency, not-found, transition, state conflict, create/read/update, and persistence failures.

The repository is not HTTP-specific.

## Existing Order Assessment

The legacy `backend/models/Order.js` remains the operational order model for existing routes.

It is not a safe target for Sprint 2.5.3 quote-commerce persistence because it currently:

- requires legacy storefront fields that are not the canonical quote-commerce shape
- stores payment/manual-payment/wallet/refund details directly on the order
- has established admin, payment, wallet, fulfillment, and email integrations
- has existing production indexes and unique constraints
- does not provide an immutable quote snapshot contract

Using a dedicated model avoids accidental behavior changes in current production flows.

## Interpretation Of Ambiguities

The terms order, checkout, and payment are intentionally separated:

- checkout creates the immutable commercial order record
- payment attempts and provider state remain future/out-of-scope integrations
- legacy `Order` continues to mean the current production order document
- `CommerceOrder` means quote-backed commerce order persistence only

No automatic dual-write or legacy adapter is introduced.

## Legacy Compatibility

Legacy live order routes remain unchanged.

Historical `Order` records:

- are not migrated
- are not backfilled
- remain source of truth for existing admin/order history flows

Future migration can read both legacy `Order` and quote-based `CommerceOrder` collections through explicit adapters.

## Future Integration Boundary

Future Sprint 2.5.x/2.6 work may call this repository after:

- quote ownership is verified
- quote status is eligible for checkout
- checkout idempotency key and request fingerprint are derived
- order snapshot runtime has frozen the quote commercial data

The expected production transaction boundary is:

1. read and lock quote
2. create commerce order
3. mark quote consumed/used
4. commit
5. begin payment/manual payment orchestration outside the transaction

This repository supports caller-owned Mongo sessions but does not start or commit a transaction itself.

## Public Exposure Policy

`CommerceOrder` records are storage records, not API DTOs.

Future public APIs must redact or transform:

- internal version fields where unnecessary
- trace ids and request metadata
- private operational references
- payment provider metadata
- customer contact details
- full quote snapshots unless an explicit admin/internal view requires them

Customer APIs should use owner-safe repository calls only.

## Security And Privacy

The model/repository must not store:

- supplier credentials
- payment provider secrets
- raw card data
- bank credentials
- raw auth tokens
- rejected promotion eligibility traces
- unnecessary sensitive request data

Public redaction remains outside the repository.

## Limitations

Deferred:

- checkout application service persistence integration
- Express routes/controllers
- public API
- payment initiation
- manual payment attempt creation
- wallet debit
- promotion redemption writes
- inventory reservation
- supplier reservation
- supplier fulfillment
- frontend checkout
- admin UI
- historical migration
- deployment

Known limitation:

- persistence is isolated and not wired to live checkout traffic yet
- no production migration exists from legacy `Order`
- no order list/search API is introduced
- no payment attempt or wallet debit is created from `CommerceOrder`
- no promotion redemption ledger write occurs
