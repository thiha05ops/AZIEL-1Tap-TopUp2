// frontend/js/payment/payment-deeplink.js
// AZIEL Deep Link Payment V2.5

(function () {
    function show(orderData, paymentSession) {
        const modal = PaymentUtils.prepareModal(orderData, paymentSession);
        if (!modal) return;

        const payment = window.selectedPaymentData || {};

        PaymentUtils.setModalTitle(`${payment.method || orderData.paymentMethod} Transfer`);
        PaymentUtils.hideQr();

        const accountName =
            paymentSession.accountName ||
            payment.accountName ||
            "-";

        const accountNumber =
            paymentSession.accountNumber ||
            payment.accountNumber ||
            "-";

        const provider = payment.provider || payment.key || "";
        const bankName = payment.method || orderData.paymentMethod || "Bank";

        PaymentUtils.renderDynamic(`
            <div class="payment-transfer-area">
                ${copyCard(
            "Amount",
            `${Number(orderData.amount || 0).toLocaleString()} ${orderData.currency}`,
            String(orderData.amount || 0)
        )}

                ${copyCard("Account Name", accountName, accountName)}

                ${copyCard("Account Number", accountNumber, accountNumber)}

                ${copyCard("Order Reference", orderData.orderId, orderData.orderId)}

                <button
                    id="openBankAppBtn"
                    type="button"
                    class="payment-open-bank"
                    data-provider="${PaymentUtils.escapeHTML(provider)}"
                >
                    Open ${PaymentUtils.escapeHTML(bankName)} App
                </button>

                <div class="manual-payment-note">
                    <strong>Already transferred?</strong>
                    <span>Upload your payment slip and wait for admin verification.</span>
                </div>

                ${slipUploaderHTML()}

                <div id="manualPaymentMsg"></div>
            </div>
        `);

        bindEvents(orderData);

        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerText = "Submit Payment Slip";
            confirmBtn.onclick = () => {
                const file = document.getElementById("manualPaymentSlip")?.files?.[0];
                PaymentUtils.submitSlip(
                    orderData,
                    file,
                    document.getElementById("manualPaymentMsg"),
                    confirmBtn
                );
            };
        }

        PaymentUtils.startCountdown(600);
        modal.classList.add("show");
    }

    function copyCard(label, value, copyValue) {
        return `
            <div class="transfer-card">
                <h4>${PaymentUtils.escapeHTML(label)}</h4>

                <div class="transfer-row">
                    <strong>${PaymentUtils.escapeHTML(value || "-")}</strong>

                    <button
                        type="button"
                        class="copy-transfer-btn"
                        data-copy="${PaymentUtils.escapeHTML(copyValue || "")}"
                    >
                        Copy
                    </button>
                </div>
            </div>
        `;
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

    function bindEvents(orderData) {
        document.querySelectorAll(".copy-transfer-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                PaymentUtils.copy(btn.dataset.copy || "");
            });
        });

        document.getElementById("openBankAppBtn")?.addEventListener("click", e => {
            const provider = e.currentTarget.dataset.provider || "";
            const link = getDeepLink(provider);

            if (!link) {
                alert("Bank app unavailable.");
                return;
            }

            window.location.href = link;

            PaymentUtils.setMsg(
                document.getElementById("manualPaymentMsg"),
                "After transfer, return here and upload your payment slip.",
                "success"
            );
        });

        PaymentUtils.bindSlipPreview();
    }

    function getDeepLink(provider) {
        const p = String(provider || "").toLowerCase();

        const links = {
            scb: "scbeasy://",
            kplus: "kplus://",
            bbl: "bualuangmbanking://",
            bangkok: "bualuangmbanking://",
            ktb: "krungthainext://",
            krungsri: "kma://",
            ttb: "ttbtouch://"
        };

        return links[p] || "";
    }

    window.PaymentDeepLink = {
        show
    };
})();