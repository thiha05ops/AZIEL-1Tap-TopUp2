"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const runtime = fs.readFileSync(path.join(root, "frontend/js/payment-page-runtime.js"), "utf8");
const application = fs.readFileSync(path.join(root, "backend/services/commerce/tmwPaymentApplicationService.js"), "utf8");

assert(runtime.includes("function showTmwPayment"), "payment page has a dedicated TMW renderer");
assert(runtime.includes("session.qrImage || session.qrUrl || session.qr?.image || session.dynamicQr?.qrImage"), "TMW QR survives both staged and recovered contracts");
assert(runtime.includes("image.id = \"tmwProviderQrImage\"; image.src = qr"), "provider QR is assigned to the payment-page DOM");
assert(runtime.includes("Amount to pay: ฿${Number(session.providerPayableAmount ?? session.amount)"), "TMW page renders the exact provider payable amount");
assert(runtime.includes("session.providerPayableAmount ?? session.amount"), "provider payable amount takes precedence for presentation");
assert(runtime.includes("commerceAmount: payment.commerceAmount ?? payment.amount"), "recovery retains the separate commerce amount");
assert(runtime.includes("tmwPaymentCountdown"), "provider expiry drives a visible countdown");
assert(runtime.includes("/api/commerce/payments/tmw/${encodeURIComponent(attemptId)}"), "status polling uses the read-only TMW status endpoint");
assert(runtime.includes("/refresh"), "reload recovery retrieves detail for the persisted attempt");
assert(!runtime.includes("/api/commerce/checkout/tmw-promptpay`"), "payment-page runtime cannot create a second TMW payment");
assert(runtime.includes("else window.PaymentManual.show(order, session)"), "manual presentation dispatch remains intact");
assert(application.includes("qrImage: payment.qr?.image || \"\""), "application session serializes the provider QR");
assert(application.includes("commerceAmount: payment.amount"), "application retains the 53 THB commerce amount");
assert(application.includes("amount: payment.providerPayableAmount ?? payment.amount"), "application presents 53.08 when TMW returns 5308 satang");
assert(application.includes("paymentInstructions: payment.paymentInstructions || null"), "TMW instructions reach the payment page");

console.log("TMW payment-page presentation verification passed.");
