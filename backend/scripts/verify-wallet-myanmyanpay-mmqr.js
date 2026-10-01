"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { PRODUCTION_API_BASE_URL } = require("../services/myanmyanpay/myanMyanPayConfiguration");
const { myanMyanPayAccessDecision } = require("../services/myanmyanpay/myanMyanPayPaymentPolicy");
const { assertMmWalletTopup, assertThWalletTopup } = require("../services/walletTopupPolicy");
const { createManualPaymentApplicationService } = require("../services/commerce/manualPaymentApplicationService");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const TEST_USER_ID = "507f1f77bcf86cd799439011";
const env = {
    MYANMYANPAY_ENVIRONMENT: "PRODUCTION",
    MYANMYANPAY_PRODUCTION_APP_ID: "APP-LIVE",
    MYANMYANPAY_PRODUCTION_PUBLISHABLE_KEY: "pk_live_example",
    MYANMYANPAY_PRODUCTION_SECRET_KEY: "sk_live_example",
    MYANMYANPAY_PRODUCTION_API_BASE_URL: PRODUCTION_API_BASE_URL
};
const method = {
    key: "myanmyanpay_mmqr",
    provider: "myanmyanpay_mmqr",
    paymentChannel: "MYANMYANPAY_MMQR",
    confirmationMode: "provider_webhook",
    paymentType: "auto",
    region: "MM",
    enabled: true,
    myanMyanPayProductionTestApproved: true,
    myanMyanPayProductionTestVerified: true,
    myanMyanPayGoLiveApproved: true,
    myanMyanPayAuthorizedTestUserIds: [TEST_USER_ID]
};

assert.deepStrictEqual(assertMmWalletTopup({ amount: 1000, region: "MM", currency: "MMK" }), { amount: 1000, region: "MM", currency: "MMK" });
assert.throws(() => assertMmWalletTopup({ amount: 1000, region: "TH", currency: "MMK" }));
assert.throws(() => assertMmWalletTopup({ amount: 1000, region: "MM", currency: "THB" }));
assert.deepStrictEqual(assertThWalletTopup({ amount: 100, region: "TH", currency: "THB" }), { amount: 100, region: "TH", currency: "THB" });

assert.strictEqual(myanMyanPayAccessDecision({ ...method, myanMyanPayActivationState: "DISABLED" }, { id: TEST_USER_ID }, env).allowed, false);
assert.strictEqual(myanMyanPayAccessDecision({ ...method, myanMyanPayActivationState: "TEST_ONLY" }, { id: "unauthorized" }, env).allowed, false);
assert.strictEqual(myanMyanPayAccessDecision({ ...method, myanMyanPayActivationState: "TEST_ONLY" }, { id: TEST_USER_ID }, env).allowed, true);
assert.strictEqual(myanMyanPayAccessDecision({ ...method, myanMyanPayActivationState: "PUBLIC" }, { id: "public-user" }, env).allowed, true);

const persistedInitiatedAt = "2026-10-01T04:05:06.000Z";
const safeWalletPayment = createManualPaymentApplicationService().toSafePaymentView({
    order: {
        topupId: "WALLET-MMQR-EXPIRY-TEST",
        payment: { provider: "WRONG_ORDER_PROVIDER", paymentChannel: "WRONG_ORDER_CHANNEL" }
    },
    attempt: {
        attemptId: "paymentAttempt-wallet-mmqr-expiry-test",
        subjectType: "WALLET_TOPUP",
        subjectId: "WALLET-MMQR-EXPIRY-TEST",
        status: "PENDING",
        provider: "MYANMYANPAY",
        paymentChannel: "MYANMYANPAY_MMQR",
        confirmationMode: "provider_webhook",
        paymentMethod: "myanmyanpay_mmqr",
        amount: 1000,
        currency: "MMK",
        region: "MM",
        createdAt: persistedInitiatedAt,
        paymentInstructions: { requiresReceiptUpload: false, confirmationMode: "provider_webhook" }
    },
    paymentResult: { paymentChannel: "WRONG_RESULT_CHANNEL" }
});
assert.strictEqual(safeWalletPayment.provider, "MYANMYANPAY", "typed Wallet initiation must expose the persisted provider");
assert.strictEqual(safeWalletPayment.paymentChannel, "MYANMYANPAY_MMQR", "typed Wallet initiation must expose the attempt's persisted channel before fallback sources");
assert.strictEqual(safeWalletPayment.confirmationMode, "provider_webhook", "typed Wallet initiation must expose webhook confirmation mode");
assert.strictEqual(safeWalletPayment.initiatedAt, persistedInitiatedAt, "typed Wallet initiation timestamp must remain PaymentAttempt.createdAt");
assert.strictEqual(safeWalletPayment.paymentInstructions.requiresReceiptUpload, false, "typed Wallet MMQR presentation must remain receipt-free");

const route = read("backend/routes/wallet.js");
const frontend = read("frontend/js/wallet.js");
const checkoutSheet = read("frontend/js/payment/payment-checkout-sheet.js");
const lifecycle = read("frontend/js/payment/myanmyanpay-qr-lifecycle.js");
const checkoutCss = read("frontend/css/payment/payment-checkout-sheet.css");
const adapter = read("backend/services/commerce/walletTopupPayableSubjectAdapter.js");
const orchestrator = read("backend/services/commerce/paymentOrchestrator.js");
const application = read("backend/services/commerce/manualPaymentApplicationService.js");

