(function () {
    const t = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback;
    const DRAFT_KEY = "azielProductCheckoutDraft";
    const PAYMENT_SESSION_KEY = "azielPaymentPageSession";
    const authority = window.AZIEL_PAYMENT_SESSION_AUTHORITY;
    let draft = null;
    let activeTransaction = null;
    let submitting = false;

    function money(amount, currency) {
        return `${Number(amount || 0).toLocaleString()} ${String(currency).toUpperCase() === "THB" ? "฿" : "Ks"}`;
    }

    function update() {
        const payment = window.selectedPaymentData;
        const button = document.getElementById("methodContinue");
        if (button) button.disabled = Boolean(!payment?.key || submitting);
        const feedback = document.getElementById("methodFeedback");
        if (feedback) {
            const activeKey = activeTransaction?.selectedPayment?.key;
            feedback.textContent = activeKey && payment?.key && payment.key !== activeKey
                ? t("payment.activeConflict", "An active payment already exists. Resume it before changing payment method.")
                : payment?.key ? t("payment.continueWith", "Continue with {method}.", { method: payment.method || payment.key }) : t("payment.selectMethod", "Select a payment method.");
        }
    }

    async function continueToPayment() {
        const payment = window.selectedPaymentData;
        if (submitting || !payment?.key) return;
        if (activeTransaction?.session?.attemptId && authority?.stagedSessionMatchesDraft(activeTransaction, draft)) {
            const activeKey = activeTransaction.selectedPayment?.key || activeTransaction.session?.paymentMethod;
            if (activeKey && payment.key !== activeKey) { update(); return; }
            const orderId = authority?.orderId(activeTransaction) || "";
            const params = new URLSearchParams({ attemptId: activeTransaction.session.attemptId });
            if (orderId) params.set("orderId", orderId);
            window.location.href = `payment.html?${params.toString()}`;
            return;
        }
        if (!draft?.review?.quoteId) return;
        submitting = true;
        update();
        const pricing = draft.review.pricing || {};
        await window.AZIEL_PAYMENT.start({
            ...draft.order,
            checkoutKey: draft.order.orderId,
            amount: pricing.quotedTotalAmount,
            currency: pricing.currency,
            reviewQuoteId: draft.review.quoteId,
            paymentMethod: payment.key,
            paymentType: payment.paymentType || "manual",
            provider: payment.provider || "manual",
            pagePresentation: true
        });
        submitting = false;
        update();
    }

    document.addEventListener("DOMContentLoaded", () => {
        try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null"); } catch (_) { draft = null; }
        try { activeTransaction = JSON.parse(sessionStorage.getItem(PAYMENT_SESSION_KEY) || "null"); } catch (_) { activeTransaction = null; }
        if (draft?.review?.quoteId && !authority?.stagedSessionMatchesDraft(activeTransaction, draft)) {
            activeTransaction = null;
            sessionStorage.removeItem(PAYMENT_SESSION_KEY);
        }
        if (!draft?.order && !activeTransaction?.orderData) { window.location.replace("checkout.html"); return; }
        if (activeTransaction?.orderData && authority?.stagedSessionMatchesDraft(activeTransaction, draft)) {
            draft = { ...draft, order: activeTransaction.orderData, review: draft?.review || {} };
        }
        document.getElementById("methodProduct").textContent = draft.order.game;
        document.getElementById("methodPackage").textContent = draft.order.packageName;
        document.getElementById("methodTotal").textContent = money(draft.review.pricing?.quotedTotalAmount, draft.review.pricing?.currency);
        if (activeTransaction?.session && authority?.stagedSessionMatchesDraft(activeTransaction, draft)) {
            document.getElementById("methodTotal").textContent = money(activeTransaction.session.amount, activeTransaction.session.currency);
            document.getElementById("methodFeedback").textContent = t("payment.activeReady", "An active payment is ready to resume.");
        }
        document.addEventListener("paymentChanged", update);
        document.getElementById("methodContinue")?.addEventListener("click", continueToPayment);
        update();
    });
    window.addEventListener("aziel:locale-changed", update);
})();
