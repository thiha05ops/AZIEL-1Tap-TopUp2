# Commerce Manual Payment Application Integration

## Audit Findings

The existing public manual payment flow remains concentrated in `backend/routes/payment.js` and the legacy `ManualPaymentAttempt` model. That flow owns the current public checkout/recovery UI contract, slip upload, and legacy order creation timing.

The Commerce stack now has separate ownership:

- `CommerceOrder` persists quote checkout orders.
- `PaymentAttempt` persists Commerce payment attempts.
- `paymentOrchestrator` owns payment lifecycle transitions.
- `manualPromptPayAdapter` owns Manual PromptPay QR/provider behaviour.
- `orderRepository` and `paymentAttemptRepository` own persistence and conditional updates.

The new application integration does not delete or broadly modify the legacy flow. It adds Commerce-specific routes and a service boundary for CommerceOrder manual PromptPay payments.

## Compatibility Strategy

Selected strategy: new Commerce routes exist alongside legacy routes, but CommerceOrder payment state changes flow only through the new application service and Payment Orchestrator.

Legacy `ManualPaymentAttempt` remains temporarily active for the existing frontend/recovery flow. It is not dual-written as an authority for CommerceOrder payments in this sprint. The new application DTO maps Commerce results into a frontend-safe QR/payment shape, allowing a later frontend migration without exposing provider internals.

## Application Service API

`backend/services/commerce/manualPaymentApplicationService.js` exposes:

- `initiateManualPayment(input)`
- `getManualPayment(input)`
- `attachReceiptEvidence(input)`
- `approveManualPayment(input)`
- `rejectManualPayment(input)`
- `expireManualPayment(input)`
- `cancelManualPayment(input)`

The service is dependency-injected and composes:

- Commerce order repository
- Payment attempt repository
- Payment orchestrator
- Manual PromptPay provider factory
- receipt evidence boundary
- transaction runner
- audit logger
- notification port

## Route and Controller Boundary

`backend/controllers/commerceManualPaymentController.js` translates HTTP requests to service calls and maps safe errors. `backend/routes/commerceManualPaymentRoutes.js` registers narrow named operations:

- `POST /api/commerce/orders/:orderId/payments/manual-promptpay/initiate`
- `GET /api/commerce/orders/:orderId/payments/manual-promptpay`
- `POST /api/commerce/orders/:orderId/payments/:attemptId/receipt`
- `POST /api/commerce/orders/:orderId/payments/:attemptId/cancel`
- `POST /api/admin/commerce/payments/:attemptId/approve`
- `POST /api/admin/commerce/payments/:attemptId/reject`

Routes are thin. They do not directly mutate `CommerceOrder`, `PaymentAttempt`, or payment status.

## Owner Security

Customer operations require authenticated owner context. The service loads CommerceOrder and PaymentAttempt through owner-safe repository methods. Another owner receives a not-found result rather than access to another user's payment.

## Admin RBAC

Admin approval and rejection routes use `adminMiddleware` plus `requireAdminPermission(PERMISSIONS.ORDERS_MANAGE)`. The service validates that the admin identity exists before creating a trusted manual verification event.

## Initiation Flow

1. Validate owner.
2. Load owner-safe CommerceOrder.
3. Confirm the order is Manual PromptPay.
4. Build idempotency input.
5. Call `paymentOrchestrator.initiatePayment()`.
6. Return safe QR/payment DTO.

Amount, currency, payment method, provider, recipient, and provider reference are all server-owned. QR generation returns `PENDING` only and fulfilment remains `not_started`.

## Receipt Evidence Flow

Receipt evidence is safe metadata, not payment confirmation. The service accepts a compact evidence contract:

```js
{
  receiptId,
  attemptId,
  orderId,
  fileReference,
  mimeType,
  fileSize,
  checksum,
  uploadedAt
}
```

`PaymentAttempt.safeMetadata.receiptEvidence` stores the compact evidence. `CommerceOrder.operationalReferences` receives a safe reference. Raw binary, unsafe local paths, browser amount, and browser-declared paid status are not persisted.

## Approval Flow

Approval requires an authorised admin and existing receipt evidence. The service creates a trusted operational event:

- provider: `MANUAL_PROMPTPAY`
- event type: `MANUAL_PAYMENT_APPROVED`
- amount/currency: persisted attempt values
- provider reference: persisted attempt reference
- verifier metadata: compact admin identity only

The Payment Orchestrator applies the event, appends provider event history, updates `PaymentAttempt` to `PAID`, and updates `CommerceOrder.paymentStatus` to `paid`. Fulfilment remains unchanged.

## Rejection and Retry Flow

Rejection uses `MANUAL_PAYMENT_REJECTED` and maps to `FAILED`. A retry after failed initiation creates a new linked attempt with a new provider reference. The old receipt remains attached to the old attempt.

## Expiry and Cancellation

Expiry and cancellation are named operations. They use the orchestrator and repository transition rules. Cancellation is local attempt cancellation only and does not reverse a bank transfer.

## Transaction Semantics

Approval and rejection state transitions remain transaction-owned by the Payment Orchestrator and repositories. Receipt evidence binding uses the injected transaction runner to coordinate `PaymentAttempt` receipt metadata and `CommerceOrder` operational reference.

No nested transactions are introduced.

## File Storage Compensation

External file storage cannot be rolled back by MongoDB. If storage succeeds but DB evidence binding fails, the application reports a persistence/evidence-binding failure and leaves payment state unchanged. Cleanup/retry remains a caller-side operational responsibility.

## Idempotency

Initiation uses owner, order, idempotency key, and orchestrator fingerprinting. Existing active attempts prevent duplicate QR generation. Duplicate provider event IDs are idempotent through `PaymentAttempt.eventHistory`.

Receipt evidence with the same checksum and attempt binding returns existing evidence safely.

## Error Mapping

The controller maps application errors to safe HTTP responses:

- validation: `400`
- unauthenticated: `401`
- forbidden: `403`
- not found: `404`
- idempotency/invalid state: `409`
- unsupported payment method: `422`
- provider unavailable: `503`
- persistence/internal failures: `500`

Stack traces, raw provider metadata, raw receipt paths, and admin-only metadata are not returned.

## Audit and Notification Boundaries

The application service exposes audit hooks for:

- manual payment initiated
- receipt attached
- manual payment approved
- manual payment rejected

Notification hooks run after service operations. Notification failure is logged and does not roll back committed payment state.

## Frontend Compatibility Contract

The safe response includes:

- order ID
- attempt ID
- payment status
- amount
- currency
- dynamic QR image and payload
- payment instructions
- expiry
- receipt evidence status
- retry eligibility
- safe failure information

It does not include owner ID, Mongo internals, raw provider metadata, raw receipt storage paths, admin verifier identity, or provider event history.

## Deferred Frontend Migration

No frontend code is changed in this sprint. Existing public manual payment UI remains on legacy routes until a dedicated migration pass switches checkout to the new Commerce endpoints.

## Rollback Plan

Because no legacy route is removed and no frontend is migrated, rollback is limited to disabling/removing the new Commerce manual routes and application service. Existing legacy manual payment behaviour remains available.
