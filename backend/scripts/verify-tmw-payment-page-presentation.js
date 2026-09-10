"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const runtime = fs.readFileSync(path.join(root, "frontend/js/payment-page-runtime.js"), "utf8");
const application = fs.readFileSync(path.join(root, "backend/services/commerce/tmwPaymentApplicationService.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "frontend/css/commerce/purchase-shell.css"), "utf8");
const page = fs.readFileSync(path.join(root, "frontend/payment.html"), "utf8");

assert(runtime.includes("function showTmwPayment"), "payment page has a dedicated TMW renderer");
assert(/function showCompletion\([^]*?document\.body\.classList\.remove\("tmw-payment-page-active"\);/.test(runtime), "completion removes the active TMW page state");
assert(runtime.includes("session.qrImage || session.qrUrl || session.qr?.image || session.dynamicQr?.qrImage"), "TMW QR survives both staged and recovered contracts");
assert(runtime.includes("image.id = \"tmwProviderQrImage\"; image.src = qr"), "provider QR is assigned to the payment-page DOM");
assert(runtime.includes('mark.innerHTML = \'<i class="fa-solid fa-qrcode"></i>\''), "TMW header uses the existing neutral QR icon facility");
assert(runtime.includes("const payableAmount = Number(session.providerPayableAmount ?? session.amount)"), "TMW page renders the exact provider payable amount");
assert(runtime.includes("session.providerPayableAmount ?? session.amount"), "provider payable amount takes precedence for presentation");
assert(runtime.includes("commerceAmount: payment.commerceAmount ?? payment.amount"), "recovery retains the separate commerce amount");
assert(runtime.includes("tmwPaymentCountdown"), "provider expiry drives a visible countdown");
assert(runtime.includes("/api/commerce/payments/tmw/${encodeURIComponent(attemptId)}"), "status polling uses the read-only TMW status endpoint");
assert(runtime.includes("/refresh"), "reload recovery retrieves detail for the persisted attempt");
assert(!runtime.includes("/api/commerce/checkout/tmw-promptpay`"), "payment-page runtime cannot create a second TMW payment");
const saveHandler = runtime.slice(runtime.indexOf('save.addEventListener("click"'), runtime.indexOf("const guidance"));
assert(saveHandler.includes("image.currentSrc || image.src || qr"), "Save QR uses the currently rendered provider image");
assert(saveHandler.includes('link.download = "aziel-promptpay-qr.png"'), "Save QR uses a stable filename");
assert(!/fetch\s*\(|create_pay|detail_pay|tmw-promptpay/.test(saveHandler), "Save QR performs no provider or checkout request");
assert(runtime.includes("else window.PaymentManual.show(order, session)"), "manual presentation dispatch remains intact");
assert(application.includes("qrImage: payment.qr?.image || \"\""), "application session serializes the provider QR");
assert(application.includes("commerceAmount: payment.amount"), "application retains the 53 THB commerce amount");
assert(application.includes("amount: payment.providerPayableAmount ?? payment.amount"), "application presents 53.08 when TMW returns 5308 satang");
assert(application.includes("paymentInstructions: payment.paymentInstructions || null"), "TMW instructions reach the payment page");
assert(page.includes("Complete your payment to process your order."), "payment page includes the approved subtitle");
assert(page.includes('href="support.html"'), "help card uses AZIEL's existing support destination");
for (const selector of [".tmw-payment-card__header", ".tmw-payment-card__payment", ".tmw-payment-card__save", ".tmw-payment-card__guidance", ".tmw-payment-card__secure", ".payment-page-rail"]) {
    assert(styles.includes(selector), `${selector} presentation is defined`);
}
assert(styles.includes("@media (max-width: 768px)"), "mobile payment layout breakpoint exists");
assert(styles.includes("grid-template-columns: minmax(0, 1fr)"), "mobile payment layout collapses to one column");
assert(/@media \(max-width: 768px\)[^]*?\.tmw-payment-card__status \{[^}]*white-space: nowrap;/.test(styles), "375px waiting status remains on one line");
assert(runtime.includes("figure.hidden = true; save.hidden = true; openQr.hidden = true"), "expired state stops presenting payment controls");
assert(!/console\.(log|warn|error)\([^\n]*(qr|providerPayable)/i.test(runtime), "TMW QR and payable data are not logged");

console.log("TMW payment-page presentation verification passed.");
