(function () {
    const t = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback;
    const SESSION_KEY = "azielPaymentPageSession";
    const authority = window.AZIEL_PAYMENT_SESSION_AUTHORITY;
    let redirectTimer = null;
    let countdownTimer = null;
    let completionState = null;
    let completionRemaining = 5;
    let myanMyanPayStatusTimer = null;
    let myanMyanPayStatusRequestInFlight = false;
    let myanMyanPayStatusReadFailures = 0;
    let myanMyanPayStatusIdentity = "";
    let myanMyanPayStatusPoll = null;
    let myanMyanPaySuccessTransitioned = false;
    const MYANMYANPAY_STATUS_INTERVAL_MS = 3000;
    const MYANMYANPAY_STATUS_RETRY_DELAYS_MS = Object.freeze([3000, 5000, 10000, 15000, 30000]);
    const MYANMYANPAY_QR_WINDOW_MS = 15 * 60 * 1000;

    function readSession() {
        try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (_) { return null; }
    }

    function stagedSessionIsActive(staged) {
        if (myanMyanPayIdentity(staged)) return true;
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
        text("paymentMethodSummary", myanMyanPayIdentity({ orderData: order, session, selectedPayment: payment }) ? "MMQR" : payment.method || payment.paymentName || session.paymentName || payment.key);
        text("paymentAmount", money(session.amount || order.amount, session.currency || order.currency));
    }

    function myanMyanPayIdentity(staged = {}) {
        const session = staged.session || {};
        const order = staged.orderData || {};
        const payment = staged.selectedPayment || session.selectedPaymentMethod || {};
        const exactContract = String(session.provider || payment.provider || "").toUpperCase() === "MYANMYANPAY" &&
            String(session.paymentMethod || payment.key || "").toLowerCase() === "myanmyanpay_mmqr" &&
            String(session.paymentChannel || payment.paymentChannel || "").toUpperCase() === "MYANMYANPAY_MMQR" &&
            String(session.confirmationMode || payment.confirmationMode || "").toLowerCase() === "provider_webhook";
        const orderId = String(session.commerceOrderId || session.orderId || order.commerceOrderId || order.orderId || "").trim();
        const attemptId = String(session.attemptId || order.commercePaymentAttemptId || "").trim();
        return exactContract && orderId && attemptId ? { orderId, attemptId } : null;
    }

    function stopMyanMyanPayStatusPolling() {
        if (myanMyanPayStatusTimer) window.clearTimeout(myanMyanPayStatusTimer);
        myanMyanPayStatusTimer = null;
        myanMyanPayStatusRequestInFlight = false;
        myanMyanPayStatusIdentity = "";
        myanMyanPayStatusPoll = null;
    }

    function myanMyanPayRetryDelay(failureCount) {
        const index = Math.min(Math.max(0, Number(failureCount || 1) - 1), MYANMYANPAY_STATUS_RETRY_DELAYS_MS.length - 1);
        return MYANMYANPAY_STATUS_RETRY_DELAYS_MS[index];
    }

    function scheduleMyanMyanPayStatusPoll(poll, delay = MYANMYANPAY_STATUS_INTERVAL_MS) {
        if (poll !== myanMyanPayStatusPoll || !myanMyanPayStatusIdentity) return;
        if (myanMyanPayStatusTimer) window.clearTimeout(myanMyanPayStatusTimer);
        myanMyanPayStatusTimer = window.setTimeout(() => {
            myanMyanPayStatusTimer = null;
            poll();
        }, Math.max(MYANMYANPAY_STATUS_INTERVAL_MS, Number(delay) || MYANMYANPAY_STATUS_INTERVAL_MS));
    }

    function wakeMyanMyanPayStatusPolling() {
        if (!myanMyanPayStatusPoll || !myanMyanPayStatusIdentity || myanMyanPayStatusRequestInFlight) return false;
        if (myanMyanPayStatusTimer) window.clearTimeout(myanMyanPayStatusTimer);
        myanMyanPayStatusTimer = null;
        myanMyanPayStatusPoll();
        return true;
    }

    function updateMyanMyanPayMessage(title, message, summary, error = false) {
        text("paymentStatusSummary", summary);
        const statusNode = document.querySelector(".mm-payment-shell .checkout-feedback[role='status']");
        if (!statusNode) return;
        const heading = document.createElement("strong");
        heading.textContent = title;
        const detail = document.createElement("span");
        detail.textContent = message;
        statusNode.replaceChildren(heading, document.createElement("br"), detail);
        statusNode.classList.toggle("is-error", error);
    }

    function updateMyanMyanPayPending() {
        updateMyanMyanPayMessage(
            t("payment.waiting", "Waiting for payment"),
            t("payment.confirmAutomatically", "We'll confirm your payment automatically."),
            t("payment.pendingPayment", "Pending payment")
        );
        const qrSection = document.querySelector(".mm-payment-shell__qr-section");
        if (qrSection) qrSection.hidden = false;
        document.querySelector("[data-myanmyanpay-auth-action]")?.remove();
    }

    function updateMyanMyanPayAuthenticationRequired() {
        updateMyanMyanPayMessage(
            t("payment.signInRequired", "Sign in required"),
            t("payment.signInToConfirm", "Sign in again to continue automatic payment confirmation."),
            t("payment.pendingPayment", "Pending payment")
        );
        const shell = document.querySelector(".mm-payment-shell");
        if (shell && !shell.querySelector("[data-myanmyanpay-auth-action]")) {
            const action = document.createElement("a");
            action.className = "primary-commerce-action payment-page-link";
            action.dataset.myanmyanpayAuthAction = "true";
            action.href = "/login";
            action.textContent = t("auth.signIn", "Sign in");
            shell.append(action);
        }
    }

    function markMyanMyanPayQrExpiry(staged, now = Date.now()) {
        const initiatedAt = staged?.session?.initiatedAt || staged?.session?.paymentInitiatedAt;
        const initiatedAtMs = new Date(initiatedAt).getTime();
        const expired = Number.isFinite(initiatedAtMs) && Number(now) >= initiatedAtMs + MYANMYANPAY_QR_WINDOW_MS;
        const qrSection = document.querySelector(".mm-payment-shell__qr-section");
        if (qrSection) {
            qrSection.classList?.toggle?.("is-expired", expired);
            if (expired) qrSection.dataset.myanmyanpayQrExpired = "true";
            else delete qrSection.dataset.myanmyanpayQrExpired;
        }
        return expired;
    }

    function updateMyanMyanPayTerminal(status) {
        const normalized = String(status || "").toLowerCase();
        const labels = {
            failed: [t("payment.state.failed", "Payment failed"), t("payment.providerPaymentFailed", "Payment could not be confirmed. Please review your order or contact support."), t("payment.state.failed", "Payment failed")],
            cancelled: [t("payment.state.cancelled", "Payment cancelled"), t("payment.providerPaymentCancelled", "This payment was cancelled."), t("payment.state.cancelled", "Cancelled")],
            expired: [t("payment.state.expired", "Payment QR expired"), t("payment.providerQrExpired", "This payment QR is no longer active."), t("payment.state.expired", "Expired")]
        };
        const [title, message, summary] = labels[normalized];
        updateMyanMyanPayMessage(title, message, summary, true);
        const qrSection = document.querySelector(".mm-payment-shell__qr-section");
        if (qrSection) qrSection.hidden = true;
        sessionStorage.removeItem(SESSION_KEY);
        const shell = document.querySelector(".mm-payment-shell");
        shell?.querySelector("[data-myanmyanpay-observation-actions]")?.remove();
        if (shell && !shell.querySelector("[data-myanmyanpay-terminal-action]")) {
            const action = document.createElement("a");
            action.className = "primary-commerce-action payment-page-link";
            action.dataset.myanmyanpayTerminalAction = "true";
            action.href = normalized === "expired" ? "/checkout" : "/orders";
            action.textContent = normalized === "expired" ? t("payment.backToCheckout", "Return to checkout") : t("payment.viewOrders", "View My Orders");
            shell.append(action);
        }
    }

    function classifyMyanMyanPayServerState(order = {}) {
        const paymentStatus = String(order.paymentStatus || "").trim().toLowerCase();
        const orderStatus = String(order.orderStatus || order.status || "").trim().toLowerCase();
        const terminal = [paymentStatus, orderStatus].find(status => ["failed", "cancelled", "canceled", "expired"].includes(status));
        const successful = paymentStatus === "paid" || ["paid", "processing", "completed"].includes(orderStatus);
        if (successful && terminal) return { kind: "unknown", orderStatus };
        if (successful) return { kind: "success", orderStatus };
        if (terminal) return { kind: "terminal", orderStatus: terminal === "canceled" ? "cancelled" : terminal };
        if (["", "pending_payment", "pending", "unpaid", "initiating"].includes(paymentStatus) && ["", "pending_payment", "pending", "unpaid", "initiating"].includes(orderStatus)) return { kind: "pending", orderStatus };
        return { kind: "unknown", orderStatus };
    }

    async function readMyanMyanPayStatus(identity) {
        const headers = window.PaymentUtils?.authHeaders?.() || {};
        try {
            const response = await fetch(window.PaymentUtils.apiUrl(`/api/order/status/${encodeURIComponent(identity.orderId)}`), { method: "GET", headers, credentials: "same-origin", cache: "no-store" });
            if (response.status === 401 || response.status === 403) return { kind: "authentication_required" };
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success || !data.order) return { kind: "read_failure" };
            const authoritative = data.order;
            const returnedOrderId = String(authoritative.commerceOrderId || authoritative.orderId || "").trim();
            const returnedProvider = String(authoritative.paymentProvider || authoritative.provider || "").trim().toUpperCase();
            const returnedAttemptId = String(authoritative.commercePaymentAttemptId || "").trim();
            if (returnedOrderId !== identity.orderId || returnedProvider !== "MYANMYANPAY" || (returnedAttemptId && returnedAttemptId !== identity.attemptId)) return { kind: "identity_mismatch" };
            return { ...classifyMyanMyanPayServerState(authoritative), authoritative };
        } catch (_) {
            return { kind: "read_failure" };
        }
    }

    function showMyanMyanPaySuccess(staged, identity, result) {
        if (myanMyanPaySuccessTransitioned) return false;
        myanMyanPaySuccessTransitioned = true;
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem("azielProductCheckoutDraft");
        const session = staged.session || {};
        const payment = staged.selectedPayment || session.selectedPaymentMethod || {};
        showCompletion({
            orderId: identity.orderId,
            paid: true,
            paymentReceived: true,
            amount: result.authoritative.amount ?? session.amount,
            currency: result.authoritative.currency || session.currency,
            methodName: "MMQR",
            reference: session.reference || "",
            orderStatus: result.orderStatus,
            myanMyanPay: true
        });
        return true;
    }

    function startMyanMyanPayStatusPolling(staged) {
        const identity = myanMyanPayIdentity(staged);
        if (!identity) return false;
        stopMyanMyanPayStatusPolling();
        myanMyanPayStatusReadFailures = 0;
        myanMyanPaySuccessTransitioned = false;
        myanMyanPayStatusIdentity = `${identity.orderId}:${identity.attemptId}`;
        const pollIdentity = myanMyanPayStatusIdentity;
        const poll = async () => {
            if (pollIdentity !== myanMyanPayStatusIdentity || myanMyanPayStatusRequestInFlight) return;
            myanMyanPayStatusRequestInFlight = true;
            let nextDelay = MYANMYANPAY_STATUS_INTERVAL_MS;
            let continueObservation = true;
            try {
                markMyanMyanPayQrExpiry(staged);
                const result = await readMyanMyanPayStatus(identity);
                if (pollIdentity !== myanMyanPayStatusIdentity) return;
                if (result.kind === "authentication_required") {
                    myanMyanPayStatusReadFailures += 1;
                    nextDelay = myanMyanPayRetryDelay(myanMyanPayStatusReadFailures);
                    updateMyanMyanPayAuthenticationRequired();
                    return;
                }
                if (["read_failure", "identity_mismatch", "unknown"].includes(result.kind)) {
                    myanMyanPayStatusReadFailures += 1;
                    nextDelay = myanMyanPayRetryDelay(myanMyanPayStatusReadFailures);
                    updateMyanMyanPayPending();
                    return;
                }
                myanMyanPayStatusReadFailures = 0;
                if (result.kind === "pending") {
                    updateMyanMyanPayPending();
                    return;
                }
                continueObservation = false;
                if (result.kind === "terminal") {
                    stopMyanMyanPayStatusPolling();
                    updateMyanMyanPayTerminal(result.orderStatus);
                    return;
                }
                stopMyanMyanPayStatusPolling();
                showMyanMyanPaySuccess(staged, identity, result);
            } finally {
                if (pollIdentity === myanMyanPayStatusIdentity) {
                    myanMyanPayStatusRequestInFlight = false;
                    if (continueObservation) scheduleMyanMyanPayStatusPoll(poll, nextDelay);
                }
            }
        };
        myanMyanPayStatusPoll = poll;
        updateMyanMyanPayPending();
        poll();
        return true;
    }

    function showStaged(staged) {
        const order = staged.orderData || staged.session?.order || {};
        const session = staged.session || {};
        const payment = staged.selectedPayment || session.selectedPaymentMethod || {};
        window.selectedPaymentData = payment;
        document.getElementById("paymentSessionMount").innerHTML = "";
        renderSummary(order, session, payment);
        if (window.AZIEL_MM_PAYMENT_SHELL?.supports?.(staged)) {
            document.getElementById("paymentPageTitle").textContent = t("payment", "Payment");
            window.AZIEL_MM_PAYMENT_SHELL.show(staged, { onSubmitted: ({ orderId, amount, currency, methodName, reference }) => {
                sessionStorage.removeItem(SESSION_KEY);
                sessionStorage.removeItem("azielProductCheckoutDraft");
                showCompletion({ orderId, paid: false, amount, currency, methodName, reference, manualSubmission: true });
            } });
            startMyanMyanPayStatusPolling(staged);
            return;
        }
        if (String(staged.paymentType || session.paymentType || payment.paymentType || "").toLowerCase() === "auto") window.PaymentPromptPay.show(order, session);
        else window.PaymentManual.show(order, session);
    }

    function showCompletion({ orderId, paid = false, paymentReceived = false, amount = null, currency = "", methodName = "", reference = "", manualSubmission = false, orderStatus = "", myanMyanPay = false } = {}) {
        if (!orderId) return;
        let remaining = 5;
        completionState = { orderId, paid, manualSubmission, paymentReceived, orderStatus, myanMyanPay };
        completionRemaining = remaining;
        const mount = document.getElementById("paymentSessionMount");
        const section = document.createElement("section");
        section.className = "checkout-card payment-completion";
        section.setAttribute("role", "status");
        const icon = document.createElement("div"); icon.className = "payment-completion__icon"; icon.textContent = "✓";
        const eyebrow = document.createElement("p"); eyebrow.className = "checkout-eyebrow"; eyebrow.textContent = t("order.statusLabel", "Order status");
        const title = document.createElement("h2"); title.textContent = myanMyanPay && paid ? t("payment.success.title", "Payment Successful") : paymentReceived ? "Payment received" : paid ? t("payment.success.title", "Payment Successful") : t("payment.submitted.title", "Payment Submitted");
        const body = document.createElement("p"); body.textContent = myanMyanPay && orderStatus === "completed" ? t("payment.success.completed", "Payment received. Your order is completed.") : paymentReceived ? "Your payment has been confirmed. Processing your order..." : paid ? t("payment.success.receivedProcessing", "Your payment has been received. Your order is being processed.") : t("payment.submitted.awaiting", "Your receipt has been received. Your payment is waiting for verification.");
        const details = document.createElement("dl"); details.className = "payment-completion__details";
        [[t("payment.amount", "Amount"), amount != null ? money(amount, currency) : ""], [t("payment.method", "Payment Method"), methodName], [t("payment.reference", "Reference"), reference]].forEach(([label, value]) => { if (!value) return; const row = document.createElement("div"); const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; row.append(dt, dd); details.append(row); });
        const countdown = document.createElement("p"); countdown.id = "paymentRedirectCountdown"; countdown.textContent = t("payment.redirectCountdown", "Redirecting to order tracking in {seconds} seconds", { seconds: remaining });
        const actions = document.createElement("div"); actions.className = "payment-completion__actions";
        const track = document.createElement("a"); track.id = "trackOrderNow"; track.className = "primary-commerce-action"; track.href = `/orders?orderId=${encodeURIComponent(orderId)}`; track.textContent = t("payment.trackOrderNow", "Track Order");
        const home = document.createElement("a"); home.id = "paymentBackHome"; home.href = "/"; home.textContent = t("payment.backHome", "Back to Home");
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
        redirectTimer = window.setTimeout(() => window.location.replace(`/orders?orderId=${encodeURIComponent(orderId)}`), 5000);
    }

    function readMarker() {
        try { return JSON.parse(localStorage.getItem("aziel:commerce-pending-payment") || "null"); } catch (_) { return null; }
    }

    function showRecovered(recovery) {
        document.getElementById("paymentPageTitle").textContent = t("payment.resume", "Resume payment");
        document.getElementById("paymentSessionMount").innerHTML = "";
        renderSummary(recovery, recovery, { method: recovery.paymentName || "PromptPay QR" });
        if (String(recovery.provider || "").toUpperCase() === "MANUAL_ADMIN" || String(recovery.region || "").toUpperCase() === "MM") {
            if (recovery.receiptSubmitted === true || recovery.receiptEvidence?.attached === true) {
                showCompletion({ orderId: recovery.orderId || recovery.commerceOrderId, paid: false, amount: recovery.amount, currency: recovery.currency, methodName: recovery.paymentName || recovery.paymentMethod, reference: recovery.reference, manualSubmission: true });
                return true;
            }
            const recoveredPayment = { session: recovery, orderData: recovery, selectedPayment: recovery, paymentType: "manual" };
            window.AZIEL_MM_PAYMENT_SHELL.show(recoveredPayment, { onSubmitted: ({ orderId, amount, currency, methodName, reference }) => showCompletion({ orderId, paid: false, amount, currency, methodName, reference, manualSubmission: true }) });
            if (myanMyanPayIdentity(recoveredPayment)) startMyanMyanPayStatusPolling(recoveredPayment);
            return true;
        }
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
        const orders = document.createElement("a"); orders.className = "primary-commerce-action payment-page-link"; orders.href = "/orders"; orders.textContent = t("payment.viewOrders", "View My Orders");
        unavailable.append(heading, help, orders); mount.replaceChildren(unavailable);
    });

    window.addEventListener("aziel:recovered-payment-submitted", event => {
        const orderId = event.detail?.order?.orderId || event.detail?.order?.commerceOrderId || "";
        if (orderId) showCompletion({ orderId, paid: false });
    });
    window.addEventListener("pagehide", stopMyanMyanPayStatusPolling);
    window.addEventListener("beforeunload", stopMyanMyanPayStatusPolling);
    window.addEventListener("online", wakeMyanMyanPayStatusPolling);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "hidden") wakeMyanMyanPayStatusPolling();
    });
    window.addEventListener("aziel:languageChanged", () => {
        if (!completionState) return;
        const { paid, paymentReceived, orderStatus, myanMyanPay } = completionState;
        const section = document.querySelector(".payment-completion");
        if (!section) return;
        section.querySelector(".checkout-eyebrow").textContent = t("order.statusLabel", "Order status");
        section.querySelector("h2").textContent = myanMyanPay && paid ? t("payment.success.title", "Payment Successful") : paymentReceived ? "Payment received" : paid ? t("payment.success.title", "Payment Successful") : t("payment.submitted.title", "Payment Submitted");
        section.querySelector("h2 + p").textContent = myanMyanPay && orderStatus === "completed" ? t("payment.success.completed", "Payment received. Your order is completed.") : paymentReceived ? "Your payment has been confirmed. Processing your order..." : paid ? t("payment.success.receivedProcessing", "Your payment has been received. Your order is being processed.") : t("payment.submitted.awaiting", "Your receipt has been received. Your payment is waiting for verification.");
        document.getElementById("paymentRedirectCountdown").textContent = t("payment.redirectCountdown", "Redirecting to order tracking in {seconds} seconds", { seconds: completionRemaining });
        document.getElementById("trackOrderNow").textContent = t("payment.trackOrderNow", "Track Order");
        document.getElementById("paymentBackHome").textContent = t("payment.backHome", "Back to Home");
        text("paymentStatusSummary", paid ? t("payment.state.paid", "Paid") : t("payment.state.pendingVerification", "Pending verification"));
    });

    window.AZIEL_PAYMENT_PAGE = {
        showCompletion,
        _test: Object.freeze({
            myanMyanPayIdentity,
            classifyMyanMyanPayServerState,
            myanMyanPayRetryDelay,
            markMyanMyanPayQrExpiry,
            readMyanMyanPayStatus,
            showMyanMyanPaySuccess,
            showRecovered,
            startMyanMyanPayStatusPolling,
            stopMyanMyanPayStatusPolling,
            wakeMyanMyanPayStatusPolling
        })
    };
})();
