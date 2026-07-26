# AZIEL Commerce PaymentAttempt Persistence

Sprint: 2.6.2

Status: Persistence foundation only

This document describes the `PaymentAttempt` model and repository introduced for Commerce payment orchestration.

No provider registry, provider SDK, Omise adapter, PromptPay adapter, wallet adapter, route, controller, frontend integration, fulfillment trigger, deployment, commit, or push is included in this sprint.

## Architecture

```text
CommerceOrder
  -> Payment Orchestrator Runtime
  -> PaymentAttempt Repository
  -> PaymentAttempt Model
  -> MongoDB
```

The repository owns persistence. The orchestrator owns orchestration. Providers own payment execution through future adapters.

## Audit Findings

The implementation follows existing Commerce persistence conventions:

- strict Mongoose schema with explicit immutable fields
- repository-owned timestamps
- explicit repository error class and stable error codes
- owner-safe lookup helpers
- conditional state updates to prevent lost updates
- injected Mongo session support
- plain/detached repository results
- idempotent create behavior based on stored request fingerprints

The repository is compatible with the Sprint 2.6.1 payment orchestrator port names.

## Model Architecture

Model: `backend/models/PaymentAttempt.js`

Collection: `paymentattempts`

Identity fields:

- `attemptId`
- `orderId`
- `quoteId`
- `ownerId`
- `owner`

Provider fields:

- `provider`
- `providerType`
- `paymentMethod`
- `paymentMethodId`
- `paymentChannel`
- `confirmationMode`

Commercial fields:

- `amount`
- `currency`
- `region`

Lifecycle fields:

- `status`
- `createdAt`
- `updatedAt`
- `expiresAt`
- `completedAt`
- `cancelledAt`
- `expiredAt`

References and metadata:

- `providerReference`
- `providerTransactionId`
- `rawProviderStatus`
- `idempotencyKey`
- `operation`
- `requestFingerprint`
- `previousAttemptId`
- `providerMetadata`
- `safeMetadata`
- `paymentInstructions`
- `qr`
- `redirect`

Failure fields:

- `failure`
- `failureCategory`
- `failureCode`
- `failureMessage`

Provider events:

- `eventHistory[]`

## Immutability

Immutable after creation:

- `attemptId`
- `orderId`
- `quoteId`
- `ownerId`
- `owner`
- `provider`
- `providerType`
- `paymentMethod`
- `paymentMethodId`
- `paymentChannel`
- `confirmationMode`
- `amount`
- `currency`
- `region`
- `idempotencyKey`
- `operation`
- `requestFingerprint`
- `previousAttemptId`
- `createdAt`

Mutable:

- `status`
- `providerReference`
- `providerTransactionId`
- `rawProviderStatus`
- `providerMetadata`
- `safeMetadata`
- `paymentInstructions`
- `qr`
- `redirect`
- `failure`
- `eventHistory`
- `updatedAt`
- lifecycle completion timestamps

## Status Policy

Canonical states:

- `UNPAID`
- `INITIATING`
- `PENDING`
- `PAID`
- `FAILED`
- `EXPIRED`
- `CANCELLED`
- `WAIVED`
- `REFUNDED`

Allowed transitions:

```text
UNPAID -> INITIATING | WAIVED
INITIATING -> PENDING | PAID | FAILED | EXPIRED | CANCELLED
PENDING -> PAID | FAILED | EXPIRED | CANCELLED
FAILED -> INITIATING | CANCELLED
PAID -> REFUNDED
```

Terminal or effectively terminal states reject unsafe regressions.

## Repository Architecture

Repository: `backend/services/commerce/paymentAttemptRepository.js`

Public methods:

- `createAttempt()`
- `findAttemptById()`
- `findAttemptByIdForOwner()`
- `findAttemptsForOrder()`
- `findActiveAttemptForOrder()`
- `findAttemptByProviderReference()`
- `findAttemptByIdempotency()`
- `updateStatus()`
- `updateAttemptStatus()`
- `appendProviderEvent()`
- `recordFailure()`
- `setProviderReference()`
- `markCompleted()`
- `markCancelled()`
- `markExpired()`

The `updateAttemptStatus()` alias is intentionally exported for direct compatibility with the Payment Orchestrator runtime port.

## Index Strategy

Indexes:

- unique `attemptId`
- unique sparse `providerReference`
- unique partial `provider + ownerId + idempotencyKey + operation`
- `ownerId + orderId`
- `orderId + createdAt`
- `status`
- `expiresAt`
- sparse `eventHistory.providerEventId`

The idempotency index includes `ownerId` and `operation` to avoid cross-owner collisions while still enforcing stable provider-scoped retry behavior.

## Transaction Behaviour

Repository methods accept:

- `mongoSession`
- `session`
- `transactionContext.mongoSession`
- `transactionContext.session`

The repository never starts a transaction. It only participates in a caller-owned transaction/session.

## Event History Behaviour

`appendProviderEvent()` stores only normalized provider-event data:

- provider event id
- provider
- provider reference
- provider transaction id
- event type
- canonical status
- amount
- currency
- occurred timestamp
- received timestamp
- safe metadata

Raw webhook payloads, signatures, authorization values, API keys, and secrets are stripped from metadata before persistence.

Provider events are append-only. Duplicate `providerEventId` values for the same attempt are rejected with `PAYMENT_DUPLICATE_EVENT`.

## Idempotency Behaviour

`createAttempt()` checks existing attempts with the same:

- provider
- owner
- idempotency key
- operation

If the stored request fingerprint matches, it returns the existing attempt. If the fingerprint differs, it rejects with `PAYMENT_IDEMPOTENCY_CONFLICT`.

## Error Contract

Repository errors use `PaymentAttemptRepositoryError`.

Error codes:

- `INVALID_PAYMENT_ATTEMPT_RECORD`
- `INVALID_PAYMENT_ATTEMPT_ID`
- `INVALID_ORDER_ID`
- `INVALID_OWNER`
- `INVALID_PROVIDER_REFERENCE`
- `INVALID_PROVIDER_EVENT`
- `PAYMENT_ATTEMPT_EXISTS`
- `PAYMENT_ATTEMPT_NOT_FOUND`
- `PAYMENT_ATTEMPT_FORBIDDEN`
- `PAYMENT_PROVIDER_REFERENCE_EXISTS`
- `PAYMENT_INVALID_TRANSITION`
- `PAYMENT_DUPLICATE_EVENT`
- `PAYMENT_IDEMPOTENCY_CONFLICT`
- `PAYMENT_PERSISTENCE_ERROR`

Errors expose safe structured metadata only.

## Orchestrator Compatibility

The repository implements the abstract port used by `paymentOrchestrator.js`:

- active attempt lookup
- idempotency lookup
- owner-safe attempt lookup
- provider-reference lookup
- attempt creation
- status update
- provider reference update
- provider event append
- failure recording
- order attempt listing

The verifier executes the Payment Orchestrator against this repository using an in-memory fake model.

## Deferred Work

Deferred to later sprints:

- provider registry
- Omise/OPN adapter
- PromptPay QR adapter
- wallet adapter
- provider SDK calls
- webhook HTTP routes
- payment controllers
- frontend checkout integration
- manual receipt upload migration
- manual admin approval migration
- wallet ledger integration
- fulfillment triggers
- refund orchestration
