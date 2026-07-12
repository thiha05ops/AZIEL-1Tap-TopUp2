// frontend/js/payment-page.js
// AZIEL V2.5 Manual / Deeplink Payment Page

document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);

    const orderId = params.get("orderId") || "";
    const amount = params.get("amount") || "";
    const currency = params.get("currency") || "MMK";
    const game = params.get("game") || "";
    const packageName = params.get("packageName") || "";
    const method = (params.get("paymentMethod") || "wavepay").toLowerCase();
    const userId = params.get("userId") || "";
    const zoneId = params.get("zoneId") || "";

    const msg = document.getElementById("paymentMsg");
    const submitBtn = document.getElementById("submitPaymentBtn");
    const fileInput = document.getElementById("paymentSlip");
    const previewBox = document.getElementById("slipPreviewBox");
    const previewImage = document.getElementById("slipPreviewImage");
    const removeSlipBtn = document.getElementById("removeSlipBtn");

    const paymentData = {
        kbzpay: {
            name: "KBZPay",
            qr: "assets/payment/kbzpay-qr.png",
            type: "manual"
        },
        wavepay: {
            name: "WavePay",
            qr: "assets/payment/wavepay-qr.png",
            type: "manual"
        },
        ayapay: {
            name: "AYA Pay",
            qr: "assets/payment/ayapay-qr.png",
            type: "manual"
        },
        promptpay: {
            name: "PromptPay",
            qr: "assets/payment/promptpay-qr.png",
            type: "manual"
        },
        scb: {
            name: "SCB",
            qr: "assets/payment/scb-qr.png",
            type: "deeplink",
            deepLink: "scbeasy://"
        },
        kplus: {
            name: "K PLUS",
            qr: "assets/payment/kplus-qr.png",
            type: "deeplink",
            deepLink: "kplus://"
        },
        ktb: {
            name: "Krungthai NEXT",
            qr: "assets/payment/ktb-qr.png",
            type: "deeplink",
            deepLink: "krungthainext://"
        },
        bangkok: {
            name: "Bangkok Bank",
            qr: "assets/payment/bangkok-qr.png",
            type: "deeplink",
            deepLink: "bualuangmbanking://"
        },
        krungsri: {
            name: "Krungsri",
            qr: "assets/payment/krungsri-qr.png",
            type: "deeplink",
            deepLink: "kma://"
        },
        ttb: {
            name: "TTB Touch",
            qr: "assets/payment/ttb-qr.png",
            type: "deeplink",
            deepLink: "ttbtouch://"
        }
    };

    const selected = paymentData[method] || paymentData.wavepay;

    setText("orderIdText", orderId || "-");
    setText("gameText", game || "-");
    setText("packageText", packageName || "-");
    setText("userIdText", userId || "-");
    setText("zoneIdText", zoneId || "-");
    setText("amountText", formatAmount(amount, currency));
    setText("paymentName", selected.name);

    const qrImage = document.getElementById("qrImage");

    if (qrImage) {
        qrImage.src = selected.qr;
        qrImage.onerror = () => {
            qrImage.style.display = "none";
        };
    }

    initBankAppButton(selected, msg);
    initSlipPreview(fileInput, previewBox, previewImage, removeSlipBtn);
    initSuccessModal(orderId);

    submitBtn?.addEventListener("click", async () => {
        const slip = fileInput?.files?.[0];

        if (!slip) {
            setMessage(msg, "Please upload payment screenshot.", "error");
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerText = "SUBMITTING...";
        showOrderLoading();
        startUploadSteps();

        const formData = new FormData();
        formData.append("orderId", orderId);
        formData.append("slip", slip);

        try {
            const res = await fetch(apiUrl("/api/payment/submit"), {
                method: "POST",
                headers: window.AZIEL?.authHeaders?.() || {},
                body: formData
            });

            const data = await res.json();

            hideOrderLoading();

            if (!res.ok || !data.success) {
                setMessage(msg, data.message || "Payment submit failed.", "error");
                submitBtn.disabled = false;
                submitBtn.innerText = "Submit Payment";
                resetUploadSteps();
                return;
            }

            setMessage(msg, "Order sent ✅", "success");
            submitBtn.innerText = "ORDER SENT ✅";
            showSuccessModal();

        } catch (error) {
            console.log("Payment submit error:", error);
            hideOrderLoading();

            setMessage(msg, "Server error", "error");
            submitBtn.disabled = false;
            submitBtn.innerText = "Submit Payment";
            resetUploadSteps();
        }
    });
});

