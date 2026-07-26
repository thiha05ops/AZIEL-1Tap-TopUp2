# AZIEL Commerce Payment Orchestrator Specification

Sprint: 2.6.0

Status: Specification only

This document defines the future payment orchestration layer that sits after quote-backed checkout and before any payment provider. It does not implement runtime code, models, repositories, routes, controllers, provider SDKs, wallet debit, manual payment migration, webhooks, deployment, commits, or pushes.

## Purpose

The Payment Orchestrator is the only service allowed to turn a persisted `CommerceOrder` into payment work.

Required architecture:

```text
CommerceOrder
  -> Payment Orchestrator
  -> Provider Adapter
  -> Provider
```

No provider may update order/payment state directly. Provider integrations, manual receipt flows, wallet debit, and webhook handlers must call the orchestrator.

## Audit Findings

Current repository state:

- `backend/services/commerce/checkoutApplicationService.js` creates quote-backed checkout output and, as of Sprint 2.5.4, persists a `CommerceOrder` and marks the `PricingQuote` as `USED`.
- `backend/models/CommerceOrder.js` already has `status`, `paymentStatus`, nested `payment.status`, mutable payment references, fulfillment status, and status history.
- `backend/services/commerce/orderRepository.js` exposes status transition helpers but does not own payment provider behavior.
- `backend/models/PaymentMethod.js` stores method configuration, rail type, payment type, provider, QR mode, confirmation mode, receipt settings, PromptPay capabilities, app-launch fields, and bank launchers.
- `backend/models/ManualPaymentAttempt.js` stores the current manual PromptPay/bank attempt lifecycle with dynamic QR, receipt evidence, expiry, and consumed status.
- `backend/routes/payment.js` currently owns legacy manual attempts, receipt upload, legacy order creation, Omise PromptPay charge creation, and Omise webhook normalization/dispatch.
- `backend/services/paymentStateService.js` currently applies provider payment state to legacy `Order` and prevents manual admin-confirmed orders from being auto-marked paid.
- `backend/services/omisePaymentService.js` verifies Omise charge mode, amount, currency, metadata, and paid state.
- `backend/services/walletService.js` already performs idempotent wallet credit/debit ledger mutations with Mongo session support.

The future orchestrator must reuse those concepts without letting any provider bypass the orchestrator.

## Source References

This specification is grounded in the current implementation:

- `backend/models/CommerceOrder.js:4` defines Commerce order states and `backend/models/CommerceOrder.js:16` defines Commerce payment states.
- `backend/models/CommerceOrder.js:113` defines the nested payment snapshot and `backend/models/CommerceOrder.js:182` binds it into the order document.
- `backend/models/CommerceOrder.js:224` validates that nested `payment.status` and top-level `paymentStatus` stay synchronized.
- `backend/models/PaymentMethod.js:87` defines QR modes, including `aziel_promptpay_dynamic`.
- `backend/models/PaymentMethod.js:98` defines confirmation modes, including `manual_admin`, `provider_webhook`, `automatic_provider`, and `wallet_internal`.
- `backend/models/PaymentMethod.js:182` and `backend/models/PaymentMethod.js:187` define current payment type and rail type vocabulary.
- `backend/models/PaymentMethod.js:238` through `backend/models/PaymentMethod.js:290` define current customer capabilities and bank launcher configuration.
- `backend/models/ManualPaymentAttempt.js:81` through `backend/models/ManualPaymentAttempt.js:150` define the current manual attempt payment snapshot, capabilities, dynamic QR payload, and receipt-facing instructions.
- `backend/models/ManualPaymentAttempt.js:151` defines the current manual attempt lifecycle as `active`, `consumed`, and `expired`.
- `backend/routes/payment.js:238` resolves enabled manual payment methods for the current manual flow.
- `backend/routes/payment.js:254` creates manual attempt records with generated attempt ids and references.
- `backend/routes/payment.js:277` creates current Omise PromptPay charges.
- `backend/routes/payment.js:758` creates manual payment attempts before order creation.
- `backend/routes/payment.js:1093` accepts manual receipt/slip submission and only then creates the legacy order.
- `backend/routes/payment.js:1234` creates current non-manual game payments and redirects manual methods to the manual attempt flow.
- `backend/routes/payment.js:1593` handles current Omise webhooks, validates provider records, and applies payment state.
- `backend/services/paymentStateService.js:24` validates provider payment amount, currency, transaction, and order binding.
- `backend/services/paymentStateService.js:66` applies provider payment state idempotently and blocks provider-paid transitions on manual admin-confirmed orders.
- `backend/services/walletService.js:108` owns the current idempotent wallet mutation entry point.

