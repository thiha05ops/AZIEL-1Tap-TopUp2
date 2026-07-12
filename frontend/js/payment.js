// frontend/js/payment.js
// AZIEL V2.5 Dynamic Payment Methods + Wallet

document.addEventListener("DOMContentLoaded", () => {
    loadPaymentMethods();

    window.addEventListener("aziel:shopRegionChanged", () => {
        loadPaymentMethods();
    });
});

window.selectedPaymentData = null;

async function loadPaymentMethods() {
    const paymentGrid = document.getElementById("paymentGrid");
    const paymentInput = document.getElementById("paymentMethod");

    if (!paymentGrid || !paymentInput) return;

    const region =
        localStorage.getItem("region") ||
        localStorage.getItem("selectedRegion") ||
        "MM";

    paymentGrid.innerHTML = `<p class="pay-loading">Loading payment methods...</p>`;
    paymentInput.value = "";
    window.selectedPaymentData = null;
    document.dispatchEvent(new Event("paymentChanged"));

    try {
        const API_BASE = location.port === "5500" ? "http://localhost:3000" : "";
        const res = await fetch(`${API_BASE}/api/payment-methods?region=${region}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.message || "Failed to load payment methods");
        }

        let methods = Array.isArray(data.methods) ? data.methods : [];
        methods = methods.filter(method => method.enabled === true);

        methods.push(getWalletMethod(region));

        paymentGrid.innerHTML = "";

        if (!methods.length) {
            paymentGrid.innerHTML = `<p class="pay-empty">No payment methods available.</p>`;
            document.dispatchEvent(new Event("paymentChanged"));
            return;
        }

        methods.forEach((method, index) => {
            paymentGrid.appendChild(buildPaymentCard(method, index));
        });

        const firstCard = paymentGrid.querySelector(".pay-card");
        if (firstCard) selectPaymentCard(firstCard);

    } catch (error) {
        console.error("Load payment methods error:", error);
        paymentGrid.innerHTML = `<p class="pay-error">Payment methods failed to load.</p>`;
        document.dispatchEvent(new Event("paymentChanged"));
    }
}

function getWalletMethod(region) {
    return {
        method: "AZIEL Wallet",
        key: "wallet",
        region,
        enabled: true,
        paymentType: "wallet",
        provider: "wallet",
        logo: "assets/logo.png",
        accountName: "",
        accountNumber: "",
        maintenanceMessage: "Pay instantly using your AZIEL wallet balance."
    };
}

function buildPaymentCard(method, index) {
    const key = method.key || normalizePaymentKey(method.method);
    const displayName = method.method || getPaymentDisplayName(key);
    const logo = method.logo || method.logoUrl || method.logoImage || getPaymentLogo(key);

    const qrImage =
        method.finalQrImage ||
        method.uploadedQrImage ||
        method.qrImageUrl ||
        method.qrImage ||
        method.qrImagePath ||
        method.paymentQr ||
        method.paymentQrImage ||
        "";

    const region =
        method.region ||
        localStorage.getItem("region") ||
        localStorage.getItem("selectedRegion") ||
        "MM";

    let paymentType = method.paymentType || "manual";
    let provider = method.provider || "manual";

    if (key === "wallet") {
        paymentType = "wallet";
        provider = "wallet";
    }

    if (String(region).toUpperCase() === "TH" && key === "promptpay") {
        paymentType = "auto";
        provider = "omise";
    }

    if (String(region).toUpperCase() === "TH" && key === "scb") {
        paymentType = "deeplink";
        provider = "scb";
    }

    const card = document.createElement("div");
    card.className = `pay-card ${index === 0 ? "active" : ""}`;

    card.dataset.method = key;
    card.dataset.name = displayName;
    card.dataset.logo = logo;
    card.dataset.qr = qrImage;
    card.dataset.accountName = method.accountName || "";
    card.dataset.accountNumber = method.accountNumber || "";
    card.dataset.paymentType = paymentType;
    card.dataset.provider = provider;
    card.dataset.region = region;
    card.dataset.maintenanceMessage = method.maintenanceMessage || "";

    card.innerHTML = `
        <img src="${logo}" class="pay-logo" alt="${displayName}">

        <div class="pay-info">
            <span>${displayName}</span>
            ${getPaymentBadge(paymentType)}
            ${method.maintenanceMessage ? `<small class="pay-message">${method.maintenanceMessage}</small>` : ""}
        </div>
    `;

    card.addEventListener("click", () => selectPaymentCard(card));
    return card;
}

function getPaymentBadge(paymentType) {
    if (paymentType === "auto") {
        return `<small class="auto-pay-badge">Auto</small>`;
    }

    if (paymentType === "deeplink") {
        return `<small class="manual-pay-badge">Bank App</small>`;
    }

    if (paymentType === "wallet") {
        return `<small class="auto-pay-badge">Wallet Pay</small>`;
    }

    return `<small class="manual-pay-badge">Manual</small>`;
}

function selectPaymentCard(card) {
    const paymentInput = document.getElementById("paymentMethod");

    document.querySelectorAll(".pay-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");

    if (paymentInput) {
        paymentInput.value = card.dataset.method || "";
    }

    window.selectedPaymentData = {
        key: card.dataset.method || "",
        method: card.dataset.name || "",
        logo: card.dataset.logo || "",
        qrImage: card.dataset.qr || "",
        accountName: card.dataset.accountName || "",
        accountNumber: card.dataset.accountNumber || "",
        paymentType: card.dataset.paymentType || "manual",
        provider: card.dataset.provider || "manual",
        region: card.dataset.region || "",
        maintenanceMessage: card.dataset.maintenanceMessage || ""
    };

    localStorage.setItem("selectedPaymentMethod", window.selectedPaymentData.key);
    localStorage.setItem("selectedPaymentName", window.selectedPaymentData.method);
    localStorage.setItem("selectedPaymentQr", window.selectedPaymentData.qrImage);
    localStorage.setItem("selectedPaymentAccountName", window.selectedPaymentData.accountName);
    localStorage.setItem("selectedPaymentAccountNumber", window.selectedPaymentData.accountNumber);
    localStorage.setItem("selectedPaymentType", window.selectedPaymentData.paymentType);
    localStorage.setItem("selectedPaymentProvider", window.selectedPaymentData.provider);

    console.log("SELECTED PAYMENT =", window.selectedPaymentData);

    document.dispatchEvent(
        new CustomEvent("paymentChanged", {
            detail: window.selectedPaymentData
        })
    );
}

function normalizePaymentKey(name) {
    return String(name || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^a-z0-9]/g, "");
}

function getPaymentDisplayName(key) {
    const names = {
        kbzpay: "KBZPay",
        wavepay: "WavePay",
        ayapay: "AYA Pay",
        promptpay: "PromptPay",
        scb: "SCB",
        wallet: "AZIEL Wallet"
    };

    return names[key] || "Payment";
}

function getPaymentLogo(key) {
    const logos = {
        kbzpay: "assets/payment/kbzpay.png",
        wavepay: "assets/payment/wavepay.png",
        ayapay: "assets/payment/ayapay.png",
        promptpay: "assets/payment/promptpay.png",
        scb: "assets/payment/scb.png",
        wallet: "assets/logo.png"
    };

    return logos[key] || "assets/logo.png";
}

window.loadPaymentMethods = loadPaymentMethods;