for (const token of [
    'isMyanMyanPayMethod(method)',
    'normalizeMethod(method.provider) === "myanmyanpaymmqr"',
    '"MYANMYANPAY_MMQR"',
    '"provider_webhook"',
    'myanMyanPayAccessDecision(resolved.method, req.user).allowed !== true',
    'subjectType: "WALLET_TOPUP"'
]) assert(route.includes(token), `wallet route missing ${token}`);

assert(frontend.includes('!isMyanMyanPayWalletPayment(payment)'), "non-TH MyanMyanPay must bypass the legacy route");
assert(frontend.includes('paymentMethod,\n                region,\n                currency'), "typed creation must send market selection for server validation");
assert(frontend.includes('typedPayment.paymentInstructions?.requiresReceiptUpload === true'), "MMQR must not require a receipt");
assert(frontend.includes('paymentChannel: data.paymentChannel || info.method?.paymentChannel || ""'), "Wallet must pass the authoritative typed payment channel into the checkout presentation");
assert(frontend.includes('confirmationMode,'), "Wallet must pass the typed confirmation mode into the checkout presentation");
assert(frontend.includes('initiatedAt: data.initiatedAt || ""'), "Wallet must pass the persisted initiation timestamp into the expiry lifecycle");
assert(application.includes('paymentChannel: normalizeString(attempt.paymentChannel || order.payment?.paymentChannel || source.paymentChannel)'), "safe payment projection must prefer the persisted PaymentAttempt channel");
for (const token of [
    'String(options.provider || "").toUpperCase() === "MYANMYANPAY"',
    'String(options.paymentChannel || "").toUpperCase() === "MYANMYANPAY_MMQR"',
    'String(options.confirmationMode || "").toLowerCase() === "provider_webhook"',
    'options.requiresSlip === false'
]) assert(checkoutSheet.includes(token), `strict Wallet MMQR lifecycle identity missing ${token}`);
assert(checkoutSheet.includes('submit.hidden = !activeState.requiresSlip'), "receipt-free provider payments must hide the manual verification action");
assert(checkoutSheet.includes('continueBtn.hidden = !isMobileFlow || step !== "qr" || autoSubmitReceipt || !activeState.requiresSlip'), "receipt-free provider payments must hide the mobile manual-confirmation action");
assert(frontend.includes('startTypedWalletStatusPolling(activeWalletManualIntent.topupId, activeWalletManualIntent.attemptId)'), "MMQR wallet checkout must start authoritative status observation");
assert(frontend.includes('/api/wallet/topups/${encodeURIComponent(topupId)}'), "MMQR status observation must use the authenticated typed top-up endpoint");
assert(frontend.includes('credentials: "same-origin"'), "MMQR status observation must preserve session authentication");
assert(frontend.includes('cache: "no-store"'), "MMQR status observation must bypass stale status caches");
assert(frontend.includes('"Your payment will be confirmed automatically."'), "MMQR must show concise automatic-confirmation guidance");
assert(lifecycle.includes("const VALIDITY_MS = 15 * 60 * 1000"), "MMQR validity must be centralized at fifteen minutes");
assert(lifecycle.includes("const deadlineMs = startedAtMs + VALIDITY_MS"), "MMQR timer must derive its deadline from the server initiation timestamp");
for (const token of ["Pay within {time}", "{time} အတွင်း ငွေပေးချေပါ", "ชำระเงินภายใน {time}", "QR Expired", "QR သက်တမ်းကုန်သွားပါပြီ", "QR หมดอายุแล้ว"]) assert(lifecycle.includes(token), `MMQR lifecycle translations missing ${token}`);
assert(checkoutSheet.includes('startMyanMyanPayExpiry(activeState)'), "Wallet MMQR checkout must start the shared expiry presentation");
assert(checkoutSheet.includes('options.onStartFresh?.()'), "Wallet fresh-top-up action must return through its caller without retrying an attempt");
assert(checkoutCss.includes("background: rgba(9, 8, 20, .96)"), "expired Wallet QR must have an opaque anti-scan overlay");
const typedPoll = frontend.slice(frontend.indexOf("function startTypedWalletStatusPolling"), frontend.indexOf("function stopWalletPolling"));
assert(!/method:\s*["']POST["']/.test(typedPoll), "MMQR observation must remain read-only");
assert(!/markPaid|creditWallet|settlePaidWalletTopup/.test(typedPoll), "browser polling must not claim payment or wallet-credit authority");
assert(typedPoll.includes('settlementStatus === "credited" || topupStatus === "completed"'), "wallet success UI must wait for authoritative server-side credit completion");
assert(checkoutSheet.includes('if (!isMobileFlow && submit) submit.hidden = !activeState.requiresSlip || autoSubmitReceipt || !activeState.transferConfirmed;'), "receipt-required desktop flows must retain transfer-confirmation gating");
assert(frontend.includes('safeWalletResponseMessage'), "bounded 4xx messages must be supported");
assert(frontend.includes('wt("serverError", "Server error")'), "unknown/network failures must remain generic");
assert(adapter.includes("assertWalletTopup"), "wallet payable subject must use multi-market authoritative policy");
assert(application.includes("createMyanMyanPayAdapter"), "existing provider adapter must be reused");
assert(orchestrator.includes("case SUBJECT_TYPES.WALLET_TOPUP"), "paid wallet subject must use wallet settlement effects");
assert(!orchestrator.slice(orchestrator.indexOf("case SUBJECT_TYPES.WALLET_TOPUP"), orchestrator.indexOf("default:", orchestrator.indexOf("case SUBJECT_TYPES.WALLET_TOPUP"))).includes("runPostCommitPaidFulfillment"), "wallet top-up must not enter CommerceOrder fulfillment");

console.log("Wallet MyanMyanPay MMQR verification passed.");
