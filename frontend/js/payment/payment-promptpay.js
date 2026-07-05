// frontend/js/payment/payment-promptpay.js
// AZIEL PromptPay / Auto Payment V2.5

(function () {
    let pollingTimer = null;

    function show(orderData, paymentSession) {
        const modal = prepareBaseModal(orderData, paymentSession);

        if (!modal) return;

        setModalTitle("Scan & Pay");

        showQr(paymentSession);

        removeDynamicAreas();

        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");

        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerText = "Waiting Payment...";
        }

        PaymentUtils.startCountdown(600);

        modal.classList.add("show");

        startPolling(orderData.orderId);
    }

    function prepareBaseModal(orderData, paymentSession) {
        const modal = document.getElementById("paymentConfirmModal");

        if (!modal) {
            alert("Payment modal not found");
            return null;
        }

        setText("modalOrderId", orderData.orderId);
        setText("modalGame", orderData.game);
        setText("modalPackage", orderData.packageName);
        setText("modalAmount", `${Number(orderData.amount || 0).toLocaleString()} ${orderData.currency}`);
        setText("modalPayment", paymentSession.paymentName || window.selectedPaymentData?.method || orderData.paymentMethod);
        setText("modalUserId", orderData.userId);
        setText("modalZoneId", orderData.zoneId);

        const logo = document.getElementById("modalPaymentLogo");
        const logoPath = paymentSession.logo || window.selectedPaymentData?.logo || "";

        if (logo) {
            logo.src = PaymentUtils.normalizeUrl(logoPath);
            logo.style.display = logoPath ? "block" : "none";
        }

        const closeBtn = document.getElementById("closePaymentModal");

        if (closeBtn) {
            closeBtn.onclick = () => {
                stopPolling();
                PaymentUtils.stopCountdown();
                modal.classList.remove("show");
            };
        }

        ensureCountdownHost();

        return modal;
    }

    function showQr(paymentSession) {
        const qr = document.getElementById("modalQrImage");

        if (!qr) return;

        const qrPath =
            paymentSession.qrUrl ||
            paymentSession.qrImage ||
            window.selectedPaymentData?.qrImage ||
            "";

        const finalQr = PaymentUtils.normalizeUrl(qrPath);

        if (!finalQr) {
            qr.removeAttribute("src");
            qr.style.display = "none";
            return;
        }

        qr.src = finalQr;
        qr.style.display = "block";
        qr.style.width = "220px";
        qr.style.height = "220px";
        qr.style.objectFit = "contain";
        qr.style.background = "#fff";
        qr.style.padding = "10px";
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

                    document
                        .getElementById("paymentConfirmModal")
                        ?.classList.remove("show");

                    showSuccess(orderId);
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

    function showSuccess(orderId) {
        const modal = document.getElementById("successModal");

        if (modal) {
            const title = modal.querySelector("h2");
            const text = modal.querySelector("p");

            if (title) title.innerText = "Payment Success";
            if (text) text.innerText = "Payment detected. Admin will process your top-up soon.";

            modal.classList.add("show");
        }

        const trackBtn = document.getElementById("trackOrderBtn");

        if (trackBtn) {
            trackBtn.onclick = () => {
                window.location.href = `tracking.html?orderId=${orderId}`;
            };
        }
    }

    function ensureCountdownHost() {
        const box =
            document.querySelector(".payment-confirm-box") ||
            document.querySelector(".payment-modal-box");

        if (!box) return;

        let timerBox = document.getElementById("paymentTimer");

        if (!timerBox) {
            timerBox = document.createElement("div");
            timerBox.id = "paymentTimer";
            timerBox.className = "payment-timer";
            timerBox.innerHTML = `Payment expires in <span id="countdown">10:00</span>`;
            box.appendChild(timerBox);
        }
    }

    function removeDynamicAreas() {
        document.getElementById("manualSlipArea")?.remove();
        document.getElementById("transferInfoArea")?.remove();
        document.getElementById("openBankAppBtn")?.remove();

        const accountName = document.getElementById("modalAccountName");
        const accountNumber = document.getElementById("modalAccountNumber");

        if (accountName?.parentElement) accountName.parentElement.style.display = "none";
        if (accountNumber?.parentElement) accountNumber.parentElement.style.display = "none";
    }

    function setModalTitle(title) {
        const box =
            document.querySelector(".payment-confirm-box") ||
            document.querySelector(".payment-modal-box");

        const heading = box?.querySelector("h2") || box?.querySelector("h3");
        if (heading) heading.innerText = title;
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerText = value || "";
    }

    window.PaymentPromptPay = {
        show,
        stopPolling
    };
})();