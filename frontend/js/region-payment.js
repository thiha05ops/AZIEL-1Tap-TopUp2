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
        window.AZIEL_TH_BANK_APPS = getConfiguredRegionThaiBankApps(methods);

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
            card.__paymentMethod = normalizeSelectedRegionPayment(pay, {
                key,
                name,
                logo,
                qrImage
            });
            card.dataset.method = key;
            card.dataset.name = name;
            card.dataset.qr = qrImage;
            card.dataset.accountName = pay.accountName || "";
            card.dataset.accountNumber = pay.accountNumber || "";
            card.dataset.provider = pay.provider || "manual";
            card.dataset.paymentType = pay.paymentType || "manual";
            card.dataset.appDisplayName = pay.appDisplayName || name;
            card.dataset.openAppMode = pay.openAppMode || "";
            card.dataset.deepLink = pay.deepLinkUrl || pay.deepLink || "";
            card.dataset.appStoreUrl = pay.appStoreUrl || "";
            card.dataset.playStoreUrl = pay.playStoreUrl || "";
            card.dataset.appLaunchMode = pay.appLaunchMode || "";
            card.dataset.iosAppLaunchUrl = pay.iosAppLaunchUrl || "";
            card.dataset.androidAppLaunchUrl = pay.androidAppLaunchUrl || "";
            card.dataset.appStoreFallbackUrl = pay.appStoreFallbackUrl || "";
            card.dataset.playStoreFallbackUrl = pay.playStoreFallbackUrl || "";
            card.dataset.qrMode = pay.qrMode || "";
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

