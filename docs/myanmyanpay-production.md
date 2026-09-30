# MyanMyanPay Production operations

AZIEL uses the official `mmpay-node-sdk` and keeps MyanMyanPay settlement callback-authoritative. Initiation and reconciliation never settle a payment.

## Render environment variables

Set these names in Render without committing their values:

```text
MYANMYANPAY_ENVIRONMENT=PRODUCTION
MYANMYANPAY_PRODUCTION_APP_ID=
MYANMYANPAY_PRODUCTION_PUBLISHABLE_KEY=
MYANMYANPAY_PRODUCTION_SECRET_KEY=
MYANMYANPAY_PRODUCTION_API_BASE_URL=https://api.myanmyanpay.com
```

Production keys must have the SDK-documented `pk_live_` and `sk_live_` classifications. The API base URL is fail-closed to the exact HTTPS origin above. Sandbox variables remain separate and may stay configured.

The Production webhook remains:

```text
POST https://azielplay.com/api/webhooks/myanmyanpay/payment
```

## Controlled rollout

1. Deploy the repository changes while the PaymentMethod remains `TEST_ONLY` or `DISABLED`.
2. Set the Production variables and redeploy. Missing or malformed configuration keeps the method unavailable.
3. In Admin → Payments → Myanmar, confirm Production configuration and canonical identity readiness.
4. Keep activation `TEST_ONLY`, retain the authorized AZIEL tester, and record controlled Production test approval.
5. Perform one real-money E2E transaction manually. Do not create a second checkout while the first outcome is unknown.
6. Verify provider create status, authenticated callback receipt, PaymentAttempt event/idempotency history, amount/currency/order/reference binding, CommerceOrder `paid`, order `processing`, and customer success observation.
7. Only after independent evidence review, record “Controlled Production E2E evidence verified” and explicit go-live approval.
8. PUBLIC then becomes technically eligible, but must still be selected explicitly by an authorized payment administrator.

Rollback is immediate: set the PaymentMethod activation to `DISABLED`. Existing callbacks remain verifiable because callback credentials are selected from the stored PaymentAttempt environment.
