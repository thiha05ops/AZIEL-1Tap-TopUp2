// frontend/js/payment/payment-deeplink.js
// AZIEL Deep Link Payment V2.5.1

(function () {
    function show(orderData, paymentSession) {
        const modal = PaymentUtils.prepareModal(orderData, paymentSession);
        if (!modal) return;

        const payment = window.selectedPaymentData || {};

        PaymentUtils.setModalTitle(`${payment.method || orderData.paymentMethod || "Manual"} Transfer`);
        PaymentUtils.hideQr();

        const accountName =
            paymentSession?.accountName ||
            payment.accountName ||
            "-";

        const accountNumber =
            paymentSession?.accountNumber ||
            payment.accountNumber ||
            "-";

        const provider =
            paymentSession?.provider ||
            payment.provider ||
            payment.key ||
            orderData.paymentProvider ||
            "";

        const bankName =
            payment.method ||
            payment.name ||
            orderData.paymentMethod ||
            "Payment";

        PaymentUtils.renderDynamic(`
            <div class="payment-transfer-area">
                ${copyCard(
            "Amount",
            `${Number(orderData.amount || 0).toLocaleString()} ${orderData.currency || ""}`,
            String(orderData.amount || 0)
        )}

                ${copyCard("Account Name", accountName, accountName)}

                ${copyCard("Account Number", accountNumber, accountNumber)}

                ${copyCard("Reference", orderData.orderId || orderData.topupId || "-", orderData.orderId || orderData.topupId || "")}

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

        bindEvents(orderData, provider);

        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerText = "Upload Payment Slip";
            confirmBtn.onclick = () => {
                const file = document.getElementById("manualPaymentSlip")?.files?.[0];

                if (!file) {
                    PaymentUtils.setMsg(
                        document.getElementById("manualPaymentMsg"),
                        "Please upload your payment slip first.",
                        "error"
                    );
                    return;
                }

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

    function bindEvents(orderData, provider) {
        document.querySelectorAll(".copy-transfer-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                PaymentUtils.copy(btn.dataset.copy || "");
            });
        });

        document.getElementById("openBankAppBtn")?.addEventListener("click", e => {
            const p = e.currentTarget.dataset.provider || provider || "";
            openPaymentApp(p);
        });

        PaymentUtils.bindSlipPreview();
    }

    function openPaymentApp(provider) {
        const link = getDeepLink(provider);

        const msgBox = document.getElementById("manualPaymentMsg");

        if (!link) {
            PaymentUtils.setMsg(
                msgBox,
                "This payment app cannot be opened automatically. Please open it manually.",
                "error"
            );
            return;
        }

        PaymentUtils.setMsg(
            msgBox,
            "Opening payment app... After transfer, return here and upload your payment slip.",
            "success"
        );

        setTimeout(() => {
            window.location.href = link;
        }, 300);
    }

    function getDeepLink(provider) {
        const p = String(provider || "").toLowerCase().trim();

        const links = {
            // Thailand banking apps
            scb: "scbeasy://",
            scbeasy: "scbeasy://",
            kplus: "kplus://",
            kasikorn: "kplus://",
            bbl: "bualuangmbanking://",
            bangkok: "bualuangmbanking://",
            ktb: "krungthainext://",
            krungthai: "krungthainext://",
            krungsri: "kma://",
            kma: "kma://",
            ttb: "ttbtouch://",

            // Myanmar wallet apps
            // iOS မှာ တကယ်ဖွင့်/မဖွင့် test လုပ်ရမယ်
            wavepay: "wavepay://",
            wave: "wavepay://",
            kbzpay: "kbzpay://",
            kbz: "kbzpay://",
            ayapay: "ayapay://",
            aya: "ayapay://",
            cbpay: "cbpay://",
            cb: "cbpay://",
            uabpay: "uabpay://",
            uab: "uabpay://"
        };

        return links[p] || "";
    }

    window.PaymentDeepLink = {
        show,
        getDeepLink,
        openPaymentApp
    };
})();
