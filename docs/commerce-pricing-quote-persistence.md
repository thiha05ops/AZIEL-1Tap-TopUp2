# AZIEL Commerce Pricing Quote Persistence

Sprint: 2.4.2

Status: Persistence foundation only

This document describes the persistence foundation for immutable Pricing Quote snapshots produced by `backend/services/commerce/pricingQuoteRuntime.js`.

This sprint does not implement public APIs, checkout integration, order creation, payment integration, UI, background cleanup workers, HMAC signing, quote refresh, inventory reservation, promotion redemption writes, commits, pushes, or deployment.

## Model Purpose

`backend/models/PricingQuote.js` stores a complete server-generated quote snapshot for future checkout consumption.

A persisted quote is:

- an immutable commercial offer snapshot
- owned by a user and/or session
- short lived as a checkout input
- auditable after expiry or use

A persisted quote is not:

- an order
- a payment
- a wallet transaction
- a supplier reservation
- a promotion redemption consumption

## Model Structure

Top-level fields:

- `quoteId`
- `status`
- `quoteRuntimeVersion`
- `quoteSpecificationVersion`
- `payloadVersion`
- `owner`
- `packageSnapshot`
- `commercialSnapshot`
- `pricingSnapshot`
- `promotionSnapshot`
- `lifecycle`
- `integrityPayload`
- `integrityMetadata`
- `trace`
- `warnings`
- `idempotencyKey`
- `createdBySource`
- `consumedOrderId`
- `invalidationReason`
- `cleanupAt`
- timestamps

The schema is strict at the top level. Runtime snapshots are stored fully in their named snapshot fields.

## Immutable And Mutable Fields

Immutable after creation:

- `quoteId`
- `owner`
- `packageSnapshot`
- `commercialSnapshot`
- `pricingSnapshot`
- `promotionSnapshot`
- `integrityPayload`
- `integrityMetadata`
- `trace`
- `warnings`
- quote/runtime/specification/payload versions
- `lifecycle.issuedAt`
- `lifecycle.expiresAt`

Mutable lifecycle fields:

- `status`
- `lifecycle.status`
- `lifecycle.usedAt`
- `lifecycle.expiredAt`
- `lifecycle.cancelledAt`
- `lifecycle.invalidatedAt`
- `consumedOrderId`
- `invalidationReason`
- `updatedAt`

There is no generic unrestricted update method.

## Status Transitions

Supported states:

- `ISSUED`
- `USED`
- `EXPIRED`
- `INVALIDATED`
- `CANCELLED`

Allowed transitions:

- `ISSUED -> USED`
- `ISSUED -> EXPIRED`
- `ISSUED -> INVALIDATED`
- `ISSUED -> CANCELLED`

Terminal states:

- `USED`
- `EXPIRED`
- `INVALIDATED`
- `CANCELLED`

Terminal quotes cannot transition again.

## Repository API

`backend/services/commerce/pricingQuoteRepository.js` exports:

- `createQuoteRecord({ quote, idempotencyKey, mongoSession })`
- `findQuoteById({ quoteId, mongoSession, lean })`
- `findOwnedQuote({ quoteId, userId, sessionId, mongoSession })`
- `markQuoteUsed({ quoteId, userId, sessionId, consumedOrderId, usedAt, mongoSession })`
- `markQuoteExpired({ quoteId, expiredAt, mongoSession })`
- `invalidateQuote({ quoteId, reason, invalidatedAt, mongoSession })`
- `cancelQuote({ quoteId, cancelledAt, reason, mongoSession })`
- `findExpirableQuotes({ before, limit, mongoSession })`

The repository does not calculate prices, resolve promotions, create orders, process payments, trust client totals, or expose Express request/response objects.

## Ownership Checks

Owned lookup and consumption require:

- `quoteId`
- `userId` or `sessionId`

`findOwnedQuote()` never falls back to quote-only access when ownership is requested.

`markQuoteUsed()` includes ownership in the atomic update filter.

## Idempotency Semantics

`createQuoteRecord()` supports an optional idempotency key.

Rules:

- Same owner + same idempotency key + same canonical commercial payload returns the existing record.
- Same owner + same idempotency key + different canonical commercial payload is rejected.
- Different owners may reuse the same idempotency key.
- Nullable idempotency keys are not globally unique.

## Atomic Consumption

`markQuoteUsed()` performs one conditional database operation.

It updates only when:

- `quoteId` matches
- owner matches
- current status is `ISSUED`
- `lifecycle.status` is `ISSUED`
- `lifecycle.expiresAt > usedAt`
- `consumedOrderId` is valid

Outcomes:

- success
- idempotent retry with same consumed order
- not found or ownership mismatch
- expired
- terminal
- consumption conflict with a different order

The repository does not create the order.

## Expiry Handling

Expiry semantics:

- Quote is invalid at `usedAt >= expiresAt`.
- Repository never marks such quote `USED`.
- `findExpirableQuotes()` returns `ISSUED` quotes with `expiresAt <= before`.
- `markQuoteExpired()` conditionally transitions `ISSUED -> EXPIRED`.
- Repeating expiry on an already expired quote is idempotent.

Correctness does not depend solely on a future background worker.

## Invalidation And Cancellation

`invalidateQuote()` and `cancelQuote()` only update `ISSUED` quotes.

Invalidation requires a reason.

Cancellation may store an optional reason in `invalidationReason` for audit compatibility.

## Indexes

Indexes:

- unique `quoteId`
- `owner.userId + status`
- `owner.sessionId + status`
- `lifecycle.expiresAt + status`
- sparse `consumedOrderId`
- sparse `trace.traceId`
- partial unique `owner.userId + idempotencyKey`
- partial unique `owner.sessionId + idempotencyKey`
- TTL on `cleanupAt`

## Retention And TTL Policy

Quotes are not automatically deleted at `expiresAt`.

Initial policy:

- retain expired and used quotes for audit
- use `cleanupAt` only for future retention cleanup
- never delete active `ISSUED` quotes unexpectedly

No cleanup worker is implemented in this sprint.

## Error Codes

Repository errors are `PricingQuotePersistenceError` with codes:

- `INVALID_QUOTE_RECORD`
- `INVALID_QUOTE_STATUS`
- `INVALID_OWNER`
- `INVALID_IDEMPOTENCY_KEY`
- `QUOTE_ALREADY_EXISTS`
- `IDEMPOTENCY_CONFLICT`
- `QUOTE_NOT_FOUND`
- `QUOTE_OWNERSHIP_MISMATCH`
- `QUOTE_ALREADY_USED`
- `QUOTE_EXPIRED`
- `QUOTE_TERMINAL`
- `QUOTE_CONSUMPTION_CONFLICT`
- `INVALID_ORDER_REFERENCE`
- `INVALID_TRANSITION`
- `PERSISTENCE_FAILURE`

Errors are not Express-specific.

## Transaction Support

Repository methods accept optional `mongoSession`.

Future checkout orchestration can pass a transaction session through quote consumption and order creation. This sprint does not create such a transaction.

## Limitations

Deferred:

- public quote API
- checkout integration
- order creation from quote
- quote refresh
- quote-to-order mapper
- background expiry/cleanup worker
- HMAC signing and key rotation
- integrity verification service
- inventory reservation
- promotion reservation and redemption writes
- admin/customer UI
