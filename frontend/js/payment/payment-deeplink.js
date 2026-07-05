// frontend/js/payment/payment-deeplink.js
// AZIEL Deep Link Payment V2.5

(function () {

    function show(orderData, paymentSession) {

        const modal =
            document.getElementById("paymentConfirmModal");

        if (!modal) return;

        const payment =
            window.selectedPaymentData || {};

        // ---------- Summary ----------

        setText("modalOrderId", orderData.orderId);

        setText("modalGame", orderData.game);

        setText("modalPackage", orderData.packageName);

        setText(
            "modalAmount",
            `${Number(orderData.amount).toLocaleString()} ${orderData.currency}`
        );

        setText(
            "modalPayment",
            payment.method || orderData.paymentMethod
        );

        setText(
            "modalUserId",
            orderData.userId
        );

        setText(
            "modalZoneId",
            orderData.zoneId
        );

        //--------------------------------

        buildTransferInfo(
            orderData,
            paymentSession,
            payment
        );

        buildOpenBankButton(payment);

        buildSlipUploader(orderData);

        PaymentUtils.startCountdown(600);

        modal.classList.add("show");

    }

    // =========================

    function buildTransferInfo(
        orderData,
        paymentSession,
        payment
    ) {

        document
            .getElementById("transferInfoArea")
            ?.remove();

        const area =
            document.createElement("div");

        area.id = "transferInfoArea";

        area.className =
            "payment-transfer-area";

        area.innerHTML = `

<div class="transfer-card">

<h4>Amount</h4>

<div class="transfer-row">

<strong>

${Number(orderData.amount).toLocaleString()}
${orderData.currency}

</strong>

<button
onclick="PaymentUtils.copy('${orderData.amount}')">

Copy

</button>

</div>

</div>



<div class="transfer-card">

<h4>Account Name</h4>

<div class="transfer-row">

<strong>

${payment.accountName || "-"}

</strong>

<button
onclick="PaymentUtils.copy('${payment.accountName || ""}')">

Copy

</button>

</div>

</div>



<div class="transfer-card">

<h4>Account Number</h4>

<div class="transfer-row">

<strong>

${payment.accountNumber || "-"}

</strong>

<button
onclick="PaymentUtils.copy('${payment.accountNumber || ""}')">

Copy

</button>

</div>

</div>



<div class="transfer-card">

<h4>Reference</h4>

<div class="transfer-row">

<strong>

${orderData.orderId}

</strong>

<button
onclick="PaymentUtils.copy('${orderData.orderId}')">

Copy

</button>

</div>

</div>

`;

        document
            .querySelector(".payment-confirm-box")
            ?.appendChild(area);

    }

    // =========================

    function buildOpenBankButton(payment) {

        document
            .getElementById("openBankAppBtn")
            ?.remove();

        const btn =
            document.createElement("button");

        btn.id =
            "openBankAppBtn";

        btn.className =
            "payment-open-bank";

        btn.innerText =
            `Open ${payment.method} App`;

        btn.onclick = () => {

            const link =
                getDeepLink(
                    payment.provider ||
                    payment.key
                );

            if (!link) {

                alert(
                    "Bank app unavailable."
                );

                return;

            }

            window.location.href =
                link;

        };

        document
            .querySelector(".payment-confirm-box")
            ?.appendChild(btn);

    }

    // =========================

    function buildSlipUploader(orderData) {

        document
            .getElementById("manualSlipArea")
            ?.remove();

        const area =
            document.createElement("div");

        area.id =
            "manualSlipArea";

        area.innerHTML = `

<label class="upload-box">

Upload Payment Slip

<input
type="file"
id="manualPaymentSlip"
accept="image/*">

</label>

<button
id="submitSlipBtn">

Submit Payment

</button>

<div id="manualPaymentMsg"></div>

`;

        document
            .querySelector(".payment-confirm-box")
            ?.appendChild(area);

        document
            .getElementById("submitSlipBtn")
            .onclick =
            () =>
                submitSlip(orderData);

    }

    // =========================

    async function submitSlip(orderData) {

        const file =
            document
                .getElementById(
                    "manualPaymentSlip"
                )
                ?.files?.[0];

        if (!file) {

            alert(
                "Upload payment slip."
            );

            return;

        }

        const fd =
            new FormData();

        fd.append(
            "orderId",
            orderData.orderId
        );

        fd.append(
            "slip",
            file
        );

        const res =
            await fetch(
                PaymentUtils.apiUrl(
                    "/api/payment/submit"
                ),
                {
                    method: "POST",
                    body: fd
                }
            );

        const data =
            await res.json();

        if (!data.success) {

            alert(
                data.message
            );

            return;

        }

        document
            .getElementById(
                "paymentConfirmModal"
            )
            ?.classList.remove("show");

        document
            .getElementById(
                "successModal"
            )
            ?.classList.add("show");

    }

    // =========================

    function getDeepLink(provider) {

        provider =
            String(provider)
                .toLowerCase();

        const links = {

            scb:
                "scbeasy://",

            kplus:
                "kplus://",

            bbl:
                "bualuangmbanking://",

            ktb:
                "krungthainext://",

            krungsri:
                "kma://",

            ttb:
                "ttbtouch://"

        };

        return links[
            provider
        ] || "";

    }

    function setText(id, value) {

        const el =
            document.getElementById(id);

        if (el)
            el.innerText =
                value;

    }

    window.PaymentDeepLink = {

        show

    };

})();