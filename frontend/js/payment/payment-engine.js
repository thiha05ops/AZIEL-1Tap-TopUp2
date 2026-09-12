// frontend/js/payment/payment-engine.js
// AZIEL Payment Engine V2.5

(function () {
    function createPaymentError(data = {}) {
        const error = new Error(data.message || "Create payment failed");
        error.code = data.code || "";
        error.title = data.title || "";
        error.activePendingCount = data.activePendingCount;
        error.limit = data.limit;
        return error;
    }

    function showPaymentError(error) {
        if (error?.code === "TOO_MANY_PENDING_ORDERS") {
            const title = error.title || "You have several unfinished orders.";
            const message = error.message || "Complete or wait for an older order to expire before creating another.";

            if (window.AZIEL_UI?.toast?.warning) {
                window.AZIEL_UI.toast.warning({
                    title,
                    message,
                    action: {
                        label: "View My Orders",
                        onClick: () => {
                            window.location.href = "account.html#orders";
                        }
                    }
                });
                return;
            }

            PaymentUtils.showToast(`${title} ${message}`);
            return;
        }

        window.AZIEL_UI?.toast?.error(error.message || "Payment failed") ||
            PaymentUtils.showToast(error.message || "Payment failed");
    }

    async function createPaymentSession(orderData) {
        const res = await fetch(PaymentUtils.apiUrl("/api/payment/create"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...PaymentUtils.authHeaders()
            },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            throw createPaymentError(data);
        }

        return data;
    }

    async function createManualAttempt(orderData) {
        const res = await fetch(PaymentUtils.apiUrl("/api/payment/manual/attempt"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...PaymentUtils.authHeaders()
            },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            throw createPaymentError(data);
        }

        return data;
    }

    async function createCommerceManualPromptPayCheckout(orderData) {
        const res = await fetch(PaymentUtils.apiUrl("/api/commerce/checkout/manual-promptpay"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...PaymentUtils.authHeaders()
            },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            throw createPaymentError(data);
        }

        if (data.session?.commerceOrderId && data.session?.attemptId) {
            try {
                localStorage.setItem("aziel:commerce-pending-payment", JSON.stringify({
                    commerce: true,
                    orderId: data.session.commerceOrderId,
                    attemptId: data.session.attemptId,
                    productName: data.session.productName || orderData.game || "",
                    packageName: data.session.packageName || orderData.packageName || "",
                    productCode: orderData.productCode || orderData.gameKey || "",
                    gameKey: orderData.gameKey || orderData.productCode || "",
                    region: orderData.region || data.session.region || "",
                    paymentMethod: data.session.paymentMethod || orderData.paymentMethod || "promptpay",
                    createdAt: new Date().toISOString()
                }));
            } catch (error) {
                // Recovery marker is best-effort; Commerce remains server-owned.
            }
        }

        return data.session;
    }

    async function createCommerceManualPaymentCheckout(orderData) {
        const res = await fetch(PaymentUtils.apiUrl("/api/commerce/checkout/manual-payment"), { method: "POST", headers: { "Content-Type": "application/json", ...PaymentUtils.authHeaders() }, body: JSON.stringify(orderData) });
        const data = await res.json();
        if (!res.ok || !data.success) throw createPaymentError(data);
        if (data.session?.commerceOrderId && data.session?.attemptId) {
            try { localStorage.setItem("aziel:commerce-pending-payment", JSON.stringify({ commerce: true, orderId: data.session.commerceOrderId, attemptId: data.session.attemptId, productName: data.session.productName || orderData.game || "", packageName: data.session.packageName || orderData.packageName || "", productCode: orderData.productCode || orderData.gameKey || "", gameKey: orderData.gameKey || orderData.productCode || "", region: data.session.region || orderData.region || "", paymentMethod: data.session.paymentMethod || orderData.paymentMethod || "", createdAt: new Date().toISOString() })); } catch (_) { /* best effort */ }
        }
        return data.session;
    }

    function stagePaymentPage(session, orderData, selectedPayment, type) {
        sessionStorage.setItem("azielPaymentPageSession", JSON.stringify({
            version: 1,
            createdAt: new Date().toISOString(),
            session,
            orderData,
            selectedPayment,
            paymentType: type
        }));
        const attemptId = session?.attemptId || session?.manualPaymentAttemptId || "";
        const orderId = session?.commerceOrderId || session?.orderId || orderData?.commerceOrderId || orderData?.orderId || "";
        const params = new URLSearchParams();
        if (orderId) params.set("orderId", orderId);
        if (attemptId) params.set("attemptId", attemptId);
        window.location.href = `payment.html${params.toString() ? `?${params.toString()}` : ""}`;
    }

    function stageWalletCompletion(result, orderData, selectedPayment) {
        const orderId = String(result?.orderId || "").trim();
        if (!orderId) throw createPaymentError({ message: "Wallet payment completed without an order reference." });
        const amount = Number(result.amount ?? orderData.amount ?? 0);
        const currency = String(result.currency || orderData.currency || "").trim().toUpperCase();
        sessionStorage.setItem("azielPaymentPageSession", JSON.stringify({
            version: 1,
            createdAt: new Date().toISOString(),
            completion: { paid: true, orderId, amount, currency },
            session: { commerceOrderId: orderId, orderId, amount, currency, paymentStatus: "paid" },
            orderData: { ...orderData, ...(result.order || {}), orderId, commerceOrderId: orderId, amount, currency },
            selectedPayment,
            paymentType: "wallet"
        }));
        window.dispatchEvent(new CustomEvent("aziel:payment-completed", { detail: { orderId, paymentType: "wallet" } }));
        window.location.href = `payment.html?orderId=${encodeURIComponent(orderId)}`;
    }

    async function start(orderData) {
        const selectedPayment = window.selectedPaymentData || {};
        const type =
            selectedPayment.paymentType ||
            orderData.paymentType ||
            "manual";

        const useBlockingLoader = orderData.pagePresentation !== true;
        if (useBlockingLoader) PaymentUtils.showLoading();

        try {
            if (type === "wallet" || selectedPayment.key === "wallet") {
                const walletResult = await PaymentWallet.pay(orderData);
                if (!walletResult?.success) return { success: false, navigating: false };
                if (orderData.pagePresentation === true) {
                    stageWalletCompletion(walletResult, orderData, selectedPayment);
                    return { success: true, navigating: true, paymentType: "wallet" };
                }
                PaymentUtils.showSuccess(
                    walletResult.orderId,
                    "Payment Successful",
                    "Your payment has been received. Your order is being processed."
                );
                return { success: true, navigating: false, paymentType: "wallet" };
            }

            if (type === "manual" || type === "deeplink") {
                const market = String(orderData.region || selectedPayment.region || "").toUpperCase();
                const attemptSession = market === "MM"
                    ? await createCommerceManualPaymentCheckout(orderData)
                    : await createCommerceManualPromptPayCheckout(orderData);
                attemptSession.selectedPaymentMethod = selectedPayment;
                const attemptOrder = attemptSession.order || {
                    ...orderData,
                    orderId: attemptSession.orderId || attemptSession.commerceOrderId,
                    commerceOrderId: attemptSession.commerceOrderId || attemptSession.orderId,
                    commercePaymentAttemptId: attemptSession.attemptId,
                    quoteId: attemptSession.quoteId,
                    manualPaymentAttemptId: attemptSession.attemptId,
                    amount: attemptSession.amount,
                    currency: attemptSession.currency,
                    packageName: attemptSession.packageName,
                    game: attemptSession.productName
                };

                if (useBlockingLoader) PaymentUtils.hideLoading();

                if (orderData.pagePresentation === true) {
                    stagePaymentPage(attemptSession, attemptOrder, selectedPayment, type);
                    return { success: true, navigating: true, paymentType: type };
                }

                if (type === "deeplink") {
                    PaymentDeepLink.show(attemptOrder, attemptSession);
                    return { success: true, navigating: false, paymentType: type };
                }

                PaymentManual.show(attemptOrder, attemptSession);
                return { success: true, navigating: false, paymentType: type };
            }

            const paymentSession = await createPaymentSession(orderData);
            paymentSession.selectedPaymentMethod = selectedPayment;
            const canonicalOrder = paymentSession.order || orderData;

            if (useBlockingLoader) PaymentUtils.hideLoading();

                if (orderData.pagePresentation === true) {
                    stagePaymentPage(paymentSession, canonicalOrder, selectedPayment, type);
                    return { success: true, navigating: true, paymentType: type };
            }

            if (type === "auto") {
                PaymentPromptPay.show(canonicalOrder, paymentSession);
                return { success: true, navigating: false, paymentType: type };
            }

            if (type === "deeplink") {
                PaymentDeepLink.show(canonicalOrder, paymentSession);
                return { success: true, navigating: false, paymentType: type };
            }

            PaymentManual.show(canonicalOrder, paymentSession);
            return { success: true, navigating: false, paymentType: type };

        } catch (error) {
            console.log("Payment engine error:", error);
            if (useBlockingLoader) PaymentUtils.hideLoading();
            showPaymentError(error);
            return { success: false, navigating: false, errorCode: error?.code || "PAYMENT_START_FAILED" };
        }
    }

    window.AZIEL_PAYMENT = {
        start,
        createPaymentSession,
        createManualAttempt,
        createCommerceManualPromptPayCheckout,
        createCommerceManualPaymentCheckout,
        stageWalletCompletion
    };

})();
