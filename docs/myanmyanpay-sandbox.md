# MyanMyanPay sandbox integration

The AZIEL MyanMyanPay integration is sandbox-only and test-user allowlisted. Its callback is:

`POST https://azielplay.com/api/webhooks/myanmyanpay/payment`

Required environment variables (never expose their values to the browser):

```text
MYANMYANPAY_SANDBOX_APP_ID=
MYANMYANPAY_SANDBOX_PUBLISHABLE_KEY=
MYANMYANPAY_SANDBOX_SECRET_KEY=
MYANMYANPAY_SANDBOX_API_BASE_URL=https://ezapi.myanmyanpay.com
```

The payment method code is `myanmyanpay_mmqr` and the provider ID is `MYANMYANPAY`. The database payment method must remain `TEST_ONLY`, require explicit sandbox-test approval, and list authorized user IDs. Payment creation and browser status never settle an order; only the authenticated callback can enter the payment orchestrator.

Provider protocol operations use `mmpay-node-sdk` as the sole authority: `pay()` for creation, `get()` for reconciliation, `cancel()` for supported cancellation, and `listen()` for callback verification. AZIEL wraps the SDK defensively because SDK failures may be returned as resolved values. The wrapper validates response shape, order, amount, currency, status, QR, and safe provider references before any provider result is persisted.

Production credentials and PUBLIC activation are intentionally unsupported.
