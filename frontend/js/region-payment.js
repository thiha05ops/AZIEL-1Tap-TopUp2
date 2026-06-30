// frontend/js/region-payment.js - AZIEL V2.5 Shop Region Payment Methods

document.addEventListener("DOMContentLoaded", async () => {
    await initRegionPayments();

    window.addEventListener("aziel:shopRegionChanged", async () => {
        await initRegionPayments();
    });
});

async function initRegionPayments() {
    const region =
        window.AZIEL?.getShopRegion?.() ||
        "MM";

    updatePaymentCurrencyText(region);
    await loadDynamicPaymentMethods(region);
}

function updatePaymentCurrencyText(region) {
    const currencyText = document.getElementById("currencyText");
    if (!currencyText) return;

    currencyText.innerText = region === "TH" ? "THB" : "MMK";
}

async function loadDynamicPaymentMethods(region) {
    const paymentGrid = document.getElementById("paymentGrid");
    const paymentMethod = document.getElementById("paymentMethod");

    if (!paymentGrid || !paymentMethod) return;

    paymentGrid.innerHTML = `<p>Loading payment methods...</p>`;
    paymentMethod.value = "";
    window.selectedPaymentData = null;

    try {
        const API_BASE =
            location.port === "5500"
                ? "http://localhost:3000"
                : "";

        const res = await fetch(`${API_BASE}/api/payment-methods?region=${region}`);
        const data = await res.json();

        const methods = Array.isArray(data.methods)
            ? data.methods.filter(method => method.enabled)
            : [];

        paymentGrid.innerHTML = "";

        if (!methods.length) {
            paymentGrid.innerHTML = `<p>No payment methods available.</p>`;
            document.dispatchEvent(new Event("paymentChanged"));
            return;
        }

        methods.forEach((pay, index) => {
            const name = pay.method || "Payment";
            const key = pay.key || name.toLowerCase();

            const logo = normalizeAssetPath(
                pay.logo || pay.qrImage || getPaymentLogo(key)
            );

            const qrImage = normalizeAssetPath(pay.qrImage || "");

            const card = document.createElement("div");
            card.className = `pay-card ${index === 0 ? "active" : ""}`;
            card.dataset.method = key;
            card.dataset.name = name;
            card.dataset.qr = qrImage;
            card.dataset.accountName = pay.accountName || "";
            card.dataset.accountNumber = pay.accountNumber || "";
            card.dataset.provider = pay.provider || "manual";
            card.dataset.paymentType = pay.paymentType || "manual";

            card.innerHTML = `
                <img src="${logo}" alt="${name}">
                <span>${name}</span>
                ${pay.maintenanceMessage
                    ? `<small>${pay.maintenanceMessage}</small>`
                    : ""
                }
            `;

            card.addEventListener("click", () => {
                selectPaymentCard(card);
            });

            paymentGrid.appendChild(card);

            if (index === 0) {
                selectPaymentCard(card);
            }
        });

    } catch (err) {
        console.error("Payment methods load error:", err);
        paymentGrid.innerHTML = `<p>Payment methods failed to load.</p>`;
        document.dispatchEvent(new Event("paymentChanged"));
    }
}

function selectPaymentCard(card) {
    const paymentMethod = document.getElementById("paymentMethod");
    if (!card || !paymentMethod) return;

    document
        .querySelectorAll(".pay-card")
        .forEach(c => c.classList.remove("active"));

    card.classList.add("active");

    paymentMethod.value = card.dataset.method || "";

    window.selectedPaymentData = {
        method: card.dataset.name || "Payment",
        key: card.dataset.method || "",
        logo: card.querySelector("img")?.getAttribute("src") || "",
        qrImage: card.dataset.qr || "",
        accountName: card.dataset.accountName || "",
        accountNumber: card.dataset.accountNumber || "",
        provider: card.dataset.provider || "manual",
        paymentType: card.dataset.paymentType || "manual"
    };

    updatePaymentPreview(card);

    document.dispatchEvent(new Event("paymentChanged"));
}

function getPaymentLogo(key) {
    const logos = {
        kbzpay: ASSET.payment("kbzpay.png"),
        wavepay: ASSET.payment("wavepay.png"),
        ayapay: ASSET.payment("ayapay.png"),
        promptpay: ASSET.payment("promptpay.png"),
        scb: ASSET.payment("scb.png"),
        wallet: ASSET.payment("wallet.png")
    };

    return logos[key] || ASSET.root("logo.png");
}

function normalizeAssetPath(path) {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    if (path.startsWith("data:")) return path;

    path = path.replace(/^\/+/, "");
    path = path.replace(/^frontend\//, "");

    return path;
}

function updatePaymentPreview(card) {
    const qrImg =
        document.getElementById("paymentQrImage") ||
        document.getElementById("qrImage");

    const accountName =
        document.getElementById("paymentAccountName");

    const accountNumber =
        document.getElementById("paymentAccountNumber");

    if (qrImg) {
        if (card.dataset.qr) {
            qrImg.src = normalizeAssetPath(card.dataset.qr);
            qrImg.style.display = "block";
        } else {
            qrImg.removeAttribute("src");
            qrImg.style.display = "none";
        }
    }

    if (accountName) {
        accountName.innerText = card.dataset.accountName || "";
    }

    if (accountNumber) {
        accountNumber.innerText = card.dataset.accountNumber || "";
    }
}