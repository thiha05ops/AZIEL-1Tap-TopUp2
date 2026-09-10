(function () {
    const t = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback;
    const SESSION_KEY = "azielPaymentPageSession";
    const authority = window.AZIEL_PAYMENT_SESSION_AUTHORITY;
    let redirectTimer = null;
    let countdownTimer = null;
    let tmwCountdownTimer = null;
    let tmwPollingTimer = null;
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

    function stopTmwRuntime() {
        clearInterval(tmwCountdownTimer);
        clearInterval(tmwPollingTimer);
        tmwCountdownTimer = null;
        tmwPollingTimer = null;
    }

    function tmwQr(session = {}) {
        return String(session.qrImage || session.qrUrl || session.qr?.image || session.dynamicQr?.qrImage || "").trim();
    }

    function showTmwPayment(order = {}, session = {}) {
        const qr = tmwQr(session);
        const expiresAt = session.expiresAt || session.recoverableExpiresAt || session.dynamicQr?.expiresAt || "";
        const mount = document.getElementById("paymentSessionMount");
        if (!mount || !qr) return false;
        stopTmwRuntime();

        const card = document.createElement("section"); card.className = "checkout-card tmw-payment-card";
        const eyebrow = document.createElement("p"); eyebrow.className = "checkout-eyebrow"; eyebrow.textContent = t("payment.pendingPayment", "Pending payment");
        const heading = document.createElement("h2"); heading.textContent = "Scan the provider QR";
        const status = document.createElement("p"); status.className = "checkout-feedback"; status.textContent = "Waiting for TMW payment confirmation";
        const figure = document.createElement("figure"); figure.className = "az-payment-sheet__qr";
        const image = document.createElement("img"); image.id = "tmwProviderQrImage"; image.src = qr; image.alt = "TMW PromptPay provider QR";
        const caption = document.createElement("figcaption"); caption.textContent = "Scan this provider-generated QR with a PromptPay-compatible banking app.";
        figure.append(image, caption);
        const amount = document.createElement("p"); amount.className = "tmw-payment-card__amount"; amount.textContent = `Amount to pay: ฿${Number(session.providerPayableAmount ?? session.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const expiry = document.createElement("p"); expiry.id = "tmwPaymentCountdown"; expiry.className = "az-payment-sheet__qr-expiry";
        const instructions = document.createElement("ol"); instructions.className = "tmw-payment-card__instructions";
        const steps = Array.isArray(session.paymentInstructions?.steps) && session.paymentInstructions.steps.length
            ? session.paymentInstructions.steps
            : ["Scan the QR and pay the exact amount shown", "Keep this page open", "Wait for automatic confirmation"];
        steps.forEach(value => { const item = document.createElement("li"); item.textContent = String(value); instructions.append(item); });
        card.append(eyebrow, heading, status, figure, amount, expiry, instructions);
        mount.replaceChildren(card);

        const tick = () => {
            const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
            expiry.textContent = Number.isFinite(remaining) ? `QR expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "";
            if (remaining <= 0) { clearInterval(tmwCountdownTimer); status.textContent = "Payment QR expired"; }
        };
        if (expiresAt) { tick(); tmwCountdownTimer = window.setInterval(tick, 1000); }

        const attemptId = String(session.attemptId || "").trim();
        const orderId = String(session.commerceOrderId || session.orderId || order.commerceOrderId || order.orderId || "").trim();
        if (attemptId) tmwPollingTimer = window.setInterval(async () => {
            try {
                const response = await fetch(`/api/commerce/payments/tmw/${encodeURIComponent(attemptId)}`, { headers: window.PaymentUtils?.authHeaders?.() || {} });
                const data = await response.json();
                if (!response.ok || !data.success) return;
                if (String(data.payment?.paymentStatus || "").toLowerCase() === "paid") {
                    stopTmwRuntime();
                    showCompletion({ orderId, paid: true, amount: session.providerPayableAmount ?? session.amount, currency: session.currency, methodName: session.paymentName || "TMW PromptPay", reference: attemptId });
                }
            } catch (_) { /* polling is best-effort; webhook remains authoritative */ }
        }, 3000);
        return true;
    }

    function showStaged(staged) {
        const order = staged.orderData || staged.session?.order || {};
        const session = staged.session || {};
        const payment = staged.selectedPayment || session.selectedPaymentMethod || {};
        window.selectedPaymentData = payment;
        document.getElementById("paymentSessionMount").innerHTML = "";
        renderSummary(order, session, payment);
        if (String(session.provider || payment.provider || "").toLowerCase() === "tmw" && showTmwPayment(order, session)) return;
        if (window.AZIEL_MM_PAYMENT_SHELL?.supports?.(staged)) {
            document.getElementById("paymentPageTitle").textContent = t("payment", "Payment");
            window.AZIEL_MM_PAYMENT_SHELL.show(staged, { onSubmitted: ({ orderId, amount, currency, methodName, reference }) => {
                sessionStorage.removeItem(SESSION_KEY);
                sessionStorage.removeItem("azielProductCheckoutDraft");
                showCompletion({ orderId, paid: false, amount, currency, methodName, reference, manualSubmission: true });
            } });
            return;
        }
        if (String(staged.paymentType || session.paymentType || payment.paymentType || "").toLowerCase() === "auto") window.PaymentPromptPay.show(order, session);
        else window.PaymentManual.show(order, session);
    }

    function showCompletion({ orderId, paid = false, amount = null, currency = "", methodName = "", reference = "", manualSubmission = false } = {}) {
        if (!orderId) return;
        let remaining = 5;
        completionState = { orderId, paid, manualSubmission };
        completionRemaining = remaining;
        const mount = document.getElementById("paymentSessionMount");
        const section = document.createElement("section");
        section.className = "checkout-card payment-completion";
        section.setAttribute("role", "status");
        const icon = document.createElement("div"); icon.className = "payment-completion__icon"; icon.textContent = "✓";
        const eyebrow = document.createElement("p"); eyebrow.className = "checkout-eyebrow"; eyebrow.textContent = t("order.statusLabel", "Order status");
        const title = document.createElement("h2"); title.textContent = paid ? t("payment.success.title", "Payment Successful") : t("payment.submitted.title", "Payment Submitted");
        const body = document.createElement("p"); body.textContent = paid ? t("payment.success.receivedProcessing", "Your payment has been received. Your order is being processed.") : t("payment.submitted.awaiting", "Your receipt has been received. Your payment is waiting for verification.");
        const details = document.createElement("dl"); details.className = "payment-completion__details";
        [[t("payment.amount", "Amount"), amount != null ? money(amount, currency) : ""], [t("payment.method", "Payment Method"), methodName], [t("payment.reference", "Reference"), reference]].forEach(([label, value]) => { if (!value) return; const row = document.createElement("div"); const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; row.append(dt, dd); details.append(row); });
        const countdown = document.createElement("p"); countdown.id = "paymentRedirectCountdown"; countdown.textContent = t("payment.redirectCountdown", "Redirecting to order tracking in {seconds} seconds", { seconds: remaining });
        const actions = document.createElement("div"); actions.className = "payment-completion__actions";
        const track = document.createElement("a"); track.id = "trackOrderNow"; track.className = "primary-commerce-action"; track.href = `tracking.html?orderId=${encodeURIComponent(orderId)}`; track.textContent = t("payment.trackOrderNow", "Track Order");
        const home = document.createElement("a"); home.id = "paymentBackHome"; home.href = "home.html"; home.textContent = t("payment.backHome", "Back to Home");
        actions.append(track, home); section.append(icon, eyebrow, title, body); if (details.childElementCount) section.append(details); section.append(countdown, actions); mount.replaceChildren(section);
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
        if (String(recovery.provider || "").toLowerCase() === "tmw") {
            window.selectedPaymentData = recovery;
            return showTmwPayment(recovery, { ...recovery, qrUrl: recovery.qrImage || recovery.qrImageUrl || recovery.dynamicQr?.qrImage || "" });
        }
        if (String(recovery.provider || "").toUpperCase() === "MANUAL_ADMIN" || String(recovery.region || "").toUpperCase() === "MM") {
            if (recovery.receiptSubmitted === true || recovery.receiptEvidence?.attached === true) {
                showCompletion({ orderId: recovery.orderId || recovery.commerceOrderId, paid: false, amount: recovery.amount, currency: recovery.currency, methodName: recovery.paymentName || recovery.paymentMethod, reference: recovery.reference, manualSubmission: true });
                return true;
            }
            window.AZIEL_MM_PAYMENT_SHELL.show({ session: recovery, orderData: recovery, selectedPayment: recovery, paymentType: "manual" }, { onSubmitted: ({ orderId, amount, currency, methodName, reference }) => showCompletion({ orderId, paid: false, amount, currency, methodName, reference, manualSubmission: true }) });
            return true;
        }
        window.PaymentCheckoutSheet.openRecoveredPayment(recovery);
        return true;
    }

    async function recover(marker) {
        if (!marker?.orderId || !marker?.attemptId) return false;
        if (String(marker.provider || "").toLowerCase() === "tmw") {
            const res = await fetch(`/api/commerce/payments/tmw/${encodeURIComponent(marker.attemptId)}/refresh`, { method: "POST", headers: window.PaymentUtils?.authHeaders?.() || {} });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) return false;
            const payment = data.payment || {};
            if (payment.paymentStatus === "paid") {
                showCompletion({ orderId: marker.orderId, paid: true, amount: payment.amount, currency: payment.currency, methodName: "TMW PromptPay", reference: payment.attemptId });
                return true;
            }
            const session = { ...payment, commerce: true, commerceOrderId: marker.orderId, orderId: marker.orderId, paymentType: "auto", provider: "tmw", paymentMethod: "tmw_promptpay", paymentName: "TMW PromptPay", amount: payment.providerPayableAmount ?? payment.amount, commerceAmount: payment.commerceAmount ?? payment.amount, qrImage: payment.qr?.image || "", qrUrl: payment.qr?.image || "", dynamicQr: payment.qr?.image ? { qrImage: payment.qr.image, expiresAt: payment.expiresAt || "" } : null, receiptUploadEnabled: false, slipRequired: false };
            showStaged({ session, orderData: marker, selectedPayment: session, paymentType: "auto" });
            return true;
        }
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
            provider: payment.provider || "", region: payment.region || marker.region || "", paymentMethod: payment.paymentMethod || marker.paymentMethod || "", paymentName: payment.paymentInstructions?.title || marker.paymentMethod || "PromptPay QR",
            accountName: payment.paymentInstructions?.accountName || "", accountNumber: payment.paymentInstructions?.accountNumber || "", reference: payment.paymentInstructions?.reference || payment.qr?.encodedReference || payment.attemptId || marker.attemptId,
            receiptUploadEnabled: payment.paymentInstructions?.receiptUploadEnabled !== false, slipRequired: payment.paymentInstructions?.slipRequired !== false, receiptEvidence: payment.receiptEvidence || null,
            enableOpenApp: payment.paymentInstructions?.enableOpenApp === true, openAppMode: payment.paymentInstructions?.openAppMode || "disabled", deepLinkUrl: payment.paymentInstructions?.deepLinkUrl || "",
            qrImageUrl: payment.qr?.image || "", qrImage: payment.qr?.image || "", dynamicQr: payment.qr?.image ? { qrImage: payment.qr.image, expiresAt: payment.expiresAt } : null
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
        section.querySelector("h2").textContent = paid ? t("payment.success.title", "Payment Successful") : t("payment.submitted.title", "Payment Submitted");
        section.querySelector("h2 + p").textContent = paid ? t("payment.success.receivedProcessing", "Your payment has been received. Your order is being processed.") : t("payment.submitted.awaiting", "Your receipt has been received. Your payment is waiting for verification.");
        document.getElementById("paymentRedirectCountdown").textContent = t("payment.redirectCountdown", "Redirecting to order tracking in {seconds} seconds", { seconds: completionRemaining });
        document.getElementById("trackOrderNow").textContent = t("payment.trackOrderNow", "Track Order");
        document.getElementById("paymentBackHome").textContent = t("payment.backHome", "Back to Home");
        text("paymentStatusSummary", paid ? t("payment.state.paid", "Paid") : t("payment.state.pendingVerification", "Pending verification"));
    });

    window.AZIEL_PAYMENT_PAGE = { showCompletion, showTmwPayment, tmwQr };
})();