## Existing Payment Architecture

Current legacy flows are split across routes/services:

- Manual PromptPay/manual bank: create `ManualPaymentAttempt`, generate or present QR/instructions, upload receipt, create legacy `Order` after receipt upload, wait for admin verification.
- Gateway PromptPay/Omise: create legacy `Order`, create Omise source/charge, store transaction id, wait for webhook/provider verification.
- Wallet: validate balance and mutate wallet ledger atomically through `walletService`, then create/update order state according to existing wallet flow.

Current legacy payment statuses:

- `pending`
- `paid`
- `failed`
- `expired`
- `cancelled`
- `refunded`

Commerce payment statuses already available:

- `unpaid`
- `pending`
- `paid`
- `failed`
- `expired`
- `cancelled`
- `waived`
- `refunded`

The orchestrator should use the Commerce vocabulary and map legacy/provider values into it.

## Boundaries

The Payment Orchestrator owns:

- payment attempt creation
- provider adapter selection
- payment intent construction from `CommerceOrder`
- payment status transition requests
- payment attempt history
- webhook normalization handoff
- duplicate webhook suppression
- retry and refresh policy
- public-safe next action output
- audit/timeline event emission contract

The Payment Orchestrator does not own:

- price calculation
- promotion resolution
- quote creation
- quote consumption
- order creation
- fulfillment execution
- supplier calls
- wallet top-up approval
- admin UI
- provider SDK implementation details

## Canonical Payment State Machine

Canonical payment states:

- `UNPAID`: order exists but no payment attempt has been initiated.
- `INITIATING`: orchestrator is creating a provider/manual/wallet attempt.
- `PENDING`: customer or provider action is outstanding.
- `PAID`: payment is confirmed and final.
- `FAILED`: payment attempt failed terminally.
- `EXPIRED`: payment attempt expired terminally.
- `CANCELLED`: customer/system/admin cancelled payment terminally.
- `WAIVED`: zero-price or explicitly waived payment terminally.
- `REFUNDED`: paid amount was reversed/refunded terminally for payment accounting.

Allowed transitions:

```text
UNPAID -> INITIATING | WAIVED | CANCELLED
INITIATING -> PENDING | PAID | FAILED | EXPIRED | CANCELLED
PENDING -> PAID | FAILED | EXPIRED | CANCELLED
PAID -> REFUNDED
FAILED -> INITIATING
EXPIRED -> INITIATING
CANCELLED -> INITIATING
WAIVED -> terminal
REFUNDED -> terminal
```

Invalid transitions:

- Any transition from `WAIVED` except idempotent same-state replay.
- Any transition from `REFUNDED` except idempotent same-state replay.
- `PAID -> PENDING`, `PAID -> FAILED`, `PAID -> EXPIRED`, or `PAID -> CANCELLED`.
- Provider-confirmed `PAID` on manual-admin methods without an explicit admin verification event.
- Any transition that changes amount, currency, order id, or provider identity after attempt creation.

## Order Relationship

`CommerceOrder.status`, `CommerceOrder.paymentStatus`, and `CommerceOrder.fulfilment.status` must remain coordinated:

