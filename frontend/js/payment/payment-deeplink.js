// frontend/js/payment/payment-deeplink.js
// AZIEL canonical deep-link/manual transfer payment flow.

(function () {
    function show(orderData, paymentSession) {
        const payment = {
            ...(window.selectedPaymentData || {}),
            ...(paymentSession.selectedPaymentMethod || {})
        };
        const methodName = window.AZIEL_PAYMENT_DISPLAY?.from?.(
            paymentSession?.paymentName ||
            payment.method ||
            payment.name ||
            orderData.paymentMethod,
            paymentSession?.paymentName ||
            payment.method ||
            payment.name ||
            orderData.paymentMethod ||
            "Payment"
        ) ||
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
        const requiresSlip =
            paymentSession?.receiptUploadEnabled === false ||
            payment.receiptUploadEnabled === false
                ? false
                : paymentSession?.slipRequired !== false && payment.slipRequired !== false;

        async function submitCommerceReceipt(file, setMessage, close) {
            const orderId = paymentSession?.commerceOrderId || orderData.commerceOrderId || paymentSession?.orderId || orderData.orderId;
            const attemptId = paymentSession?.attemptId || orderData.commercePaymentAttemptId || orderData.manualPaymentAttemptId;
            if (!orderId || !attemptId) throw new Error("Payment attempt is unavailable.");
            const fd = new FormData();
            fd.append("slip", file);
            const res = await fetch(`/api/commerce/orders/${encodeURIComponent(orderId)}/payments/${encodeURIComponent(attemptId)}/receipt`, {
                method: "POST",
                headers: window.PaymentUtils?.authHeaders?.() || {},
                body: fd
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.message || "Submission failed. Please try again.");
            }
            setMessage("success", data.message || "Payment slip submitted");
            try {
                localStorage.removeItem("aziel:commerce-pending-payment");
            } catch (error) {
                // Recovery marker cleanup is best-effort.
            }
            window.PaymentUtils?.showSuccess?.(
                orderId,
                "Slip Submitted",
                "Waiting for Verification. Your payment slip has been submitted. We'll notify you after verification."
            );
            close("submitted");
            return true;
        }

        window.PaymentCheckoutSheet.show({
            ...payment,
            methodCode: paymentSession?.paymentMethod || payment.key || orderData.paymentMethod,
            methodName,
            methodLogo: payment.logo || payment.logoUrl || "",
            amount: paymentSession?.amount || orderData.amount,
            currency: paymentSession?.currency || orderData.currency,
            accountName: paymentSession?.accountName || payment.accountName || "",
            accountNumber: paymentSession?.accountNumber || payment.accountNumber || "",
            reference: paymentSession?.reference || orderData.orderId || orderData.topupId || "",
            attemptId: paymentSession?.attemptId || orderData.manualPaymentAttemptId || "",
            qrImageUrl: paymentSession?.qrImage || paymentSession?.qrUrl || payment.qrImage || "",
            qrMode: paymentSession?.qrMode || payment.qrMode || "",
            instructions: "Transfer the exact amount, then upload the payment receipt.",
            requiresSlip,
            deepLink,
            enableSaveQr: paymentSession?.enableSaveQr === true || payment.enableSaveQr === true,
            enableOpenApp: paymentSession?.enableOpenApp === true || payment.enableOpenApp === true,
            enableChecklist: paymentSession?.enableChecklist === true || payment.enableChecklist === true,
            appDisplayName: paymentSession?.appDisplayName || payment.appDisplayName || methodName,
            openAppMode: paymentSession?.openAppMode || payment.openAppMode || "disabled",
            deepLinkUrl: paymentSession?.deepLinkUrl || paymentSession?.deepLink || payment.deepLinkUrl || payment.deepLink || "",
            appLaunchMode: paymentSession?.appLaunchMode || payment.appLaunchMode || "",
            iosAppLaunchUrl: paymentSession?.iosAppLaunchUrl || payment.iosAppLaunchUrl || "",
            androidAppLaunchUrl: paymentSession?.androidAppLaunchUrl || payment.androidAppLaunchUrl || "",
            androidPackageName: paymentSession?.androidPackageName || payment.androidPackageName || "",
            appStoreUrl: paymentSession?.appStoreUrl || payment.appStoreUrl || "",
            playStoreUrl: paymentSession?.playStoreUrl || payment.playStoreUrl || "",
            appStoreFallbackUrl: paymentSession?.appStoreFallbackUrl || payment.appStoreFallbackUrl || "",
            playStoreFallbackUrl: paymentSession?.playStoreFallbackUrl || payment.playStoreFallbackUrl || "",
            galleryScanSupported: paymentSession?.galleryScanSupported === true || payment.galleryScanSupported === true,
            dynamicQrSupported: paymentSession?.dynamicQrSupported === true || payment.dynamicQrSupported === true,
            amountPrefillSupported: paymentSession?.amountPrefillSupported === true || payment.amountPrefillSupported === true,
            receiptUploadEnabled: paymentSession?.receiptUploadEnabled !== false && payment.receiptUploadEnabled !== false,
            checklistSteps: paymentSession?.checklistSteps || payment.checklistSteps || [],
            submitLabel: "Submit for Verification",
            loadingText: "Submitting receipt...",
            onSubmit: async ({ file, setMessage, close }) => {
                if (paymentSession?.commerce === true || paymentSession?.commerceOrderId || orderData.commerceOrderId) {
                    return submitCommerceReceipt(file, setMessage, close);
                }
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
