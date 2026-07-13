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

            const paymentSession = await createPaymentSession(orderData);
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
        createPaymentSession
    };

})();
