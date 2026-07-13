// frontend/js/payment/payment-engine.js
// AZIEL Payment Engine V2.5

(function () {
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
            throw new Error(data.message || "Create payment failed");
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
            window.AZIEL_UI?.toast?.error(error.message || "Payment failed") ||
                PaymentUtils.showToast(error.message || "Payment failed");
        }
    }

    window.AZIEL_PAYMENT = {
        start,
        createPaymentSession
    };

})();
