// frontend/js/payment.js

document.addEventListener("DOMContentLoaded", () => {
    loadPaymentMethods();
});

// Store selected payment object globally
window.selectedPaymentData = null;

async function loadPaymentMethods() {
    const paymentGrid = document.getElementById("paymentGrid");
    const paymentInput = document.getElementById("paymentMethod");

    if (!paymentGrid || !paymentInput) return;

    const region =
        localStorage.getItem("region") ||
        localStorage.getItem("selectedRegion") ||
        "MM";

    paymentGrid.innerHTML = `
        <p class="pay-loading">
            Loading payment methods...
        </p>
    `;

    paymentInput.value = "";
    window.selectedPaymentData = null;

    try {
        const res = await fetch(
            `/api/payment-methods?region=${region}`
        );

        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(
                data.message ||
                "Failed to load payment methods"
            );
        }

        const methods =
            Array.isArray(data.methods)
                ? data.methods
                : [];

        const activeMethods = methods.filter(method =>
            method.enabled === true
        );

        paymentGrid.innerHTML = "";

        if (!activeMethods.length) {
            paymentGrid.innerHTML = `
                <p class="pay-empty">
                    No payment methods available.
                </p>
            `;
            return;
        }

        activeMethods.forEach((method, index) => {
            const card =
                buildPaymentCard(method, index);

            paymentGrid.appendChild(card);
        });

        const firstCard =
            paymentGrid.querySelector(".pay-card");

        if (firstCard) {
            selectPaymentCard(firstCard);
        }

    } catch (error) {
        console.error("Load payment methods error:", error);

        paymentGrid.innerHTML = `
            <p class="pay-error">
                Payment methods failed to load.
            </p>
        `;
    }
}

function buildPaymentCard(method, index) {
    const key =
        method.key ||
        normalizePaymentKey(method.method);

    const displayName =
        method.method ||
        getPaymentDisplayName(key);

    const logo =
        getPaymentLogo(key);

    const qrImage =
        method.finalQrImage ||
        method.uploadedQrImage ||
        method.qrImageUrl ||
        method.qrImage ||
        "";

    const card =
        document.createElement("div");

    card.className =
        `pay-card ${index === 0 ? "active" : ""}`;

    card.dataset.method = key;
    card.dataset.name = displayName;
    card.dataset.logo = logo;
    card.dataset.qr = qrImage;
    card.dataset.accountName = method.accountName || "";
    card.dataset.accountNumber = method.accountNumber || "";
    card.dataset.paymentType = method.paymentType || "manual";
    card.dataset.provider = method.provider || "manual";
    card.dataset.maintenanceMessage =
        method.maintenanceMessage || "";

    card.innerHTML = `
        <img
            src="${logo}"
            class="pay-logo"
            alt="${displayName}"
        >

        <div class="pay-info">
            <span>${displayName}</span>

            ${method.paymentType === "auto"
            ? `<small class="auto-pay-badge">Auto Ready</small>`
            : `<small class="manual-pay-badge">Manual</small>`
        }

            ${method.maintenanceMessage
            ? `<small class="pay-message">
                        ${method.maintenanceMessage}
                    </small>`
            : ""
        }
        </div>
    `;

    card.addEventListener("click", () => {
        selectPaymentCard(card);
    });

    return card;
}

function selectPaymentCard(card) {
    const paymentInput =
        document.getElementById("paymentMethod");

    document
        .querySelectorAll(".pay-card")
        .forEach(c => c.classList.remove("active"));

    card.classList.add("active");

    if (paymentInput) {
        paymentInput.value =
            card.dataset.method || "";
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
        maintenanceMessage:
            card.dataset.maintenanceMessage || ""
    };

    localStorage.setItem(
        "selectedPaymentMethod",
        window.selectedPaymentData.key
    );

    localStorage.setItem(
        "selectedPaymentName",
        window.selectedPaymentData.method
    );

    localStorage.setItem(
        "selectedPaymentQr",
        window.selectedPaymentData.qrImage
    );

    localStorage.setItem(
        "selectedPaymentAccountName",
        window.selectedPaymentData.accountName
    );

    localStorage.setItem(
        "selectedPaymentAccountNumber",
        window.selectedPaymentData.accountNumber
    );

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