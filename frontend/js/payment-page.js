// frontend/js/payment-page.js

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

    document.getElementById("orderIdText").innerText = orderId || "-";
    document.getElementById("gameText").innerText = game || "-";
    document.getElementById("packageText").innerText = packageName || "-";
    document.getElementById("userIdText").innerText = userId || "-";
    document.getElementById("zoneIdText").innerText = zoneId || "-";

    document.getElementById("amountText").innerText =
        currency === "THB"
            ? `${amount} ฿`
            : `${Number(amount).toLocaleString()} Ks`;

    const paymentData = {
        kbzpay: { name: "KBZPay", qr: "assets/payment/kbzpay-qr.png" },
        wavepay: { name: "WavePay", qr: "assets/payment/wavepay-qr.png" },
        ayapay: { name: "AYA Pay", qr: "assets/payment/ayapay-qr.png" },
        promptpay: { name: "PromptPay", qr: "assets/payment/promptpay-qr.png" },
        scb: { name: "SCB", qr: "assets/payment/scb-qr.png" }
    };

    const selected = paymentData[method] || paymentData.wavepay;

    document.getElementById("qrImage").src = selected.qr;
    document.getElementById("paymentName").innerText = selected.name;

    const submitBtn = document.getElementById("submitPaymentBtn");
    const fileInput = document.getElementById("paymentSlip");
    const previewBox =
        document.getElementById("slipPreviewBox");

    const previewImage =
        document.getElementById("slipPreviewImage");

    fileInput.addEventListener("change", () => {

        const file = fileInput.files[0];

        if (!file) return;

        const reader = new FileReader();

        reader.onload = (e) => {

            previewImage.src = e.target.result;

            previewBox.style.display = "block";
        };

        reader.readAsDataURL(file);
    });
    const removeSlipBtn =
        document.getElementById("removeSlipBtn");

    removeSlipBtn.addEventListener("click", (e) => {

        e.preventDefault();

        fileInput.value = "";

        previewImage.src = "";

        previewBox.style.display = "none";
    });
    const msg = document.getElementById("paymentMsg");

    initSuccessModal(orderId);

    submitBtn.addEventListener("click", async () => {
        const slip = fileInput.files[0];

        if (!slip) {
            msg.innerHTML = `<p class="error-msg">Please upload payment screenshot.</p>`;
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerText = "PAYING...";
        showOrderLoading();
        startUploadSteps();

        const formData = new FormData();
        formData.append("orderId", orderId);
        formData.append("slip", slip);

        try {
            const res = await fetch("/api/payment/submit", {
                method: "POST",
                body: formData
            });

            const data = await res.json();

            hideOrderLoading();

            if (!data.success) {
                msg.innerHTML = `<p class="error-msg">${data.message || "Payment submit failed."}</p>`;
                submitBtn.disabled = false;
                submitBtn.innerText = "Submit Payment";
                resetUploadSteps();
                return;
            }

            msg.innerHTML = `<p class="success-msg">Order Sent ✅</p>`;
            submitBtn.innerText = "ORDER SENT ✅";

            showSuccessModal();

        } catch (error) {
            console.log(error);
            hideOrderLoading();

            msg.innerHTML = `<p class="error-msg">Server error</p>`;
            submitBtn.disabled = false;
            submitBtn.innerText = "Submit Payment";
        }
    });
});

function showOrderLoading() {
    const overlay = document.getElementById("orderLoadingOverlay");
    if (overlay) overlay.classList.add("show");
}

function hideOrderLoading() {
    const overlay = document.getElementById("orderLoadingOverlay");
    if (overlay) overlay.classList.remove("show");
}

function showSuccessModal() {
    const modal = document.getElementById("successModal");
    if (modal) modal.classList.add("show");
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

    setTimeout(() => {
        step2.classList.add("active");
    }, 600);

    setTimeout(() => {
        step3.classList.add("active");
    }, 1200);
}

function resetUploadSteps() {
    document.getElementById("uploadSteps").style.display = "none";

    ["step1", "step2", "step3"].forEach(id => {
        document.getElementById(id)?.classList.remove("active");
    });
}
document.addEventListener("click", e => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) return;

    const url = new URL(href, window.location.href);

    if (url.origin === window.location.origin) {
        e.preventDefault();
        window.location.href = url.pathname + url.search + url.hash;
    }
});