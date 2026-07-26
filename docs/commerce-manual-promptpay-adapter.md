# Commerce Manual PromptPay Provider Adapter

## Scope

The Manual PromptPay adapter is the Commerce provider adapter for Thailand manual PromptPay QR payments. It is runtime-only provider plumbing for the Commerce payment core. It does not add checkout UI, admin UI, HTTP routes, provider SDKs, bank APIs, webhooks, automatic verification, fulfilment, refunds, or wallet debit.

## Identity

- Provider ID: `MANUAL_PROMPTPAY`
- Display name: `Manual PromptPay`
- Adapter version: `1`
- Supported currency: `THB`
- Supported payment method identifiers: `PROMPTPAY`, `promptpay`, `aziel_promptpay_dynamic`
- Capabilities: `CREATE_PAYMENT`, `QUERY_PAYMENT`, `REFRESH_PAYMENT`, `EXPIRE_PAYMENT`, `QR_CODE`, `MANUAL_APPROVAL`

The adapter intentionally does not claim `WEBHOOK`, `REFUND`, `REDIRECT`, or external `CANCEL_PAYMENT`. Manual local cancellation can be normalized for Commerce state, but it does not reverse or contact any bank transfer.

## Configuration Contract

```js
{
  providerId: "MANUAL_PROMPTPAY",
  recipientType: "PHONE" | "NATIONAL_ID" | "TAX_ID",
  recipientValue: "server-owned PromptPay recipient",
  recipientDisplayName: "AZIEL PromptPay",
  defaultExpiryMinutes: 15,
  environment: "production",
  enabled: true,
  referencePrefix: "AZL"
}
```

Configuration is validated at adapter creation. Disabled providers, invalid recipient types, malformed PromptPay recipient values, invalid expiry windows, unsupported environments, and non-THB payment intents fail closed. The browser must never supply or override the recipient.

## Create Payment

`createPayment()` receives the Commerce `intent` and durable `PaymentAttempt` from the orchestrator. It:

1. Reads the canonical order amount and currency from the server-owned intent.
2. Rejects non-THB or invalid amounts.
3. Builds a server-owned provider reference from the configured prefix, order ID, and attempt ID.
4. Calls the existing `promptPayQrService.createPromptPayQr()` utility with the configured recipient and bound reference.
5. Returns a normalized `PENDING` result with the dynamic QR payload/image, expiry, manual instructions, and safe metadata.

QR generation never returns or implies `PAID`.

## QR Ownership

The adapter reuses the existing PromptPay utility that validates:

- PromptPay recipient format
- THB currency
- positive amount with maximum two decimals
- EMV tag ordering
- additional data tag `62` reference label
- CRC
- generated PNG payload matching the QR payload

The QR uses the server-owned provider reference and amount. It does not accept a recipient or reference override from the browser.

## Refresh and Query

Manual PromptPay has no bank API status query. `refreshPayment()` and `queryPayment()` only reflect repository-owned state and expiry:

- `PENDING` remains `PENDING`
- expired active attempts may return `EXPIRED`
- terminal states remain terminal

Receipt uploads, bank app launches, QR scans, screenshots, and browser actions never mark a payment as paid.

## Expire and Cancel

`expirePayment()` is idempotent for already expired attempts and valid only for active states.

`cancelPayment()` returns a safe local `CANCELLED` normalized result for active attempts so the Commerce orchestrator can close the attempt, but the adapter does not claim an external cancellation capability.

## Receipt Boundary

Receipt/slip upload metadata is evidence only. Safe metadata may include compact fields such as receipt ID, file name, content type, and uploaded timestamp. It must not include raw file payloads, secrets, credentials, or customer-sensitive data. Uploading a receipt never changes payment state by itself.

## Manual Verification Event

Trusted operational approval is represented as:

```js
{
  provider: "MANUAL_PROMPTPAY",
  providerEventId: "unique-event-id",
  providerReference: "server-owned-reference",
  eventType: "MANUAL_PAYMENT_APPROVED",
  paymentStatus: "PAID",
  amount: 1490,
  currency: "THB",
  occurredAt: "ISO timestamp",
  metadata: {
    verifiedBy: "admin-id",
    verificationMethod: "admin_manual",
    receiptId: "receipt-id",
    note: "optional note"
  }
}
```

Manual rejection uses `MANUAL_PAYMENT_REJECTED` and maps to `FAILED`. This policy keeps the attempt terminal and forces a new payment attempt if the customer must retry.

The adapter validates:

- trusted operational boundary
- provider ID
- provider reference
- amount
- currency
- terminal status safety
- receipt evidence for approval

Authorization and RBAC belong to the future controller that creates the trusted operational event. The adapter only accepts already-trusted operational input.

## Duplicate and Concurrency Policy

The adapter has no in-memory locks. Duplicate active payments, duplicate event IDs, and conditional state transitions remain owned by the Commerce payment orchestrator and `PaymentAttempt` repository.

## Safe Public Metadata

Public/payment result metadata may include:

- provider ID
- order ID
- attempt ID
- quote ID
- confirmation mode
- recipient type
- recipient display name
- masked recipient
- receipt requirement
- provider reference

Raw recipient values, secrets, webhook signatures, API keys, authorization headers, and raw provider payloads must never be returned.

## Integration

The factory exposes:

- `createManualPromptPayProvider(options)`
- `registerManualPromptPayProvider(registry, options)`

The Commerce provider registry can resolve the adapter by provider ID or supported PromptPay payment method IDs. The payment orchestrator now delegates manual approval event validation to adapters that explicitly support `MANUAL_APPROVAL`, while non-manual providers retain the existing generic event path.

## Verification

`npm run verify:commerce-manual-promptpay-adapter` covers:

- provider registration and resolution
- declared capabilities
- THB-only payment creation
- dynamic QR response ownership
- server-owned recipient/reference binding
- pending-only QR initiation
- no fulfilment completion
- active attempt reuse
- refresh/expire/cancel boundaries
- trusted manual approval and rejection
- duplicate event handling through the orchestrator
- amount/currency/receipt/trust safety failures
- safe metadata redaction
