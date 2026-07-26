# AZIEL Commerce Provider Adapter Layer

Sprint: 2.6.3

Status: Provider abstraction only

This document describes the provider adapter and registry layer introduced for Commerce payment orchestration.

No real Omise, PromptPay, Wallet, provider SDK, HTTP client, QR generator, wallet ledger, webhook route, controller, frontend, fulfillment, deployment, commit, or push is included in this sprint.

## Audit Findings

The approved Commerce foundation now has:

- a quote-backed `CommerceOrder`
- a pure Payment Orchestrator runtime
- a `PaymentAttempt` model and repository
- explicit Commerce error conventions
- injected dependency boundaries
- safe public result redaction

Before this sprint, the orchestrator could accept an injected provider adapter but there was no canonical adapter contract or registry. Sprint 2.6.3 adds that contract without implementing real providers.

## Provider Adapter Architecture

File: `backend/services/commerce/providerAdapter.js`

The adapter layer defines a provider identity and a common method contract:

- `createPayment()`
- `refreshPayment()`
- `cancelPayment()`
- `expirePayment()`
- `queryPayment()`
- `handleProviderEvent()`
- `normalizeProviderResponse()`
- `normalizeProviderEvent()`
- `validateConfiguration()`
- `supportsCapability()`

`createProviderAdapter(config)` can create abstract adapters from provider configuration and optional fake/runtime handlers. Missing handler methods fail clearly with `PAYMENT_PROVIDER_METHOD_NOT_IMPLEMENTED`.

The adapter layer does not call SDKs, HTTP APIs, QR generation, or wallet ledger code.

## Provider Identity

Each provider exposes:

- `providerId`
- `displayName`
- `version`
- `supportedCurrencies`
- `supportedPaymentMethods`
- `supportedCapabilities`
- `environment`

Provider ids are public-safe bounded identifiers. Currency codes are normalized uppercase.

## Registry Architecture

File: `backend/services/commerce/providerRegistry.js`

The registry owns runtime provider registration and resolution.

Methods:

- `registerProvider()`
- `unregisterProvider()`
- `resolveProvider()`
- `listProviders()`
- `providerExists()`
- `listCapabilities()`
- `validateProvider()`
- `freezeRegistry()`

Registry entries are immutable after registration. Once `freezeRegistry()` is called, registration and unregistration are rejected.

## Resolution Rules

Providers can be resolved by:

- explicit trusted `providerId`
- trusted order/payment `provider`
- trusted `paymentMethod`
- trusted intent payment fields

The registry is not a browser-trust boundary. Future routes/controllers must resolve providers from server-owned `CommerceOrder` or `PaymentMethod` data.

## Capability Model

Supported capability constants:

- `CREATE_PAYMENT`
- `QUERY_PAYMENT`
- `REFRESH_PAYMENT`
- `CANCEL_PAYMENT`
- `EXPIRE_PAYMENT`
- `WEBHOOK`
- `REDIRECT`
- `QR_CODE`
- `MANUAL_APPROVAL`
- `REFUND`

The registry exposes per-provider capabilities and aggregate capabilities. Unsupported required capabilities fail validation.

## Normalized Response Contract

Canonical provider response:

- `provider`
- `providerReference`
- `providerTransactionId`
- `status`
- `amount`
- `currency`
- `expiresAt`
- `redirect`
- `qr`
- `instructions`
- `paymentInstructions`
- `failure`
- `metadata`
- `safeMetadata`
- `rawStatus`

Malformed responses are rejected with `PAYMENT_PROVIDER_RESPONSE_INVALID`.

Metadata is detached and redacted. Unsafe fields such as raw payloads, signatures, API keys, authorization values, secrets, tokens, card data, and bank account data are removed.

## Normalized Event Contract

Canonical provider event:

- `provider`
- `providerReference`
- `providerTransactionId`
- `providerEventId`
- `eventType`
- `paymentStatus`
- `status`
- `amount`
- `currency`
- `occurredAt`
- `metadata`
- `safeMetadata`

Malformed events are rejected with `PAYMENT_PROVIDER_EVENT_INVALID`.

The adapter layer does not implement webhook signature verification. Future concrete adapters or webhook boundaries must verify raw provider input before passing normalized events to the orchestrator.

## Validation Behaviour

Provider validation checks:

- required adapter methods
- provider identity
- supported currencies
- supported payment methods
- required capabilities
- duplicate provider ids
- immutable registry state

Validation errors use safe metadata only.

## Error Contract

Adapter errors:

- `PAYMENT_PROVIDER_INVALID`
- `PAYMENT_PROVIDER_CONFIGURATION_INVALID`
- `PAYMENT_PROVIDER_CAPABILITY_UNSUPPORTED`
- `PAYMENT_PROVIDER_RESPONSE_INVALID`
- `PAYMENT_PROVIDER_EVENT_INVALID`
- `PAYMENT_PROVIDER_METHOD_NOT_IMPLEMENTED`

Registry errors:

- `PAYMENT_PROVIDER_NOT_FOUND`
- `PAYMENT_PROVIDER_DUPLICATE`
- `PAYMENT_PROVIDER_INVALID`
- `PAYMENT_PROVIDER_CONFIGURATION_INVALID`
- `PAYMENT_PROVIDER_CAPABILITY_UNSUPPORTED`
- `PAYMENT_PROVIDER_RESPONSE_INVALID`
- `PAYMENT_PROVIDER_EVENT_INVALID`
- `PAYMENT_PROVIDER_REGISTRY_FROZEN`

## Immutability

Adapters are deeply frozen after creation.

Registry provider summaries are detached and frozen.

Normalized provider responses and events are detached and frozen.

The registry can be frozen globally to lock runtime provider registration.

## Deferred Work

Deferred to later sprints:

- Provider Registry persistence
- Omise adapter
- PromptPay adapter
- Wallet adapter
- provider SDK integrations
- provider HTTP clients
- QR generation
- wallet ledger execution
- webhook HTTP endpoints
- routes and controllers
- frontend checkout integration
- fulfillment integration
- refunds
