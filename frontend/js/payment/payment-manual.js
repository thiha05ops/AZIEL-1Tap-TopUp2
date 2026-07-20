// frontend/js/payment/payment-manual.js
// AZIEL Manual QR Payment V2.5

(function () {
    function show(orderData, paymentSession) {
        const payment = window.selectedPaymentData || {};

        const qr =
            paymentSession.qrImage ||
            paymentSession.qrUrl ||
            payment.qrImage ||
            "";

        window.PaymentCheckoutSheet.show({
            methodCode: paymentSession.paymentMethod || payment.key || orderData.paymentMethod,
            methodName: window.AZIEL_PAYMENT_DISPLAY?.from?.(
                paymentSession.paymentName || payment.method || orderData.paymentMethod,
                paymentSession.paymentName || payment.method || orderData.paymentMethod || "Payment"
            ) || paymentSession.paymentName || payment.method || orderData.paymentMethod || "Payment",
            methodLogo: payment.logo || "",
            amount: paymentSession.amount || orderData.amount,
            currency: paymentSession.currency || orderData.currency,
            accountName: paymentSession.accountName || payment.accountName || "",
            accountNumber: paymentSession.accountNumber || payment.accountNumber || "",
            reference: paymentSession.reference || orderData.orderId || "",
            qrImageUrl: qr,
            instructions: "Transfer the exact amount, then upload the payment receipt.",
            requiresSlip: paymentSession.slipRequired !== false && payment.slipRequired !== false,
            enableSaveQr: paymentSession.enableSaveQr === true || payment.enableSaveQr === true,
            enableOpenApp: paymentSession.enableOpenApp === true || payment.enableOpenApp === true,
            enableChecklist: paymentSession.enableChecklist === true || payment.enableChecklist === true,
            appDisplayName: paymentSession.appDisplayName || payment.appDisplayName || paymentSession.paymentName || payment.method || "",
            deepLink: paymentSession.deepLink || paymentSession.deepLinkUrl || payment.deepLink || payment.deepLinkUrl || "",
            appStoreUrl: paymentSession.appStoreUrl || payment.appStoreUrl || "",
            playStoreUrl: paymentSession.playStoreUrl || payment.playStoreUrl || "",
            checklistSteps: paymentSession.checklistSteps || payment.checklistSteps || [],
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

    window.PaymentManual = {
        show
    };
})();