function initBankAppButton(selected, msg) {
    let btn = document.getElementById("openBankAppBtn");

    if (!btn) {
        const qrSection = document.querySelector(".qr-section");
        if (!qrSection) return;

        btn = document.createElement("button");
        btn.id = "openBankAppBtn";
        btn.type = "button";
        btn.innerText = `Open ${selected.name} App`;
        btn.style.display = "none";
        qrSection.appendChild(btn);
    }

    if (selected.type !== "deeplink" || !selected.deepLink) {
        btn.style.display = "none";
        return;
    }

    btn.style.display = "block";
    btn.innerText = `Open ${selected.name} App`;

    btn.onclick = () => {
        setMessage(
            msg,
            "Opening bank app. After transfer, return here and upload your payment slip.",
            "success"
        );

        window.location.href = selected.deepLink;
    };
}

function initSlipPreview(fileInput, previewBox, previewImage, removeSlipBtn) {
    fileInput?.addEventListener("change", () => {
        const file = fileInput.files?.[0];

        if (!file) return;

        const reader = new FileReader();

        reader.onload = e => {
            if (previewImage) previewImage.src = e.target.result;
            if (previewBox) previewBox.style.display = "block";
        };

        reader.readAsDataURL(file);
    });

    removeSlipBtn?.addEventListener("click", e => {
        e.preventDefault();

        if (fileInput) fileInput.value = "";
        if (previewImage) previewImage.src = "";
        if (previewBox) previewBox.style.display = "none";
    });
}

function showOrderLoading() {
    document.getElementById("orderLoadingOverlay")?.classList.add("show");
}

function hideOrderLoading() {
    document.getElementById("orderLoadingOverlay")?.classList.remove("show");
}

function showSuccessModal() {
    document.getElementById("successModal")?.classList.add("show");
}

function initSuccessModal(orderId) {
    const trackBtn = document.getElementById("trackOrderBtn");
    const homeBtn = document.getElementById("backHomeBtn");

    if (trackBtn) {
        trackBtn.onclick = () => {
            window.location.href = `tracking.html?orderId=${orderId}`;
        };
    }

    if (homeBtn) {
        homeBtn.onclick = () => {
            window.location.href = "home.html";
        };
    }
}

function startUploadSteps() {
    const box = document.getElementById("uploadSteps");
    const step1 = document.getElementById("step1");
    const step2 = document.getElementById("step2");
    const step3 = document.getElementById("step3");

    if (!box || !step1 || !step2 || !step3) return;

    box.style.display = "flex";
    step1.classList.add("active");

    setTimeout(() => step2.classList.add("active"), 600);
    setTimeout(() => step3.classList.add("active"), 1200);
}

function resetUploadSteps() {
    const box = document.getElementById("uploadSteps");
    if (box) box.style.display = "none";

    ["step1", "step2", "step3"].forEach(id => {
        document.getElementById(id)?.classList.remove("active");
    });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value || "";
}

function setMessage(el, message, type = "success") {
    if (!el) return;

    el.innerHTML = `
        <p class="${type === "error" ? "error-msg" : "success-msg"}">
            ${escapeHTML(message)}
        </p>
    `;
}

function formatAmount(amount, currency) {
    const n = Number(amount || 0);

    if (currency === "THB") {
        return `${n.toLocaleString()} ฿`;
    }

    return `${n.toLocaleString()} Ks`;
}

function apiUrl(path) {
    const base = location.port === "5500" ? "http://localhost:3000" : "";
    return `${base}${path}`;
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
