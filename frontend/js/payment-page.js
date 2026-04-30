// frontend/js/payment-page.js

document.addEventListener("DOMContentLoaded", () => {

    const params = new URLSearchParams(window.location.search);
    const userId = params.get("userId") || "";
    const zoneId = params.get("zoneId") || "";

    document.getElementById("userIdText").innerText = userId;
    document.getElementById("zoneIdText").innerText = zoneId || "-";

    const orderId = params.get("orderId") || "";
    const amount = params.get("amount") || "";
    const currency = params.get("currency") || "MMK";
    const game = params.get("game") || "";
    const packageName = params.get("packageName") || "";
    const method = params.get("paymentMethod") || "wavepay";

    document.getElementById("orderIdText").innerText = orderId;
    document.getElementById("gameText").innerText = game;
    document.getElementById("packageText").innerText = packageName;
    document.getElementById("amountText").innerText =
        currency === "THB" ? `${amount} ฿` : `${Number(amount).toLocaleString()} Ks`;

    const qrImage = document.getElementById("qrImage");
    const paymentName = document.getElementById("paymentName");

    const paymentData = {
        kbzpay: { name: "KBZPay", qr: "assets/payments/kbzpay-qr.png" },
        wavepay: { name: "WavePay", qr: "assets/payments/wavepay-qr.png" },
        ayapay: { name: "AYA Pay", qr: "assets/payments/ayapay-qr.png" },
        promptpay: { name: "PromptPay", qr: "assets/payments/promptpay-qr.png" },
        scb: { name: "SCB", qr: "assets/payments/scb-qr.png" }
    };

    const selected = paymentData[method] || paymentData.wavepay;

    qrImage.src = selected.qr;
    paymentName.innerText = selected.name;

    const submitBtn = document.getElementById("submitPaymentBtn");

    submitBtn.addEventListener("click", async () => {

        const slip = document.getElementById("paymentSlip").files[0];
        const msg = document.getElementById("paymentMsg");

        if (!slip) {
            msg.innerHTML = `<p class="error-msg">Please upload payment screenshot.</p>`;
            return;
        }

        const formData = new FormData();
        formData.append("slip", fileInput.files[0]); // MUST be "slip"
        formData.append("orderId", orderId);

        await fetch("/api/payment/submit", {
            method: "POST",
            body: formData
        });

        submitBtn.disabled = true;
        submitBtn.innerText = "Submitting...";

        try {
            const res = await fetch("/api/payment/submit", {
                method: "POST",
                body: formData
            });

            const data = await res.json();

            if (!data.success) {
                msg.innerHTML = `<p class="error-msg">${data.message}</p>`;
                submitBtn.disabled = false;
                submitBtn.innerText = "Submit Payment";
                return;
            }

            msg.innerHTML = `<p class="success-msg">Payment submitted ✅</p>`;

            setTimeout(() => {
                window.location.href = `tracking.html?orderId=${orderId}`;
            }, 1200);

        } catch (error) {
            console.log(error);
            msg.innerHTML = `<p class="error-msg">Server error</p>`;
            submitBtn.disabled = false;
            submitBtn.innerText = "Submit Payment";
        }

    });

});