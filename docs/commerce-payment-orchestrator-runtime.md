# AZIEL Commerce Payment Orchestrator Runtime

Sprint: 2.6.1

Status: Runtime foundation only

This document describes the implemented pure Payment Orchestrator runtime in `backend/services/commerce/paymentOrchestrator.js`.

No `PaymentAttempt` persistence model, provider SDK integration, Express route, controller, frontend checkout integration, fulfillment trigger, deployment, commit, or push is included in this sprint.

## Audit Findings

The runtime follows the conventions already present in Commerce services:

- Commerce services expose focused functions/factories and explicit error classes.
- Commerce errors carry stable `code`, `stage`, `retryable`, `causeCode`, and safe `metadata`.
- Inputs and public outputs are defensively cloned and frozen where appropriate.
- Transaction/session propagation is passed through injected callbacks and ports.
- `CommerceOrder` already has immutable commercial snapshots and separate order, payment, and fulfillment status fields.
- `OrderRepository` already supports owner-safe lookup, operational lookup, and conditional payment-status transitions.
- Current legacy payment logic is still owned by legacy routes/services and is not duplicated here.

## Runtime Boundary

The runtime boundary is:

```text
CommerceOrder
  -> Payment Orchestrator Runtime
  -> Injected PaymentAttempt Port
  -> Injected Provider Adapter Port
  -> Normalized Payment Result
```

The runtime imports no provider SDKs, QR libraries, wallet models, Express request/response objects, frontend modules, or `PaymentAttempt` persistence model.

## Public API

`createPaymentOrchestrator(dependencies)` returns:

- `initiatePayment(input)`
- `retryPayment(input)`
- `refreshPayment(input)`
- `cancelPayment(input)`
- `expirePayment(input)`
- `handleProviderEvent(input)`
- `getPaymentResult(input)`
- `toPublicPaymentResult(value)`
- `assertTransition(fromState, toState)`
- `normalizeProviderResult(value, context)`

## Dependency Ports

### orderRepository

Required capabilities:

- `findOwnedOrderById({ orderId, owner, transactionContext })`
- `findOrderById({ orderId, transactionContext })`
- `updatePaymentStatus({ orderId, fromStatuses, toStatus, changedAt, reason, owner }, { transactionContext })`

`findOwnedOrderById` is required for customer-facing operations. `findOrderById` is used only by operational provider-event handling.

### paymentAttemptPort

This is an abstract runtime port only. It has no persistence implementation in Sprint 2.6.1.

Expected capabilities:

- `findActiveAttemptForOrder(input)`
- `findAttemptByIdempotency(input)`
- `findAttemptByIdForOwner(input)`
- `findAttemptByProviderReference(input)`
- `createAttempt(input)`
- `updateAttemptStatus(input)`
- `setProviderReference(input)`
- `appendProviderEvent(input)`
- `recordFailure(input)`
- `listAttemptsForOrder(input)`

Future persistence must enforce uniqueness and idempotency at the repository/database level.

### providerResolver

The resolver returns a provider adapter from trusted order/payment selection data. The resolver must not use browser-supplied provider identity.

Adapters may expose:

- `createPayment(input)`
- `refreshPayment(input)`
- `queryPayment(input)`
- `cancelPayment(input)`
- `expirePayment(input)`

Provider results are normalized before state logic.

### transactionRunner

The transaction runner receives coordinated mutations that involve attempts, order payment status, and provider-event history. If a future caller already has a transaction context, the runtime can propagate it without starting nested provider persistence.

## Canonical State Machine

The runtime implements the approved canonical states:

- `UNPAID`
- `INITIATING`
- `PENDING`
- `PAID`
- `FAILED`
- `EXPIRED`
- `CANCELLED`
- `WAIVED`
- `REFUNDED`

`INITIATING` is an attempt-level runtime state. It is not written to `CommerceOrder.paymentStatus` because the current CommerceOrder model does not include that persisted payment status.

Allowed transitions:

```text
UNPAID -> INITIATING | WAIVED
INITIATING -> PENDING | PAID | FAILED | EXPIRED | CANCELLED
PENDING -> PAID | FAILED | EXPIRED | CANCELLED
FAILED -> INITIATING | CANCELLED
PAID -> REFUNDED
```

Rejected unsafe transitions include:

- `PAID -> PENDING`
- `PAID -> FAILED`
- `REFUNDED -> PAID`
- `CANCELLED -> PENDING`
- `EXPIRED -> PAID`

Late-payment reconciliation from `EXPIRED -> PAID` is disabled by default and can only be enabled with an explicit operational policy.

## Order, Payment, And Fulfillment Coordination

The orchestrator updates payment state without conflating:

- order status
- payment status
- fulfillment status

Payment success updates payment state to `paid` but does not mark fulfillment completed. Fulfillment remains owned by future fulfillment orchestration.

## Initiation Flow

`initiatePayment()`:

