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
                ? `${location.protocol}//${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000`
                : "";

        const res = await fetch(`${API_BASE}/api/payment-methods?region=${region}`);
        const data = await res.json();

        const methods = Array.isArray(data.methods)
            ? uniqueRegionPaymentMethodsByKey(data.methods)
                .filter(method => method.enabled)
                .filter(isRegionPaymentMethodUsable)
                .sort(sortRegionPaymentMethods)
            : [];

        paymentGrid.innerHTML = "";

        if (!methods.length) {
            paymentGrid.innerHTML = `<p>No payment methods available.</p>`;
            document.dispatchEvent(new Event("paymentChanged"));
            return;
        }

        methods.forEach((pay, index) => {
            const key = pay.key || normalizePaymentKey(pay.method);
            const name = window.AZIEL_PAYMENT_DISPLAY?.method?.({ ...pay, key }, pay.method || "Payment") ||
                pay.method ||
                "Payment";

            const logo = pay.logoUrl || getPaymentLogo(key);
            const qrImage = normalizeAssetPath(
                pay.finalQrImage ||
                pay.uploadedQrImage ||
                pay.qrImageUrl ||
                pay.qrImage ||
                ""
            );

            const card = document.createElement("div");
            card.className = `pay-card ${index === 0 ? "active" : ""}`;
            card.dataset.method = key;
            card.dataset.name = name;
            card.dataset.qr = qrImage;
            card.dataset.accountName = pay.accountName || "";
            card.dataset.accountNumber = pay.accountNumber || "";
            card.dataset.provider = pay.provider || "manual";
            card.dataset.paymentType = pay.paymentType || "manual";
            card.dataset.appDisplayName = pay.appDisplayName || name;
            card.dataset.deepLink = pay.deepLinkUrl || pay.deepLink || "";
            card.dataset.appStoreUrl = pay.appStoreUrl || "";
            card.dataset.playStoreUrl = pay.playStoreUrl || "";
            card.dataset.enableSaveQr = String(pay.enableSaveQr === true);
            card.dataset.enableOpenApp = String(pay.enableOpenApp === true);
            card.dataset.enableChecklist = String(pay.enableChecklist === true);
            card.dataset.dynamicQrSupported = String(pay.dynamicQrSupported === true);
            card.dataset.amountPrefillSupported = String(pay.amountPrefillSupported === true);
            card.dataset.referenceSupported = String(pay.referenceSupported === true);
            card.dataset.galleryScanSupported = String(pay.galleryScanSupported === true);
            card.dataset.slipRequired = String(pay.slipRequired !== false);
            card.dataset.autoVerificationSupported = String(pay.autoVerificationSupported === true);
            card.dataset.webhookSupported = String(pay.webhookSupported === true);
            card.dataset.checklistSteps = JSON.stringify(Array.isArray(pay.checklistSteps) ? pay.checklistSteps : []);
            card.dataset.shortDescription = pay.shortDescription || "";
            card.dataset.badgeText = pay.badgeText || "";

            card.innerHTML = `
                <img src="${logo}" alt="${name}">
                <span>${name}</span>
                ${pay.badgeText ? `<small>${pay.badgeText}</small>` : ""}
                ${pay.shortDescription ? `<small>${pay.shortDescription}</small>` : ""}
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

function sortRegionPaymentMethods(a = {}, b = {}) {
    const orderA = Number(a.sortOrder || 0);
    const orderB = Number(b.sortOrder || 0);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.method || a.key || "").localeCompare(String(b.method || b.key || ""));
}

function uniqueRegionPaymentMethodsByKey(methods = []) {
    const seen = new Set();
    return methods.filter(method => {
        const key = normalizePaymentKey(method.key || method.method || method.provider || "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isRegionPaymentMethodUsable(method = {}) {
    const type = String(method.paymentType || "manual").toLowerCase();
    const provider = normalizePaymentKey(method.provider || "");
    const key = normalizePaymentKey(method.key || method.method || "");
    if (method.publicReady === false) return false;
    if (String(method.maintenanceMessage || "").trim()) return false;
    if (key === "wallet" || type === "wallet" || provider === "wallet") return true;
    if (type === "auto" || provider === "omise") return true;

    const hasQr = Boolean(method.qrImage || method.qrImageUrl || method.uploadedQrImage || method.finalQrImage);
    const hasAccount = Boolean(method.accountName && method.accountNumber);
    return hasQr && hasAccount && isKnownRegionPaymentProvider(provider || key);
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
        paymentType: card.dataset.paymentType || "manual",
        appDisplayName: card.dataset.appDisplayName || card.dataset.name || "",
        deepLink: card.dataset.deepLink || "",
        deepLinkUrl: card.dataset.deepLink || "",
        appStoreUrl: card.dataset.appStoreUrl || "",
        playStoreUrl: card.dataset.playStoreUrl || "",
        enableSaveQr: card.dataset.enableSaveQr === "true",
        enableOpenApp: card.dataset.enableOpenApp === "true",
        enableChecklist: card.dataset.enableChecklist === "true",
        dynamicQrSupported: card.dataset.dynamicQrSupported === "true",
        amountPrefillSupported: card.dataset.amountPrefillSupported === "true",
        referenceSupported: card.dataset.referenceSupported === "true",
        galleryScanSupported: card.dataset.galleryScanSupported === "true",
        slipRequired: card.dataset.slipRequired === "true",
        autoVerificationSupported: card.dataset.autoVerificationSupported === "true",
        webhookSupported: card.dataset.webhookSupported === "true",
        checklistSteps: parseRegionChecklistSteps(card.dataset.checklistSteps)
    };

    updatePaymentPreview(card);

    document.dispatchEvent(new Event("paymentChanged"));
}

function parseRegionChecklistSteps(value) {
    try {
        const steps = JSON.parse(value || "[]");
        return Array.isArray(steps) ? steps : [];
    } catch (error) {
        return [];
    }
}

function getPaymentLogo(key) {
    const normalizedKey = normalizePaymentKey(key);
    const logos = {
        kbzpay: "assets/payment/kbzpay.png",
        wavepay: "assets/payment/wavepay.png",
        ayapay: "assets/payment/ayapay.png",
        promptpay: "assets/payment/promptpay.png",
        scb: "assets/payment/scb.png",
        bangkokbank: "assets/payment/bank-neutral.svg",
        kplus: "assets/payment/bank-neutral.svg",
        krungsri: "assets/payment/bank-neutral.svg",
        mmqr: "assets/payment/payment-neutral.svg",
        manualbank: "assets/payment/bank-neutral.svg",
        wallet: "assets/logo.png"
    };

    return logos[normalizedKey] || "assets/payment/payment-neutral.svg";
}

function isKnownRegionPaymentProvider(key) {
    return [
        "kbzpay",
        "wavepay",
        "ayapay",
        "promptpay",
        "scb",
        "bangkokbank",
        "kplus",
        "krungsri",
        "mmqr",
        "manualbank",
        "wallet"
    ].includes(normalizePaymentKey(key));
}

function normalizePaymentKey(value) {
    const key = String(value || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "")
        .replaceAll("-", "")
        .replaceAll("_", "")
        .replace(/[^a-z0-9]/g, "");
    const aliases = {
        azielwallet: "wallet",
        manualbanktransfer: "manualbank"
    };
    return aliases[key] || key;
}

function normalizeAssetPath(path) {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    if (path.startsWith("data:")) return path;

    if (path.startsWith("/uploads/") && location.port === "5500") {
        return `${location.protocol}//${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000${path}`;
    }

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
