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
                return { success: false, error: data.message || "Wallet payment failed." };
            }

            const orderId = String(data.order?.orderId || data.orderId || orderData.orderId || "").trim();
            return {
                success: true,
                orderId,
                amount: Number(data.order?.amount ?? data.amount ?? orderData.amount ?? 0),
                currency: String(data.order?.currency || data.currency || orderData.currency || "").trim().toUpperCase(),
                order: data.order || null,
                data
            };

        } catch (error) {
            console.log("Wallet payment error:", error);
            PaymentUtils.hideLoading();
            window.AZIEL_UI?.toast?.error("Server error") ||
                PaymentUtils.showToast("Server error");
            return { success: false, error: "Server error" };
        }
    }

    window.PaymentWallet = {
        pay
    };
})();
