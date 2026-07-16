// frontend/js/payment/payment-deeplink.js
// AZIEL canonical deep-link/manual transfer payment flow.

(function () {
    function show(orderData, paymentSession) {
        const payment = window.selectedPaymentData || {};
        const methodName =
            paymentSession?.paymentName ||
            payment.method ||
            payment.name ||
            orderData.paymentMethod ||
            "Payment";
        const deepLink =
            paymentSession?.deepLink ||
            paymentSession?.deepLinkUrl ||
            payment.deepLink ||
            payment.deepLinkUrl ||
            "";

        window.PaymentCheckoutSheet.show({
            methodCode: paymentSession?.paymentMethod || payment.key || orderData.paymentMethod,
            methodName,
            methodLogo: payment.logo || "",
            amount: paymentSession?.amount || orderData.amount,
            currency: paymentSession?.currency || orderData.currency,
            accountName: paymentSession?.accountName || payment.accountName || "",
            accountNumber: paymentSession?.accountNumber || payment.accountNumber || "",
            reference: paymentSession?.reference || orderData.orderId || orderData.topupId || "",
            qrImageUrl: paymentSession?.qrImage || paymentSession?.qrUrl || payment.qrImage || "",
            instructions: "Transfer the exact amount, then upload the payment receipt.",
            requiresSlip: true,
            deepLink,
            submitLabel: "Submit for Verification",
            loadingText: "Submitting receipt...",
            onSubmit: async ({ file, setMessage, close }) => {
                const msgAdapter = {
                    set innerHTML(value) {
                        const text = String(value || "").replace(/<[^>]*>/g, "").trim();
                        setMessage(value.includes("error-msg") ? "error" : "success", text);
                    }
                };
                const success = await PaymentUtils.submitSlip(orderData, file, msgAdapter, null);
                if (success) close("submitted");
                return success;
            },
            onClose: () => {
                PaymentUtils.stopCountdown();
            }
        });
    }

    window.PaymentDeepLink = {
        show
    };
})();
