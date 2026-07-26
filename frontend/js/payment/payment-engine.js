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

        console.log("PAYMENT CREATE DATA:", data);

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

        console.log("MANUAL PAYMENT ATTEMPT DATA:", data);

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

    async function start(orderData) {
        const selectedPayment = window.selectedPaymentData || {};
        const type =
            selectedPayment.paymentType ||
            orderData.paymentType ||
            "manual";

        PaymentUtils.showLoading();

        try {
            if (type === "wallet" || selectedPayment.key === "wallet") {
                await PaymentWallet.pay(orderData);
                return;
            }

            if (type === "manual" || type === "deeplink") {
                const attemptSession = await createCommerceManualPromptPayCheckout(orderData);
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

                PaymentUtils.hideLoading();

                if (type === "deeplink") {
                    PaymentDeepLink.show(attemptOrder, attemptSession);
                    return;
                }

                PaymentManual.show(attemptOrder, attemptSession);
                return;
            }

            const paymentSession = await createPaymentSession(orderData);
            paymentSession.selectedPaymentMethod = selectedPayment;
            const canonicalOrder = paymentSession.order || orderData;

            PaymentUtils.hideLoading();

            if (type === "auto") {
                PaymentPromptPay.show(canonicalOrder, paymentSession);
                return;
            }

            if (type === "deeplink") {
                PaymentDeepLink.show(canonicalOrder, paymentSession);
                return;
            }

            PaymentManual.show(canonicalOrder, paymentSession);

        } catch (error) {
            console.log("Payment engine error:", error);
            PaymentUtils.hideLoading();
            showPaymentError(error);
        }
    }

    window.AZIEL_PAYMENT = {
        start,
        createPaymentSession,
        createManualAttempt,
        createCommerceManualPromptPayCheckout
    };

})();
