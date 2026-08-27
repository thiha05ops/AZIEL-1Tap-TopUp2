(function () {
    const t = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback;
    const SESSION_KEY = "azielPaymentPageSession";
    const authority = window.AZIEL_PAYMENT_SESSION_AUTHORITY;
    let redirectTimer = null;
    let countdownTimer = null;
    let completionState = null;
    let completionRemaining = 5;

    function readSession() {
        try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (_) { return null; }
    }

    function stagedSessionIsActive(staged) {
        const expiresAt = staged?.session?.expiresAt || staged?.session?.recoverableExpiresAt || staged?.session?.dynamicQr?.expiresAt;
        if (!expiresAt) return Boolean(staged?.session?.attemptId);
        const expires = new Date(expiresAt).getTime();
        return Number.isFinite(expires) && expires > Date.now();
    }

    function text(id, value) {
        const node = document.getElementById(id);
        if (node) node.textContent = String(value || "—");
    }

    function money(amount, currency) {
        const value = Number(amount || 0);
        return `${value.toLocaleString()} ${String(currency || "").toUpperCase() === "THB" ? "฿" : currency || ""}`.trim();
    }

    function account(order) {
        return order.accountDisplay || order.account || order.userId || order.playerId || order.gameUserId || "—";
    }

    function renderSummary(order, session, payment) {
        text("paymentOrderId", session.commerceOrderId || session.orderId || order.commerceOrderId || order.orderId);
        text("paymentProduct", session.productName || order.productName || order.game);
        text("paymentPackage", session.packageName || order.packageName);
        text("paymentAccount", account(order));
        text("paymentMethodSummary", payment.method || payment.paymentName || session.paymentName || payment.key);
        text("paymentAmount", money(session.amount || order.amount, session.currency || order.currency));
    }

    function showStaged(staged) {
        const order = staged.orderData || staged.session?.order || {};
        const session = staged.session || {};
        const payment = staged.selectedPayment || session.selectedPaymentMethod || {};
        window.selectedPaymentData = payment;
        document.getElementById("paymentSessionMount").innerHTML = "";
        renderSummary(order, session, payment);
        window.PaymentManual.show(order, session);
    }

    function showCompletion({ orderId, paid = false, amount = null, currency = "" } = {}) {
        if (!orderId) return;
        let remaining = 5;
        completionState = { orderId, paid };
        completionRemaining = remaining;
        const mount = document.getElementById("paymentSessionMount");
        const section = document.createElement("section");
        section.className = "checkout-card payment-completion";
        section.setAttribute("role", "status");
        const icon = document.createElement("div"); icon.className = "payment-completion__icon"; icon.textContent = "✓";
        const eyebrow = document.createElement("p"); eyebrow.className = "checkout-eyebrow"; eyebrow.textContent = t("order.statusLabel", "Order status");
        const title = document.createElement("h2"); title.textContent = paid ? t("payment.success.title", "Payment Successful") : t("payment.submitted.title", "Payment submitted");
        const body = document.createElement("p"); body.textContent = paid ? t("payment.success.receivedProcessing", "Your payment has been received. Your order is being processed.") : t("payment.submitted.awaiting", "Your receipt is awaiting verification.");
        const countdown = document.createElement("p"); countdown.id = "paymentRedirectCountdown"; countdown.textContent = t("payment.redirectCountdown", "Redirecting to order tracking in {seconds} seconds", { seconds: remaining });
        const actions = document.createElement("div"); actions.className = "payment-completion__actions";
        const track = document.createElement("a"); track.id = "trackOrderNow"; track.className = "primary-commerce-action"; track.href = `tracking.html?orderId=${encodeURIComponent(orderId)}`; track.textContent = t("payment.trackOrderNow", "Track Order");
        const home = document.createElement("a"); home.id = "paymentBackHome"; home.href = "home.html"; home.textContent = t("payment.backHome", "Back to Home");
        actions.append(track, home); section.append(icon, eyebrow, title, body, countdown, actions); mount.replaceChildren(section);
        text("paymentOrderId", orderId);
        if (amount != null) text("paymentAmount", money(amount, currency));
        text("paymentStatusSummary", paid ? t("payment.state.paid", "Paid") : t("payment.state.pendingVerification", "Pending verification"));
        const cancelTimers = () => { clearTimeout(redirectTimer); clearInterval(countdownTimer); };
        document.getElementById("trackOrderNow")?.addEventListener("click", cancelTimers);
        document.getElementById("paymentBackHome")?.addEventListener("click", cancelTimers);
        countdownTimer = window.setInterval(() => {
            remaining -= 1;
            completionRemaining = remaining;
            const node = document.getElementById("paymentRedirectCountdown");
            if (node && remaining > 0) node.textContent = t("payment.redirectCountdown", "Redirecting to order tracking in {seconds} seconds", { seconds: remaining });
        }, 1000);
        redirectTimer = window.setTimeout(() => window.location.replace(`tracking.html?orderId=${encodeURIComponent(orderId)}`), 5000);
    }

    function readMarker() {
        try { return JSON.parse(localStorage.getItem("aziel:commerce-pending-payment") || "null"); } catch (_) { return null; }
    }

    function showRecovered(recovery) {
        document.getElementById("paymentPageTitle").textContent = t("payment.resume", "Resume payment");
        document.getElementById("paymentSessionMount").innerHTML = "";
        renderSummary(recovery, recovery, { method: recovery.paymentName || "PromptPay QR" });
        window.PaymentCheckoutSheet.openRecoveredPayment(recovery);
        return true;
    }

    async function recover(marker) {
        if (!marker?.orderId || !marker?.attemptId) return false;
        const res = await fetch(`/api/commerce/orders/${encodeURIComponent(marker.orderId)}/payments/manual-promptpay?attemptId=${encodeURIComponent(marker.attemptId)}`, { headers: window.PaymentUtils?.authHeaders?.() || {} });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) return false;
        const payment = data.payment || data.session || data;
        const recovery = {
            commerce: true, orderId: marker.orderId, attemptId: marker.attemptId,
            productName: marker.productName, packageName: marker.packageName,
            paymentMethod: marker.paymentMethod || "promptpay", paymentName: "PromptPay QR",
            amount: payment.amount, currency: payment.currency || "THB", resumable: true,
            recoverableExpiresAt: payment.expiresAt, qrMode: payment.qr?.mode || "aziel_promptpay_dynamic",
            qrImageUrl: payment.qr?.image || "", dynamicQr: { qrImage: payment.qr?.image || "", expiresAt: payment.expiresAt }
        };
        return showRecovered(recovery);
    }

    async function recoverRequestedAttempt(request, marker) {
        if (authority?.markerMatchesRequest(marker, request)) return recover(marker);
        const res = await fetch("/api/commerce/payments/recoverable", { headers: window.PaymentUtils?.authHeaders?.() || {} });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !Array.isArray(data.recoverable)) return false;
        const exact = data.recoverable.find(item => (
            String(item?.attemptId || "") === request.attemptId &&
            (!request.orderId || String(item?.orderId || item?.commerceOrderId || "") === request.orderId)
        ));
        return exact ? showRecovered(exact) : false;
    }

    document.addEventListener("DOMContentLoaded", async () => {
        const staged = readSession();
        const requestParams = new URLSearchParams(window.location.search);
        const requestedAttemptId = String(requestParams.get("attemptId") || "").trim();
        const requestedOrderId = String(requestParams.get("orderId") || "").trim();
        const requestedIdentity = { attemptId: requestedAttemptId, orderId: requestedOrderId };
        const marker = readMarker();
        const stagedCompletionOrderId = String(staged?.completion?.orderId || "").trim();
        if (staged?.completion?.paid === true && stagedCompletionOrderId) {
            const completionOrder = staged.orderData || {};
            const completionSession = staged.session || staged.completion;
            const completionPayment = staged.selectedPayment || { method: "AZIEL Wallet", key: "wallet" };
            renderSummary(completionOrder, completionSession, completionPayment);
            showCompletion({
                orderId: stagedCompletionOrderId,
                paid: true,
                amount: staged.completion.amount,
                currency: staged.completion.currency
            });
            sessionStorage.removeItem("azielProductCheckoutDraft");
            sessionStorage.removeItem(SESSION_KEY);
            return;
        }
        if (
            staged?.session &&
            staged?.orderData &&
            stagedSessionIsActive(staged) &&
            (!requestedAttemptId || authority?.stagedSessionMatchesRequest(staged, requestedIdentity))
        ) {
            showStaged(staged);
            return;
        }
        if (staged && (!requestedAttemptId || !authority?.stagedSessionMatchesRequest(staged, requestedIdentity))) {
            sessionStorage.removeItem(SESSION_KEY);
        }
        try {
            if (requestedAttemptId) {
                if (await recoverRequestedAttempt(requestedIdentity, marker)) return;
            } else if (await recover(marker)) return;
        } catch (error) { console.warn("Payment recovery failed", error); }
        const mount = document.getElementById("paymentSessionMount");
        const unavailable = document.createElement("section"); unavailable.className = "checkout-card";
        const heading = document.createElement("h2"); heading.textContent = t("payment.sessionUnavailable", "Payment session unavailable");
        const help = document.createElement("p"); help.textContent = t("payment.sessionUnavailableHelp", "Open My Orders to resume an active payment or review its status.");
        const orders = document.createElement("a"); orders.className = "primary-commerce-action payment-page-link"; orders.href = "tracking.html"; orders.textContent = t("payment.viewOrders", "View My Orders");
        unavailable.append(heading, help, orders); mount.replaceChildren(unavailable);
    });

    window.addEventListener("aziel:recovered-payment-submitted", event => {
        const orderId = event.detail?.order?.orderId || event.detail?.order?.commerceOrderId || "";
        if (orderId) showCompletion({ orderId, paid: false });
    });
    window.addEventListener("aziel:locale-changed", () => {
        if (!completionState) return;
        const paid = completionState.paid;
        const section = document.querySelector(".payment-completion");
        if (!section) return;
        section.querySelector(".checkout-eyebrow").textContent = t("order.statusLabel", "Order status");
        section.querySelector("h2").textContent = paid ? t("payment.success.title", "Payment Successful") : t("payment.submitted.title", "Payment submitted");
        section.querySelector("h2 + p").textContent = paid ? t("payment.success.receivedProcessing", "Your payment has been received. Your order is being processed.") : t("payment.submitted.awaiting", "Your receipt is awaiting verification.");
        document.getElementById("paymentRedirectCountdown").textContent = t("payment.redirectCountdown", "Redirecting to order tracking in {seconds} seconds", { seconds: completionRemaining });
        document.getElementById("trackOrderNow").textContent = t("payment.trackOrderNow", "Track Order");
        document.getElementById("paymentBackHome").textContent = t("payment.backHome", "Back to Home");
        text("paymentStatusSummary", paid ? t("payment.state.paid", "Paid") : t("payment.state.pendingVerification", "Pending verification"));
    });

    window.AZIEL_PAYMENT_PAGE = { showCompletion };
})();
