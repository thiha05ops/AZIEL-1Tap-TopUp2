// frontend/js/payment/payment-promptpay.js
// AZIEL PromptPay / Auto Payment V2.5

(function () {
    let pollingTimer = null;

    function show(orderData, paymentSession) {
        const modal = PaymentUtils.prepareModal(orderData, paymentSession);
        if (!modal) return;

        PaymentUtils.setModalTitle("Scan & Pay");

        const qr =
            paymentSession.qrUrl ||
            paymentSession.qrImage ||
            window.selectedPaymentData?.qrImage ||
            "";

        PaymentUtils.showQr(qr);

        PaymentUtils.renderDynamic(`
            <div class="promptpay-box">
                <p class="manual-payment-note">
                    <strong>Waiting for payment...</strong>
                    <span>Please scan the QR and complete payment.</span>
                </p>
            </div>
        `);

        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerText = "Waiting Payment...";
        }

        PaymentUtils.startCountdown(600);

        modal.classList.add("show");
        startPolling(orderData.orderId);
    }

    function startPolling(orderId) {
        stopPolling();

        pollingTimer = setInterval(async () => {
            try {
                const res = await fetch(
                    PaymentUtils.apiUrl(`/api/payment/status/${orderId}`)
                );

                const data = await res.json();

                if (!data.success) return;

                if (data.status === "paid") {
                    stopPolling();
                    PaymentUtils.stopCountdown();

                    PaymentUtils.showSuccess(
                        orderId,
                        "Payment Success",
                        "Payment detected. Admin will process your top-up soon."
                    );
                }
            } catch (error) {
                console.log("PromptPay polling error:", error);
            }
        }, 3000);
    }

    function stopPolling() {
        if (pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = null;
        }
    }

    window.PaymentPromptPay = {
        show,
        stopPolling
    };
})();