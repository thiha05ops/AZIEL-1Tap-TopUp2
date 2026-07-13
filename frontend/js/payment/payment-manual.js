// frontend/js/payment/payment-manual.js
// AZIEL Manual QR Payment V2.5

(function () {
    function show(orderData, paymentSession) {
        const modal = PaymentUtils.prepareModal(orderData, paymentSession);
        if (!modal) return;

        const payment = window.selectedPaymentData || {};

        PaymentUtils.setModalTitle("Scan & Upload Slip");

        const qr =
            paymentSession.qrImage ||
            paymentSession.qrUrl ||
            payment.qrImage ||
            "";

        PaymentUtils.showQr(qr);

        PaymentUtils.renderDynamic(`
            <div class="manual-payment-area">
                <div class="manual-payment-note">
                    <strong>Already paid?</strong>
                    <span>Upload your payment slip and wait for admin verification.</span>
                </div>

                ${slipUploaderHTML()}

                <div id="manualPaymentMsg"></div>
            </div>
        `);

        PaymentUtils.bindSlipPreview();

        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");
        if (confirmBtn) {
            PaymentUtils.configureManualSlipButton(
                orderData,
                document.getElementById("manualPaymentMsg"),
                confirmBtn
            );
        }

        PaymentUtils.startCountdown(600);
        modal.classList.add("show");
        requestAnimationFrame(() => {
            PaymentUtils.setManualSlipButtonState(confirmBtn, "initial");
        });
    }

    function slipUploaderHTML() {
        return `
            <label class="manual-slip-upload">
                <span>Upload Payment Slip</span>
                <input type="file" id="manualPaymentSlip" accept="image/*">
            </label>

            <div id="manualSlipPreviewBox" class="manual-slip-preview" style="display:none;">
                <img id="manualSlipPreviewImage" src="" alt="Payment Slip">
                <button type="button" id="removeManualSlipBtn">Remove</button>
            </div>
        `;
    }

    window.PaymentManual = {
        show
    };
})();