1. validates input and owner identity
2. loads owner-safe `CommerceOrder`
3. validates the order is payable
4. builds an immutable payment intent from persisted order data
5. checks idempotent and active attempts through `paymentAttemptPort`
6. resolves provider adapter
7. creates an `INITIATING` attempt through the abstract port
8. calls provider adapter with server-owned amount/currency/payment context
9. normalizes and validates provider result
10. updates attempt and order payment status in a transaction boundary
11. returns a redacted public payment result

Browser-supplied amount, currency, totals, discounts, provider references, and payment status are ignored.

## Retry Flow

`retryPayment()`:

- loads a prior attempt with owner safety
- permits retry from `FAILED` or `EXPIRED`
- rejects retry from `PAID`, `WAIVED`, `REFUNDED`, `CANCELLED`, and active states
- preserves the order amount and currency
- creates a new logical attempt through `initiatePayment()`
- avoids unbounded automatic retry loops

## Refresh Flow

`refreshPayment()`:

- loads owner-safe order and attempt
- resolves the same trusted adapter
- queries provider using stored attempt context
- normalizes provider state
- rejects regressions such as `PAID -> PENDING`
- accepts only valid forward transitions
- treats same-state refresh as idempotent

## Cancel And Expire Flow

`cancelPayment()` and `expirePayment()`:

- enforce owner-safe attempt lookup
- call provider adapter only if the capability exists
- reject invalid terminal-state changes
- treat already-cancelled and already-expired states as idempotent
- update attempt and order payment state consistently
- do not mutate commercial snapshots or fulfillment state

## Provider Event Flow

`handleProviderEvent()` accepts trusted normalized provider event data. Signature verification remains a future adapter/webhook boundary.

Flow:

```text
trusted provider event
  -> find attempt by provider reference
  -> duplicate providerEventId check
  -> load operational order
  -> validate provider/order/amount/currency binding
  -> append safe event history
  -> transition attempt and order payment state
  -> return safe idempotent result
```

Unknown provider references, mismatched amount, mismatched currency, and mismatched order binding fail closed.

## Idempotency Semantics

The runtime supports:

- same owner + order + idempotency key + same fingerprint returns the existing logical result
- same idempotency key with conflicting fingerprint fails with `PAYMENT_IDEMPOTENCY_CONFLICT`
- existing active attempts prevent duplicate provider charges
- duplicate provider events return idempotent success
- repeated cancel/expire operations return current terminal result

The runtime does not rely on in-memory locks. Persistence-level uniqueness is deferred.

## Transaction Semantics

Provider calls cannot be rolled back by MongoDB. The runtime distinguishes:

- provider failure before side effect
- provider success followed by local persistence failure
- duplicate/idempotent retries after an existing attempt

If a provider result is received but local state cannot be durably updated, the runtime raises `PAYMENT_OUTCOME_UNKNOWN` and records a safe failure through `paymentAttemptPort.recordFailure()` when available. It does not automatically create another provider charge.

## Error Contract

The runtime exports `PaymentOrchestratorError` and stable error codes:

- `PAYMENT_VALIDATION_ERROR`
- `PAYMENT_ORDER_NOT_FOUND`
- `PAYMENT_FORBIDDEN`
- `PAYMENT_NOT_PAYABLE`
- `PAYMENT_PROVIDER_UNAVAILABLE`
- `PAYMENT_PROVIDER_UNSUPPORTED`
- `PAYMENT_PROVIDER_ERROR`
- `PAYMENT_PROVIDER_RESULT_INVALID`
- `PAYMENT_AMOUNT_MISMATCH`
- `PAYMENT_CURRENCY_MISMATCH`
- `PAYMENT_ORDER_BINDING_MISMATCH`
- `PAYMENT_INVALID_TRANSITION`
- `PAYMENT_IDEMPOTENCY_CONFLICT`
- `PAYMENT_ATTEMPT_CONFLICT`
- `PAYMENT_RETRY_NOT_ALLOWED`
- `PAYMENT_EVENT_DUPLICATE`
- `PAYMENT_EVENT_NOT_FOUND`
- `PAYMENT_OUTCOME_UNKNOWN`
- `PAYMENT_PERSISTENCE_ERROR`

Errors expose safe structured metadata only.

## Public Redaction

`toPublicPaymentResult()` returns a detached, deeply frozen public object containing:

- `orderId`
- `attemptId`
- `paymentStatus`
- `provider`
- `amount`
- `currency`
- `expiresAt`
- safe payment instructions
- safe QR or redirect
- retry eligibility
- safe failure code/message
- created/updated timestamps
- safe outcome metadata

It excludes provider secrets, raw payloads, webhook signatures, owner ids, repository internals, transaction/session data, raw stacks, and internal provider events.

## Deferred Work

Deferred to later sprints:

- `PaymentAttempt` Mongoose model
- payment attempt repository persistence
- provider adapter registry persistence
- Omise/OPN adapter
- PromptPay QR adapter
- wallet adapter
- webhook HTTP route integration
- signature verification implementation
- public checkout routes/controllers
- frontend checkout integration
- manual receipt upload migration
- manual admin approval migration
- wallet ledger integration
- fulfillment trigger integration
- realtime and email side effects
- refund orchestration
