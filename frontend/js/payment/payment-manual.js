// frontend/js/payment/payment-manual.js
// AZIEL Manual QR Payment V2.5

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

        //---------------------------------

        buildQR(paymentSession, payment);

        buildSlip(orderData);

        PaymentUtils.startCountdown(600);

        modal.classList.add("show");

    }

    // ==========================
    // QR
    // ==========================

    function buildQR(paymentSession, payment) {

        const qr =
            document.getElementById("modalQrImage");

        if (!qr) return;

        const image =
            paymentSession.qrImage ||
            paymentSession.qrUrl ||
            payment.qrImage ||
            "";

        if (!image) {

            qr.style.display = "none";

            return;

        }

        qr.src =
            PaymentUtils.normalizeUrl(image);

        qr.style.display = "block";

        qr.style.width = "220px";

        qr.style.height = "220px";

        qr.style.objectFit = "contain";

        qr.style.background = "#fff";

        qr.style.padding = "10px";

    }

    // ==========================
    // Slip
    // ==========================

    function buildSlip(orderData) {

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

<div
id="manualSlipPreview">

</div>

<button
id="submitManualSlip">

Submit Payment

</button>

<div
id="manualPaymentMsg">

</div>

`;

        document
            .querySelector(".payment-confirm-box")
            ?.appendChild(area);

        const input =
            document.getElementById(
                "manualPaymentSlip"
            );

        input.onchange =
            previewSlip;

        document
            .getElementById(
                "submitManualSlip"
            )
            .onclick =
            () =>
                submitSlip(orderData);

    }

    function previewSlip(e) {

        const file =
            e.target.files[0];

        if (!file) return;

        const reader =
            new FileReader();

        reader.onload =
            event => {

                document
                    .getElementById(
                        "manualSlipPreview"
                    )
                    .innerHTML =

                    `<img
                    src="${event.target.result}"
                    style="
                    width:100%;
                    border-radius:15px;
                    margin-top:15px;
                    ">`;

            };

        reader.readAsDataURL(file);

    }

    async function submitSlip(orderData) {

        const file =
            document
                .getElementById(
                    "manualPaymentSlip"
                )
                ?.files?.[0];

        if (!file) {

            alert(
                "Please upload payment slip."
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

    function setText(id, value) {

        const el =
            document.getElementById(id);

        if (el)
            el.innerText =
                value;

    }

    window.PaymentManual = {

        show

    };

})();