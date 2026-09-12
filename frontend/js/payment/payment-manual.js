// frontend/js/payment/payment-manual.js
// AZIEL Manual QR Payment V2.5

(function () {
    function paymentText(key, fallback) {
        return window.AZIEL_I18N?.t?.(key, fallback) || fallback;
    }

    async function submitCommerceReceipt(orderData, paymentSession, file, setMessage) {
        const orderId = paymentSession.commerceOrderId || orderData.commerceOrderId || paymentSession.orderId || orderData.orderId;
        const attemptId = paymentSession.attemptId || orderData.commercePaymentAttemptId || orderData.manualPaymentAttemptId;
        if (!orderId || !attemptId) throw new Error("Payment attempt is unavailable.");
        const fd = new FormData();
        fd.append("slip", file);
        const res = await fetch(`/api/commerce/orders/${encodeURIComponent(orderId)}/payments/${encodeURIComponent(attemptId)}/receipt`, { method: "POST", headers: window.PaymentUtils?.authHeaders?.() || {}, body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            const error = new Error("Payment verification failed.");
            error.code = data.code || data.error || "";
            error.retryable = data.retryable === true || res.status >= 500;
            error.httpStatus = res.status;
            throw error;
        }
        const result = data.payment || {};
        const pending = result.verificationStatus === "pending" || result.code === "SLIP_PENDING";
        const thunderVerified = String(paymentSession.confirmationMode || "") === "thunder_slip" || String(paymentSession.provider || "").toUpperCase() === "THUNDER_PROMPTPAY";
        const authoritativePaid = String(result.paymentStatus || "").toLowerCase() === "paid" || ["paid", "processing", "completed"].includes(String(result.orderStatus || data.order?.status || "").toLowerCase());
        if (thunderVerified) {
            if (authoritativePaid) {
                setMessage?.("success", paymentText("payment.thunder.verified", "Payment verified."));
            } else if (pending) {
                setMessage?.("", paymentText("payment.thunder.pending", "Payment verification is still pending. Please wait, then retry."));
            } else {
                setMessage?.("", paymentText("payment.thunder.retryable", "We couldn't verify your payment right now. Please try again."));
            }
        } else if (pending) {
            setMessage?.("success", result.message || "Payment is still being verified. Please retry shortly.");
        } else if (String(result.paymentStatus || "").toLowerCase() === "paid") {
            setMessage?.("success", "Payment verified.");
        } else {
            setMessage?.("success", data.message || "Payment slip submitted");
        }
        if (!pending && (!thunderVerified || authoritativePaid)) {
            try { localStorage.removeItem("aziel:commerce-pending-payment"); } catch (_) { /* best effort */ }
        }
        return { orderId, data };
    }

    async function submitReceipt(orderData, paymentSession, file, setMessage) {
        if (paymentSession.commerce === true || paymentSession.commerceOrderId || orderData.commerceOrderId) {
            return submitCommerceReceipt(orderData, paymentSession, file, setMessage);
        }
        const messageAdapter = { set innerHTML(value) { setMessage?.(String(value).includes("error-msg") ? "error" : "success", String(value || "").replace(/<[^>]*>/g, "").trim()); } };
        const data = await window.PaymentUtils.submitSlip(orderData, file, messageAdapter, null, { showSuccess: false, returnData: true });
        if (!data || data === false) throw new Error("Submission failed. Please try again.");
        return { orderId: data.order?.orderId || orderData.orderId || paymentSession.orderId || "", data };
    }

    function show(orderData, paymentSession) {
        const payment = {
            ...(window.selectedPaymentData || {}),
            ...(paymentSession.selectedPaymentMethod || {})
        };
        const thunderVerified = String(paymentSession.confirmationMode || payment.confirmationMode || "") === "thunder_slip" || String(paymentSession.provider || payment.provider || "").toUpperCase() === "THUNDER_PROMPTPAY";

        const qr =
            paymentSession.qrImage ||
            paymentSession.qrUrl ||
            payment.qrImage ||
            "";
        const requiresSlip =
            paymentSession.receiptUploadEnabled === false ||
            payment.receiptUploadEnabled === false
                ? false
                : paymentSession.slipRequired !== false && payment.slipRequired !== false;

        async function submitFromSheet(file, setMessage, close) {
            const { orderId, data } = await submitCommerceReceipt(orderData, paymentSession, file, setMessage);
            const orderStatus = String(data.order?.status || data.payment?.orderStatus || "").toLowerCase();
            const verified = String(data.payment?.paymentStatus || data.order?.paymentStatus || "").toLowerCase() === "paid" || ["paid", "processing", "completed"].includes(orderStatus);
            const pending = data.payment?.verificationStatus === "pending" || data.payment?.code === "SLIP_PENDING";
            if (thunderVerified && !verified && pending) return { status: "pending" };
            if (thunderVerified && !verified) return { status: "unconfirmed" };
            if (window.AZIEL_PAYMENT_PAGE_MODE === true) {
                if (pending) return true;
                sessionStorage.removeItem("azielPaymentPageSession");
                window.AZIEL_PAYMENT_PAGE?.showCompletion?.({
                    orderId,
                    status: verified ? "paid" : (data.order?.status || "pending_verification"),
                    paid: verified,
                    paymentReceived: verified
                });
                return thunderVerified ? { status: verified ? "verified" : "submitted" } : true;
            }
            if (pending) return true;
            window.PaymentUtils?.showSuccess?.(orderId, verified ? "Payment Verified" : "Slip Submitted", verified ? "Your payment has been confirmed. Processing your order..." : "Waiting for Verification. Your payment slip has been submitted. We'll notify you after verification.");
            close("submitted");
            return thunderVerified ? { status: verified ? "verified" : "submitted" } : true;
        }

        window.PaymentCheckoutSheet.show({
            ...payment,
            methodCode: paymentSession.paymentMethod || payment.key || orderData.paymentMethod,
            methodName: thunderVerified ? paymentText("payment.thunder.title", "PromptPay Transfer") : window.AZIEL_PAYMENT_DISPLAY?.from?.(
                paymentSession.paymentName || payment.method || orderData.paymentMethod,
                paymentSession.paymentName || payment.method || orderData.paymentMethod || "Payment"
            ) || paymentSession.paymentName || payment.method || orderData.paymentMethod || "Payment",
            methodLogo: payment.logo || payment.logoUrl || "",
            amount: paymentSession.amount || orderData.amount,
            currency: paymentSession.currency || orderData.currency,
            productName: paymentSession.productName || orderData.productName || orderData.game || "",
            game: paymentSession.productName || orderData.game || "",
            packageName: paymentSession.packageName || orderData.packageName || "",
            accountName: paymentSession.accountName || payment.accountName || "",
            accountNumber: paymentSession.accountNumber || payment.accountNumber || "",
            reference: paymentSession.reference || orderData.orderId || "",
            attemptId: paymentSession.attemptId || orderData.manualPaymentAttemptId || "",
            qrImageUrl: qr,
            qrMode: paymentSession.qrMode || payment.qrMode || "",
            instructions: thunderVerified ? paymentText("payment.thunder.instructions", "Pay the fixed amount, then upload the slip for automatic verification.") : "Transfer the exact amount, then upload the payment receipt.",
            requiresSlip,
            enableSaveQr: paymentSession.enableSaveQr === true || payment.enableSaveQr === true,
            enableOpenApp: paymentSession.enableOpenApp === true || payment.enableOpenApp === true,
            enableChecklist: paymentSession.enableChecklist === true || payment.enableChecklist === true,
            appDisplayName: paymentSession.appDisplayName || payment.appDisplayName || paymentSession.paymentName || payment.method || "",
            openAppMode: paymentSession.openAppMode || payment.openAppMode || "disabled",
            deepLink: paymentSession.deepLink || paymentSession.deepLinkUrl || payment.deepLink || payment.deepLinkUrl || "",
            deepLinkUrl: paymentSession.deepLinkUrl || paymentSession.deepLink || payment.deepLinkUrl || payment.deepLink || "",
            appLaunchMode: paymentSession.appLaunchMode || payment.appLaunchMode || "",
            iosAppLaunchUrl: paymentSession.iosAppLaunchUrl || payment.iosAppLaunchUrl || "",
            androidAppLaunchUrl: paymentSession.androidAppLaunchUrl || payment.androidAppLaunchUrl || "",
            androidPackageName: paymentSession.androidPackageName || payment.androidPackageName || "",
            appStoreUrl: paymentSession.appStoreUrl || payment.appStoreUrl || "",
            playStoreUrl: paymentSession.playStoreUrl || payment.playStoreUrl || "",
            appStoreFallbackUrl: paymentSession.appStoreFallbackUrl || payment.appStoreFallbackUrl || "",
            playStoreFallbackUrl: paymentSession.playStoreFallbackUrl || payment.playStoreFallbackUrl || "",
            galleryScanSupported: paymentSession.galleryScanSupported === true || payment.galleryScanSupported === true,
            dynamicQrSupported: paymentSession.dynamicQrSupported === true || payment.dynamicQrSupported === true,
            amountPrefillSupported: paymentSession.amountPrefillSupported === true || payment.amountPrefillSupported === true,
            receiptUploadEnabled: paymentSession.receiptUploadEnabled !== false && payment.receiptUploadEnabled !== false,
            autoSubmitReceipt: thunderVerified,
            checklistSteps: paymentSession.checklistSteps || payment.checklistSteps || [],
            submitLabel: thunderVerified ? "Upload Slip" : "Submit for Verification",
            loadingText: thunderVerified ? paymentText("payment.thunder.verifying", "Verifying payment...") : "Submitting receipt...",
            onSubmit: async ({ file, setMessage, close }) => {
                if (paymentSession.commerce === true || paymentSession.commerceOrderId || orderData.commerceOrderId) {
                    return submitFromSheet(file, setMessage, close);
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

    window.PaymentManual = {
        show,
        submitCommerceReceipt,
        submitReceipt
    };
})();
