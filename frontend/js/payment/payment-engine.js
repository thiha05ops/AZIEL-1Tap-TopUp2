// frontend/js/payment/payment-engine.js
// AZIEL Payment Engine V2.5

(function () {
    async function createPaymentSession(orderData) {
        const res = await fetch(PaymentUtils.apiUrl("/api/payment/create"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.message || "Create payment failed");
        }

        return data;
    }

    async function start(orderData) {
        const selectedPayment = window.selectedPaymentData || {};
        const type = selectedPayment.paymentType || orderData.paymentType || "manual";

        PaymentUtils.showLoading();

        try {
            if (type === "wallet" || selectedPayment.key === "wallet") {
                await window.PaymentWallet.pay(orderData);
                return;
            }

            const paymentSession = await createPaymentSession(orderData);
            PaymentUtils.hideLoading();

            if (type === "auto") {
                window.PaymentPromptPay.show(orderData, paymentSession);
                return;
            }

            if (type === "deeplink") {
                window.PaymentDeepLink.show(orderData, paymentSession);
                return;
            }

            window.PaymentManual.show(orderData, paymentSession);

        } catch (error) {
            console.log("Payment engine error:", error);
            PaymentUtils.hideLoading();
            alert(error.message || "Payment failed");
        }
    }

    window.AZIEL_PAYMENT = {
        start,
        createPaymentSession
    };
})();