```text
CommerceOrder.status = pending_payment
CommerceOrder.paymentStatus = unpaid
CommerceOrder.fulfilment.status = not_started

Payment Orchestrator creates payment attempt
CommerceOrder.paymentStatus = pending

Payment confirmed
CommerceOrder.paymentStatus = paid
CommerceOrder.status = paid

Fulfillment starts
CommerceOrder.status = processing
CommerceOrder.fulfilment.status = processing

Fulfillment completes
CommerceOrder.status = completed
CommerceOrder.fulfilment.status = completed
```

Payment failure/expiry/cancellation should update payment status and may keep the order in `pending_payment` if retry is allowed. A terminal checkout cancellation may move order status to `cancelled` or `expired` according to future order policy.

Fulfillment must not start until payment is `PAID` or `WAIVED`.

## Payment Intent

A Payment Intent is an immutable authority object derived only from `CommerceOrder`.

Required fields:

- `paymentIntentId`
- `commerceOrderId`
- `orderId`
- `quoteId`
- `owner`
- `amount`
- `currency`
- `region`
- `paymentMethodId`
- `paymentChannel`
- `provider`
- `providerType`
- `confirmationMode`
- `paymentSnapshot`
- `commercialSnapshot`
- `createdAt`
- `expiresAt`
- `idempotencyKey`
- `traceId`

Rules:

- It consumes `CommerceOrder` only.
- It never calculates price.
- It never trusts browser amount or currency.
- It stores the exact amount/currency from `CommerceOrder.commercial`.
- It snapshots the selected payment configuration required for execution.
- Provider adapters receive the intent, not the raw order document.

## PaymentAttempt Specification

Future model name: `PaymentAttempt`.

Purpose:

- represent one executable payment attempt for one `CommerceOrder`
- support retries without mutating the original order commercial snapshot
- store provider/manual/wallet execution state
- provide idempotency and webhook replay protection

Relationship:

```text
CommerceOrder 1 -> many PaymentAttempt
```

Required fields:

- `attemptId`
- `commerceOrderId`
- `orderId`
- `quoteId`
- `owner`
- `attemptNumber`
- `status`
- `paymentStatus`
- `providerType`
- `provider`
- `paymentMethodId`
- `paymentChannel`
- `amount`
- `currency`
- `region`
- `confirmationMode`
- `idempotencyKeyHash`
- `requestFingerprint`
- `providerReference`
- `providerTransactionId`
- `providerStatus`
- `nextAction`
- `qr`
- `receipt`
- `walletLedgerReference`
- `webhookEvents`
- `timeline`
- `error`
- `expiresAt`
- `createdAt`
- `updatedAt`

Identity rules:

- `attemptId` is globally unique.
- `commerceOrderId + attemptNumber` is unique.
- active attempts should be unique per order unless the previous attempt is terminal.
- provider transaction ids are unique per provider when present.
- idempotency is scoped to order + payment method + attempt creation fingerprint.

Retry behavior:

- Failed, expired, or cancelled attempts may be retried with a new attempt number.
- A retry must use the same order amount/currency.
- A retry may use a different payment method only if future policy permits it.
- A paid attempt blocks new attempts.

## Provider Adapter Contract

Every provider adapter must implement a common contract:

```js
{
  providerType,
  providerKey,
  supports,
  createPayment(intent, context),
  cancelPayment(attempt, context),
  expirePayment(attempt, context),
  refreshPayment(attempt, context),
  queryPayment(attempt, context),
  handleWebhook(webhook, context),
  normalizeProviderResponse(response, context)
}
```

`createPayment()` returns:

```js
{
  status,
  providerReference,
  providerTransactionId,
  providerStatus,
  nextAction,
  expiresAt,
  customerInstructions,
  qr,
  redirect,
  rawProviderSummary,
  warnings
}
```

Adapters must not:

- update `CommerceOrder` directly
- mark payment paid directly
- create fulfillment work
- recalculate amount
- read provider secrets outside the configured secret boundary
- expose raw provider payloads to public callers

