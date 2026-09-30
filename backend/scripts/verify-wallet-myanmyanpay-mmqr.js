"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { PRODUCTION_API_BASE_URL } = require("../services/myanmyanpay/myanMyanPayConfiguration");
const { myanMyanPayAccessDecision } = require("../services/myanmyanpay/myanMyanPayPaymentPolicy");
const { assertMmWalletTopup, assertThWalletTopup } = require("../services/walletTopupPolicy");

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

const route = read("backend/routes/wallet.js");
const frontend = read("frontend/js/wallet.js");
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
assert(frontend.includes('safeWalletResponseMessage'), "bounded 4xx messages must be supported");
assert(frontend.includes('wt("serverError", "Server error")'), "unknown/network failures must remain generic");
assert(adapter.includes("assertWalletTopup"), "wallet payable subject must use multi-market authoritative policy");
assert(application.includes("createMyanMyanPayAdapter"), "existing provider adapter must be reused");
assert(orchestrator.includes("case SUBJECT_TYPES.WALLET_TOPUP"), "paid wallet subject must use wallet settlement effects");
assert(!orchestrator.slice(orchestrator.indexOf("case SUBJECT_TYPES.WALLET_TOPUP"), orchestrator.indexOf("default:", orchestrator.indexOf("case SUBJECT_TYPES.WALLET_TOPUP"))).includes("runPostCommitPaidFulfillment"), "wallet top-up must not enter CommerceOrder fulfillment");

console.log("Wallet MyanMyanPay MMQR verification passed.");
