// frontend/js/payment/payment-wallet.js
// AZIEL Wallet Payment V2.5

(function () {
    async function pay(orderData) {
        try {
            const res = await fetch(PaymentUtils.apiUrl("/api/wallet/pay"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...PaymentUtils.authHeaders()
                },
                body: JSON.stringify(orderData)
            });

            const data = await res.json();

            PaymentUtils.hideLoading();

            if (!res.ok || !data.success) {
                window.AZIEL_UI?.toast?.error(data.message || "Wallet payment failed.") ||
                    PaymentUtils.showToast(data.message || "Wallet payment failed.");
                return;
            }

            PaymentUtils.showSuccess(
                orderData.orderId,
                "Wallet Payment Success",
                "Paid with AZIEL Wallet. Admin will process your top-up soon."
            );

        } catch (error) {
            console.log("Wallet payment error:", error);
            PaymentUtils.hideLoading();
            window.AZIEL_UI?.toast?.error("Server error") ||
                PaymentUtils.showToast("Server error");
        }
    }

    window.PaymentWallet = {
        pay
    };
})();