## Provider Types

### Manual PromptPay

Provider type: `manual_promptpay`

Flow:

1. Orchestrator derives payment intent from `CommerceOrder`.
2. Adapter generates amount-specific PromptPay QR from server-owned `PaymentMethod` recipient configuration.
3. Adapter encodes AZIEL order/reference metadata when supported by the QR standard.
4. Orchestrator creates `PaymentAttempt` with `PENDING`.
5. Customer saves QR, opens bank app, pays, and uploads receipt.
6. Receipt upload attaches durable evidence to the attempt.
7. Admin verifies receipt.
8. Orchestrator marks attempt `PAID`, updates order payment status, then allows fulfillment.

Manual PromptPay rules:

- receipt upload is required unless future admin policy explicitly disables it
- dynamic QR must be amount-specific
- static QR must never replace dynamic QR when dynamic mode succeeds
- duplicate receipt uploads must be idempotent
- expired attempts cannot accept new receipts
- manual methods cannot be marked paid by provider webhook
- admin verification is the authority for completion

Expiry:

- attempt expiry prevents new receipt submission
- recovery UI may continue to show recoverable context according to recovery policy
- expired payment attempt does not delete the order
- retry creates a new attempt if order policy permits

### Gateway: Omise / OPN

Provider type: `gateway`

Flow:

1. Orchestrator derives payment intent from `CommerceOrder`.
2. Adapter creates provider payment session/source/charge.
3. Orchestrator records provider transaction id and next action.
4. Customer completes QR/redirect/app flow.
5. Provider webhook arrives.
6. Webhook is verified by provider adapter.
7. Adapter normalizes provider response.
8. Orchestrator validates amount, currency, mode, metadata, and order binding.
9. Orchestrator applies payment state transition idempotently.

Omise-specific requirements:

- verify charge by retrieving provider charge server-side
- validate live/test mode
- validate provider charge id
- validate amount minor units against order amount
- validate currency
- validate metadata type/order id
- accept only supported webhook event keys
- do not trust webhook body alone for paid status

Refund boundary:

- refund orchestration is not part of Sprint 2.6.x payment initiation
- future refund adapter methods must be separate and must not alter original payment intent

### Wallet

Provider type: `wallet`

Flow:

1. Orchestrator derives payment intent from `CommerceOrder`.
2. Wallet adapter validates wallet currency and balance.
3. Wallet debit and payment state update happen atomically.
4. Wallet ledger reference is attached to the attempt/order.
5. No external provider is involved.

Wallet rules:

- wallet debit must use idempotent ledger keys
- MMK and THB balances remain separate
- insufficient balance is a terminal failure for that attempt unless user retries after funding
- no provider webhook exists
- wallet may mark payment `PAID` only after debit commits

### Future Providers

Future provider adapters must satisfy the same contract. New provider behavior is added behind adapters, not inside checkout, order repository, or public routes.

## Webhook Architecture

Canonical webhook flow:

```text
Provider callback
  -> verify signature/source/replay
  -> provider adapter normalizes event
  -> Payment Orchestrator loads attempt/order
  -> validate amount/currency/provider/order binding
  -> idempotency/replay check
  -> transition payment attempt
  -> transition CommerceOrder payment/order status
  -> emit audit/timeline/realtime/email events
  -> future fulfillment trigger
```

Webhook events must store:

- provider
- provider event id
- provider transaction id
- normalized event type
- normalized status
- received at
- verified at
- processing result
- safe error code

Duplicate webhook behavior:

- same provider event id returns idempotent success
- same provider transaction/status replay returns idempotent success
- mismatched order/amount/currency rejects and logs security event

## Idempotency

Payment creation:

- scoped by order + payment method + payment attempt fingerprint
- retry with same key/fingerprint returns existing attempt
- retry with same key/different fingerprint rejects

Provider retry:

