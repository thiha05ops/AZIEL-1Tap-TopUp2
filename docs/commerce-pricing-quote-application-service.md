# AZIEL Commerce Pricing Quote Application Service

Sprint: 2.4.3

Status: Application service foundation only

This document describes the server-side application service that coordinates trusted context, quote runtime creation, persistence, and owned quote retrieval.

This sprint does not implement Express routes, controllers, public APIs, checkout, quote consumption, order creation, payment integration, wallet behavior, admin UI, storefront UI, deployments, commits, or pushes.

## Purpose

`backend/services/commerce/pricingQuoteApplicationService.js` provides the reusable entry point future APIs and checkout flows can call after they have authenticated the owner and loaded server-owned commerce facts.

The service coordinates:

- trusted package context
- trusted pricing context
- trusted promotion context
- deterministic quote id, issued time, and trace providers
- `createPricingQuote()`
- `createQuoteRecord()`
- owned repository lookup

It does not contain pricing formulas, promotion eligibility rules, Mongo model manipulation, order creation, payment execution, or Express request/response handling.

## Public API

Exports:

- `createAndPersistPricingQuote(input, dependencies?)`
- `getOwnedPricingQuote(input, dependencies?)`
- `toPublicQuote(record, options?)`
- `PricingQuoteApplicationError`
- `ERROR_CODES`
- `WARNING_CODES`
- `APPLICATION_SERVICE_VERSION`

## Trusted Input Boundary

Controllers must construct input from authenticated and server-owned sources.

Client may request:

- package identity
- region
- currency
- intended payment method
- coupon code
- quantity

Client must not supply authoritative:

- supplier cost
- exchange rate
- pricing policy
- pricing rules
- promotion eligibility facts
- usage counters
- original amount
- discount amount
- final amount
- quote timestamps
- quote id unless an upstream trusted service owns it

Coupon code is a request, not proof of eligibility.

## Dependency Injection

The service accepts explicit dependencies:

```js
{
  createPricingQuote,
  createQuoteRecord,
  findOwnedQuote,
  loadPackageContext,
  loadPricingContext,
  loadPromotionContext,
  generateQuoteId,
  getIssuedAt,
  generateTraceId
}
```

Defaults use existing quote runtime and repository functions where safe.

The application service itself does not call `Date.now()`, `Math.random()`, or `crypto.randomUUID()`. Those behaviors belong to injected providers or future controller/service boundaries.

## Orchestration Sequence

`createAndPersistPricingQuote()`:

1. Validates owner, region, currency, package identity, quantity, validity, idempotency key, payment method id, coupon code, and trace metadata.
2. Gets `issuedAt` from injected `getIssuedAt`.
3. Loads or validates trusted package context.
4. Loads or validates trusted pricing context.
5. Loads or validates trusted promotion context when supplied or loader-backed.
6. Gets `quoteId` from injected `generateQuoteId`.
7. Gets `traceId` from input or injected `generateTraceId`.
8. Builds quote runtime input.
9. Calls `createPricingQuote()`.
10. Persists with `createQuoteRecord()`.
11. Returns `{ publicQuote, persistedQuote, metadata }`.

The service does not call `calculateBasePrice()` or `resolvePromotion()` directly because the quote runtime already orchestrates those modules.

## Loader Contracts

`loadPackageContext()` should return package snapshot fields and server-owned availability/catalog facts.

`loadPricingContext()` should return:

```js
{
  pricingInput,
  versionContext
}
```

`loadPromotionContext()` should return:

```js
{
  promotions,
  campaigns,
  context,
  strategy
}
```

Loaders may query databases in future sprints, but this application service does not query MongoDB directly.

## Idempotency Behaviour

The service passes owner-scoped `idempotencyKey` to persistence.

Expected behavior:

- same owner + same key + same commercial payload returns the existing quote
- conflicting same-owner reuse surfaces `IDEMPOTENCY_CONFLICT`
- different owners may reuse the same key
- idempotent reuse maps the public warning `EXISTING_QUOTE_REUSED`

Future production providers should keep quote id and issued time deterministic enough for retry flows or add a repository lookup-first path before quote generation.

## Customer-Safe Mapper

`toPublicQuote()` returns only:

- quote id
- status
- package identity/display summary
- original price
- discount
- unit price
- total amount
- currency
- selected promotion public summary
- issued and expiry timestamps
- mapped warnings

It intentionally excludes:

- supplier cost
- pricing breakdown
- pricing rule internals
- eligibility traces
- rejected promotion details
- canonical integrity payload
- internal audit metadata
- signing metadata
- credentials or secrets

## Owned Quote Retrieval

`getOwnedPricingQuote({ quoteId, owner })`:

- requires userId or sessionId owner binding
- calls repository-owned lookup
- returns customer-safe quote or `null`
- never performs unauthenticated quote lookup
- does not mutate the persisted record

## Error Mapping

Application errors use `PricingQuoteApplicationError`.

Codes:

- `INVALID_APPLICATION_INPUT`
- `INVALID_OWNER`
- `INVALID_PACKAGE_IDENTITY`
- `INVALID_REGION`
- `UNSUPPORTED_CURRENCY`
- `INVALID_QUANTITY`
- `INVALID_VALIDITY_DURATION`
- `INVALID_IDEMPOTENCY_KEY`
- `TRUSTED_CONTEXT_REQUIRED`
- `PACKAGE_CONTEXT_LOAD_FAILED`
- `PRICING_CONTEXT_LOAD_FAILED`
- `PROMOTION_CONTEXT_LOAD_FAILED`
- `QUOTE_RUNTIME_FAILED`
- `QUOTE_PERSISTENCE_FAILED`
- `QUOTE_NOT_FOUND`
- `QUOTE_OWNERSHIP_MISMATCH`
- `IDEMPOTENCY_CONFLICT`
- `APPLICATION_ORCHESTRATION_FAILED`

Lower-level cause codes are preserved in error details where practical.

## Warning Mapping

Customer-safe warning codes:

- `EXISTING_QUOTE_REUSED`
- `NO_PROMOTION_APPLIED`
- `QUOTE_EXPIRES_SOON`
- `SESSION_BOUND_QUOTE`
- `PRICE_VERSION_UNAVAILABLE`

Internal runtime/repository diagnostics are not exposed directly.

## Security Assumptions

- Caller has authenticated or established the owner context.
- Package identity alone is never a trusted price source.
- Client totals are ignored.
- Eligibility facts are server-owned.
- Idempotency keys are owner-scoped.
- Public mapping redacts internal details.
- No payment credentials are accepted or stored.

## Limitations

Deferred:

- Express routes/controllers
- public quote API
- full catalog loader
- full pricing loader
- full promotion loader
- quote refresh
- checkout validation
- quote consumption
- order creation
- payment integration
- promotion redemption writes
- inventory reservation
- admin/customer UI
