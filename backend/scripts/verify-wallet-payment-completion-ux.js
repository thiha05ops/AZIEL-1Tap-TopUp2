const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function storage() {
    const values = new Map();
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key)
    };
}

async function verifyWalletAuthorityAndFailure() {
    const source = read("frontend/js/payment/payment-wallet.js");
    const toasts = [];
    const context = {
        console,
        PaymentUtils: {
            apiUrl: value => value,
            authHeaders: () => ({}),
            hideLoading: () => {},
            showToast: message => toasts.push(message)
        },
        window: {},
        fetch: async () => ({
            ok: true,
            json: async () => ({
                success: true,
                order: { orderId: "AZL-AUTHORITATIVE", amount: 81, currency: "THB" }
            })
        })
    };
    context.window.window = context.window;
    vm.runInNewContext(source, context, { filename: "payment-wallet.js" });

    const success = await context.window.PaymentWallet.pay({ orderId: "STALE-DRAFT", amount: 1, currency: "MMK" });
    assert.equal(success.success, true);
    assert.equal(success.orderId, "AZL-AUTHORITATIVE", "backend order ID must override the draft ID");
    assert.equal(success.amount, 81);
    assert.equal(success.currency, "THB");

    context.fetch = async () => ({
        ok: false,
        json: async () => ({ success: false, message: "Insufficient wallet balance" })
    });
    const failure = await context.window.PaymentWallet.pay({ orderId: "STALE-DRAFT" });
    assert.equal(failure.success, false, "Wallet failures must remain failures");
    assert.deepEqual(toasts, ["Insufficient wallet balance"], "Wallet failure must remain visible on the selection flow");
}

function verifyCompletionHandoff() {
    const source = read("frontend/js/payment/payment-engine.js");
    const sessionStorage = storage();
    const events = [];
    const location = { href: "payment-method.html" };
    const window = {
        location,
        dispatchEvent: event => events.push(event),
        selectedPaymentData: null
    };
    const context = {
        console,
        window,
        sessionStorage,
        localStorage: storage(),
        CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },
        URLSearchParams,
        PaymentUtils: {},
        PaymentWallet: {},
        PaymentPromptPay: {},
        PaymentDeepLink: {},
        PaymentManual: {},
        fetch: async () => { throw new Error("No network expected"); }
    };
    vm.runInNewContext(source, context, { filename: "payment-engine.js" });

    window.AZIEL_PAYMENT.stageWalletCompletion(
        { success: true, orderId: "AZL-RETURNED/42", amount: 81, currency: "THB", order: { orderId: "AZL-RETURNED/42" } },
        { orderId: "STALE-DRAFT", packageName: "Test Package" },
        { key: "wallet", method: "AZIEL Wallet" }
    );

    const staged = JSON.parse(sessionStorage.getItem("azielPaymentPageSession"));
    assert.equal(staged.completion.orderId, "AZL-RETURNED/42");
    assert.equal(staged.orderData.orderId, "AZL-RETURNED/42");
    assert.equal(location.href, "payment.html?orderId=AZL-RETURNED%2F42", "completion must navigate with the exact returned order ID");
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "aziel:payment-completed", "selection controls must be locked before navigation");
}

function verifyPresentationContracts() {
    const wallet = read("frontend/js/payment/payment-wallet.js");
    const engine = read("frontend/js/payment/payment-engine.js");
    const methodPage = read("frontend/js/payment-method-page.js");
    const runtime = read("frontend/js/payment-page-runtime.js");

    assert(!wallet.includes("Admin will process your top-up soon"), "obsolete admin-processing copy must be removed");
    assert(wallet.includes("data.order?.orderId || data.orderId || orderData.orderId"), "returned Commerce order ID must have priority");
    assert(engine.includes("if (!walletResult?.success) return { success: false, navigating: false };"), "failed Wallet payments must not enter completion and must permit the caller to unlock");
    assert(engine.includes("if (orderData.pagePresentation === true)"), "page presentation must use the canonical completion handoff");
    assert(methodPage.includes("if (completed || submitting || !payment?.key) return;"), "completed checkout cannot submit again");
    assert(methodPage.includes('window.addEventListener("aziel:payment-completed"'), "payment selection must lock on success");
    assert(methodPage.includes("grid.inert = true"), "payment methods must be disabled during success navigation");
    assert(runtime.includes("staged?.completion?.paid === true"), "payment page must recognize staged paid Wallet completion");
    assert(runtime.includes("Your payment has been received. Your order is being processed."), "completion copy must be provider-neutral");
    assert(runtime.includes("tracking.html?orderId=${encodeURIComponent(orderId)}"), "Track Order must use the completion order ID");

    const renderIndex = runtime.indexOf("showCompletion({", runtime.indexOf("staged?.completion?.paid === true"));
    const clearDraftIndex = runtime.indexOf('sessionStorage.removeItem("azielProductCheckoutDraft")', renderIndex);
    assert(renderIndex >= 0 && clearDraftIndex > renderIndex, "draft must be cleared only after completion rendering retains its tracking data");

    assert(engine.includes("createCommerceManualPromptPayCheckout(orderData)"), "manual PromptPay checkout remains routed through its existing owner");
    assert(engine.includes("stagePaymentPage(attemptSession, attemptOrder, selectedPayment, type)"), "non-Wallet payment page handoff remains unchanged");
}

async function main() {
    await verifyWalletAuthorityAndFailure();
    verifyCompletionHandoff();
    verifyPresentationContracts();
    console.log("verify-wallet-payment-completion-ux: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