- provider network retry must not create duplicate attempts
- provider transaction id must bind to one attempt

Webhook retry:

- provider event id is recorded
- duplicate webhook does not re-transition paid/refunded

Manual retry:

- receipt re-upload for consumed attempt returns existing result when possible
- expired/cancelled manual attempt requires new attempt

Network retry:

- public caller can retry payment creation safely with same idempotency key

## Security Model

Required controls:

- provider secrets live only in server environment or secure provider config
- public clients never submit provider secrets
- provider signature verification is mandatory where supported
- webhook replay protection is mandatory
- provider event ids and transaction ids are stored for replay detection
- amount/currency/order/provider metadata must match persisted intent
- browser-submitted amount/currency is ignored
- manual QR recipient is read only from stored `PaymentMethod`
- wallet debit requires authenticated owner and sufficient balance
- provider raw payloads are stored only as redacted summaries
- logs must not expose API keys, card data, bank credentials, QR recipient secrets, or full customer PII

## Error Model

Error categories:

- `PAYMENT_INPUT_INVALID`
- `PAYMENT_ORDER_NOT_FOUND`
- `PAYMENT_ORDER_NOT_PAYABLE`
- `PAYMENT_METHOD_UNAVAILABLE`
- `PAYMENT_METHOD_INCOMPATIBLE`
- `PAYMENT_ATTEMPT_CONFLICT`
- `PAYMENT_ATTEMPT_EXPIRED`
- `PAYMENT_IDEMPOTENCY_CONFLICT`
- `PAYMENT_PROVIDER_UNAVAILABLE`
- `PAYMENT_PROVIDER_REJECTED`
- `PAYMENT_PROVIDER_REFERENCE_MISMATCH`
- `PAYMENT_AMOUNT_MISMATCH`
- `PAYMENT_CURRENCY_MISMATCH`
- `PAYMENT_WEBHOOK_INVALID`
- `PAYMENT_WEBHOOK_REPLAY`
- `PAYMENT_WALLET_INSUFFICIENT_BALANCE`
- `PAYMENT_STATE_CONFLICT`
- `PAYMENT_ORCHESTRATION_FAILED`

Retryability:

- provider/network unavailable may be retryable
- idempotency conflict is not retryable without a new key
- amount/currency mismatch is terminal and security-relevant
- insufficient wallet balance may be user-recoverable
- expired manual attempts require a new attempt

## Observability Model

The orchestrator should emit:

- payment timeline entries
- order timeline entries
- admin audit events for manual verification
- provider event history
- normalized error events
- realtime customer/admin updates
- email notification trigger events where existing email architecture requires them

Trace fields:

- `traceId`
- `orderId`
- `quoteId`
- `attemptId`
- `provider`
- `providerTransactionId`
- `providerEventId`
- `idempotencyKeyHash`
- `actorType`
- `source`

Public observability must expose only safe states and customer instructions. Internal diagnostics remain admin/server-only.

## Public Next Actions

Possible public next actions:

- `UPLOAD_RECEIPT`
- `SHOW_DYNAMIC_QR`
- `SHOW_STATIC_QR`
- `OPEN_BANK_APP`
- `OPEN_BANK_CHOOSER`
- `REDIRECT_PROVIDER`
- `WAIT_FOR_WEBHOOK`
- `WALLET_PAID`
- `NO_PAYMENT_REQUIRED`
- `RETRY_PAYMENT`

No next action may expose provider secrets, raw webhooks, raw request fingerprints, Mongo ids, or internal payment attempt locks.

## Future Work

Deferred implementation:

- `PaymentAttempt` model
- payment orchestrator runtime
- provider adapter registry
- manual PromptPay adapter
- Omise/OPN adapter
- wallet adapter
- webhook route migration
- payment attempt repository
- payment timeline persistence
- quote checkout to payment initiation API
- refund orchestrator
- fulfillment trigger integration
- admin payment attempt views
- migration from legacy manual attempts where required
