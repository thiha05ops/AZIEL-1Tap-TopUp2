document.addEventListener("DOMContentLoaded", () => {

    const params = new URLSearchParams(window.location.search);

    const orderId = params.get("orderId") || "";
    const amount = params.get("amount") || "";
    const currency = params.get("currency") || "MMK";
    const game = params.get("game") || "";
    const packageName = params.get("packageName") || "";
    const method = params.get("paymentMethod") || "wavepay";
    const userId = params.get("userId") || "";
    const zoneId = params.get("zoneId") || "";

    document.getElementById("orderIdText").innerText = orderId;
    document.getElementById("gameText").innerText = game;
    document.getElementById("packageText").innerText = packageName;
    document.getElementById("userIdText").innerText = userId;
    document.getElementById("zoneIdText").innerText = zoneId || "-";

    document.getElementById("amountText").innerText =
        currency === "THB"
            ? `${amount} ฿`
            : `${Number(amount).toLocaleString()} Ks`;

    const paymentData = {
        kbzpay: { name: "KBZPay", qr: "assets/payments/kbzpay-qr.png" },
        wavepay: { name: "WavePay", qr: "assets/payments/wavepay-qr.png" },
        ayapay: { name: "AYA Pay", qr: "assets/payments/ayapay-qr.png" },
        promptpay: { name: "PromptPay", qr: "assets/payments/promptpay-qr.png" },
        scb: { name: "SCB", qr: "assets/payments/scb-qr.png" }
    };

    const selected = paymentData[method] || paymentData.wavepay;

    document.getElementById("qrImage").src = selected.qr;
    document.getElementById("paymentName").innerText = selected.name;

    const submitBtn = document.getElementById("submitPaymentBtn");
    const fileInput = document.getElementById("paymentSlip");
    const msg = document.getElementById("paymentMsg");

    submitBtn.addEventListener("click", async () => {

        const slip = fileInput.files[0];

        if (!slip) {
            msg.innerHTML = `<p class="error-msg">Please upload payment screenshot.</p>`;
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerText = "PAYING...";

        const formData = new FormData();
        formData.append("slip", slip);
        formData.append("orderId", orderId);

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

            msg.innerHTML = `<p class="success-msg">Order Sent ✅</p>`;
            // 🔔 NOTIFICATION ADD (ဒီမှာထည့်)
            addNotification(
                `${game} ${packageName} order submitted`,
                orderId
            );

            document.getElementById("afterPaymentActions").style.display = "grid";

            document.getElementById("backGameBtn").onclick = () => {
                window.location.href = "mlbb.html";
            };

            document.getElementById("viewHistoryBtn").onclick = () => {
                window.location.href = "account.html";
            };

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