function getConfiguredRegionThaiBankApps(methods = []) {
    return methods
        .filter(method => String(method.region || "").toUpperCase() === "TH")
        .filter(method => {
            const key = normalizePaymentKey(method.key || method.method || "");
            const type = String(method.paymentType || "").toLowerCase();
            const provider = normalizePaymentKey(method.provider || "");
            return key !== "promptpay" &&
                key !== "wallet" &&
                provider !== "wallet" &&
                method.enableOpenApp === true &&
                (method.openAppMode || "direct") !== "disabled" &&
                (type === "deeplink" || type === "manual" || method.enableOpenApp === true);
        })
        .map(method => ({
            key: method.key || normalizePaymentKey(method.method || ""),
            label: method.appDisplayName || method.method || "Banking App",
            logo: method.logoUrl || method.logo || getPaymentLogo(method.key || method.provider || method.method),
            enabled: method.enabled === true,
            openAppMode: method.openAppMode || "direct",
            deepLink: method.deepLinkUrl || method.deepLink || "",
            appLaunchMode: method.appLaunchMode || "",
            iosAppLaunchUrl: method.iosAppLaunchUrl || "",
            androidAppLaunchUrl: method.androidAppLaunchUrl || "",
            appStoreUrl: method.appStoreUrl || "",
            playStoreUrl: method.playStoreUrl || "",
            appStoreFallbackUrl: method.appStoreFallbackUrl || "",
            playStoreFallbackUrl: method.playStoreFallbackUrl || ""
        }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

function isRegionPaymentMethodUsable(method = {}) {
    const type = String(method.paymentType || "manual").toLowerCase();
    const provider = normalizePaymentKey(method.provider || "");
    const key = normalizePaymentKey(method.key || method.method || "");
    if (method.publicReady === false) return false;
    if (String(method.maintenanceMessage || "").trim()) return false;
    if (key === "wallet" || type === "wallet" || provider === "wallet") return true;
    if (type === "auto" || provider === "omise") return true;

    const hasQr = Boolean(method.qrImage || method.qrImageUrl || method.uploadedQrImage || method.finalQrImage || method.qrMode === "aziel_promptpay_dynamic");
    const hasAccount = method.qrMode === "aziel_promptpay_dynamic" || Boolean(method.accountName && method.accountNumber);
    return hasQr && hasAccount && isKnownRegionPaymentProvider(provider || key);
}

function selectPaymentCard(card) {
    const paymentMethod = document.getElementById("paymentMethod");
    if (!card || !paymentMethod) return;
    const originalMethod = card.__paymentMethod && typeof card.__paymentMethod === "object"
        ? card.__paymentMethod
        : {};

    document
        .querySelectorAll(".pay-card")
        .forEach(c => c.classList.remove("active"));

    card.classList.add("active");

    paymentMethod.value = card.dataset.method || "";

    window.selectedPaymentData = {
        ...originalMethod,
        method: originalMethod.method || card.dataset.name || "Payment",
        key: originalMethod.key || card.dataset.method || "",
        logo: originalMethod.logo || originalMethod.logoUrl || card.querySelector("img")?.getAttribute("src") || "",
        logoUrl: originalMethod.logoUrl || originalMethod.logo || card.querySelector("img")?.getAttribute("src") || "",
        qrImage: originalMethod.qrImage || card.dataset.qr || "",
        qrImageUrl: originalMethod.qrImageUrl || originalMethod.qrImage || card.dataset.qr || "",
        accountName: originalMethod.accountName || card.dataset.accountName || "",
        accountNumber: originalMethod.accountNumber || card.dataset.accountNumber || "",
        provider: originalMethod.provider || card.dataset.provider || "manual",
        paymentType: originalMethod.paymentType || card.dataset.paymentType || "manual",
        appDisplayName: originalMethod.appDisplayName || card.dataset.appDisplayName || card.dataset.name || "",
        openAppMode: originalMethod.openAppMode || card.dataset.openAppMode || "disabled",
        deepLink: originalMethod.deepLink || originalMethod.deepLinkUrl || card.dataset.deepLink || "",
        deepLinkUrl: originalMethod.deepLinkUrl || originalMethod.deepLink || card.dataset.deepLink || "",
        appStoreUrl: originalMethod.appStoreUrl || card.dataset.appStoreUrl || "",
        playStoreUrl: originalMethod.playStoreUrl || card.dataset.playStoreUrl || "",
        appLaunchMode: originalMethod.appLaunchMode || card.dataset.appLaunchMode || "",
        iosAppLaunchUrl: originalMethod.iosAppLaunchUrl || card.dataset.iosAppLaunchUrl || "",
        androidAppLaunchUrl: originalMethod.androidAppLaunchUrl || card.dataset.androidAppLaunchUrl || "",
        appStoreFallbackUrl: originalMethod.appStoreFallbackUrl || card.dataset.appStoreFallbackUrl || "",
        playStoreFallbackUrl: originalMethod.playStoreFallbackUrl || card.dataset.playStoreFallbackUrl || "",
        qrMode: originalMethod.qrMode || card.dataset.qrMode || "",
        enableSaveQr: originalMethod.enableSaveQr === true || card.dataset.enableSaveQr === "true",
        enableOpenApp: originalMethod.enableOpenApp === true || card.dataset.enableOpenApp === "true",
        enableChecklist: originalMethod.enableChecklist === true || card.dataset.enableChecklist === "true",
        dynamicQrSupported: originalMethod.dynamicQrSupported === true || card.dataset.dynamicQrSupported === "true",
        amountPrefillSupported: originalMethod.amountPrefillSupported === true || card.dataset.amountPrefillSupported === "true",
        referenceSupported: originalMethod.referenceSupported === true || card.dataset.referenceSupported === "true",
        galleryScanSupported: originalMethod.galleryScanSupported === true || card.dataset.galleryScanSupported === "true",
        receiptUploadEnabled: originalMethod.receiptUploadEnabled !== false,
        slipRequired: originalMethod.slipRequired !== false && card.dataset.slipRequired !== "false",
        autoVerificationSupported: originalMethod.autoVerificationSupported === true || card.dataset.autoVerificationSupported === "true",
        webhookSupported: originalMethod.webhookSupported === true || card.dataset.webhookSupported === "true",
        checklistSteps: Array.isArray(originalMethod.checklistSteps)
            ? originalMethod.checklistSteps
            : parseRegionChecklistSteps(card.dataset.checklistSteps)
    };

    updatePaymentPreview(card);

    document.dispatchEvent(new Event("paymentChanged"));
}

function normalizeSelectedRegionPayment(method = {}, overrides = {}) {
    return {
        ...method,
        key: overrides.key || method.key || "",
        method: overrides.name || method.method || "",
        logo: overrides.logo || method.logo || method.logoUrl || "",
        logoUrl: method.logoUrl || overrides.logo || method.logo || "",
        qrImage: overrides.qrImage || method.qrImage || method.qrImageUrl || method.uploadedQrImage || "",
        qrImageUrl: method.qrImageUrl || overrides.qrImage || method.qrImage || method.uploadedQrImage || "",
        deepLink: method.deepLink || method.deepLinkUrl || "",
        deepLinkUrl: method.deepLinkUrl || method.deepLink || "",
        openAppMode: method.openAppMode || "disabled",
        appLaunchMode: method.appLaunchMode || "",
        iosAppLaunchUrl: method.iosAppLaunchUrl || "",
        androidAppLaunchUrl: method.androidAppLaunchUrl || "",
        appStoreFallbackUrl: method.appStoreFallbackUrl || "",
        playStoreFallbackUrl: method.playStoreFallbackUrl || "",
        qrMode: method.qrMode || "",
        receiptUploadEnabled: method.receiptUploadEnabled !== false,
        checklistSteps: Array.isArray(method.checklistSteps) ? method.checklistSteps : []
    };
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
        krungthai: "assets/payment/bank-neutral.svg",
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
        "krungthai",
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
