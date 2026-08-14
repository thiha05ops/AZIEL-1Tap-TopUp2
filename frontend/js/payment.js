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
    const hasPaymentGrid = Boolean(paymentGrid && paymentInput);

    const region = resolvePaymentRegion();

    if (hasPaymentGrid) {
        paymentGrid.setAttribute("aria-busy", "true");
        paymentGrid.innerHTML = Array.from({ length: 4 }, () => `
            <div class="pay-card pay-card-skeleton az-storefront-skeleton" aria-hidden="true">
                <span class="pay-card-skeleton-icon"></span>
                <span class="pay-card-skeleton-line"></span>
            </div>
        `).join("") + '<span class="az-visually-hidden" role="status">Loading payment methods</span>';
        paymentInput.value = "";
        window.selectedPaymentData = null;
        document.dispatchEvent(new Event("paymentChanged"));
    }

    try {
        const API_BASE = location.port === "5500" ? `${location.protocol}//${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000` : "";
        const res = await fetch(`${API_BASE}/api/payment-methods?region=${region}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.message || "Failed to load payment methods");
        }

        const rawMethods = Array.isArray(data.methods) ? data.methods : [];
        let methods = rawMethods;
        methods = uniquePaymentMethodsByKey(methods)
            .filter(method => method.enabled === true)
            .filter(method => !isStandaloneThaiBankPaymentMethod(method))
            .filter(isPublicPaymentMethodUsable)
            .sort(sortPaymentMethods);
        window.AZIEL_TH_BANK_APPS = getConfiguredThaiBankApps(rawMethods);

        if (!hasPaymentGrid) {
            window.dispatchEvent(new CustomEvent("aziel:promptpayBankLaunchersReady", {
                detail: { count: window.AZIEL_TH_BANK_APPS.length }
            }));
            return window.AZIEL_TH_BANK_APPS;
        }

        if (!methods.some(method => normalizePaymentKey(method.key) === "wallet")) {
            methods.push(getWalletMethod(region));
        }

        paymentGrid.innerHTML = "";
        paymentGrid.setAttribute("aria-busy", "false");

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
        if (hasPaymentGrid) {
            paymentGrid.innerHTML = `<p class="pay-error">Payment methods failed to load.</p>`;
            document.dispatchEvent(new Event("paymentChanged"));
        }
    }
}

function resolvePaymentRegion() {
    try {
        const draft = JSON.parse(sessionStorage.getItem("azielProductCheckoutDraft") || "null");
        const draftRegion = String(draft?.order?.region || draft?.review?.pricing?.region || "").toUpperCase();
        if (draftRegion === "TH" || draftRegion === "MM") return draftRegion;
    } catch (_) {
        // Fall through to the storefront preference when no valid checkout draft exists.
    }
    return localStorage.getItem("region") || localStorage.getItem("selectedRegion") || "MM";
}

function getConfiguredThaiBankApps(methods = []) {
    const promptPay = methods.find(method =>
        String(method.region || "").toUpperCase() === "TH" &&
        normalizePaymentKey(method.key || method.method || "") === "promptpay"
    );
    const promptPayLaunchers = window.AZIEL_PAYMENT_TRUST?.normalizePromptPayLaunchers?.(
        promptPay?.bankLaunchers || [],
        promptPay || { region: "TH" }
    ) || [];

    if (promptPayLaunchers.length) {
        return promptPayLaunchers;
    }

    return methods
        .filter(method => String(method.region || "").toUpperCase() === "TH")
        .filter(method => {
            const key = normalizePaymentKey(method.key || method.method || "");
            const type = String(method.paymentType || "").toLowerCase();
            const provider = normalizePaymentKey(method.provider || "");
            return key !== "promptpay" &&
            key !== "kplus" &&
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
            androidPackageName: method.androidPackageName || "",
                appStoreUrl: method.appStoreUrl || "",
                playStoreUrl: method.playStoreUrl || "",
                appStoreFallbackUrl: method.appStoreFallbackUrl || "",
                playStoreFallbackUrl: method.playStoreFallbackUrl || "",
                sortOrder: Number(method.sortOrder || 0)
            }))
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.label).localeCompare(String(b.label)));
}

function isStandaloneThaiBankPaymentMethod(method = {}) {
    const region = String(method.region || "").toUpperCase();
    if (region !== "TH") return false;
    return ["scb", "bangkokbank", "kplus", "krungsri", "krungthai"].includes(
        normalizePaymentKey(method.key || method.provider || method.method || "")
    );
}

function sortPaymentMethods(a = {}, b = {}) {
    const orderA = Number(a.sortOrder || 0);
    const orderB = Number(b.sortOrder || 0);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.method || a.key || "").localeCompare(String(b.method || b.key || ""));
}

function uniquePaymentMethodsByKey(methods = []) {
    const seen = new Set();
    return methods.filter(method => {
        const key = normalizePaymentKey(method.key || method.method || method.provider || "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isPublicPaymentMethodUsable(method = {}) {
    const type = String(method.paymentType || "manual").toLowerCase();
    const provider = normalizePaymentKey(method.provider || "");
    const key = normalizePaymentKey(method.key || method.method || "");
    if (method.publicReady === false) return false;
    if (String(method.maintenanceMessage || "").trim()) return false;
    if (key === "wallet" || type === "wallet" || provider === "wallet") return true;
    if (type === "auto" || provider === "omise") return true;

    const hasQr = Boolean(method.qrImage || method.qrImageUrl || method.uploadedQrImage || method.finalQrImage || method.qrMode === "aziel_promptpay_dynamic");
    const hasAccount = method.qrMode === "aziel_promptpay_dynamic" || Boolean(method.accountName && method.accountNumber);
    const validProvider = isKnownPaymentProvider(provider || key);
    return validProvider && hasQr && hasAccount;
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
    const displayName = window.AZIEL_PAYMENT_DISPLAY?.method?.({ ...method, key }, getPaymentDisplayName(key)) ||
        getPaymentDisplayName(key);
    const logo = getPaymentCardLogo(method, key);

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

    if (String(region).toUpperCase() === "TH" && key === "promptpay" && method.paymentType !== "manual") {
        paymentType = "auto";
        provider = "promptpay";
    }

    const card = document.createElement("div");
    card.className = `pay-card ${index === 0 ? "active" : ""}`;
    card.__paymentMethod = normalizeSelectedPaymentMethod(method, {
        key,
        displayName,
        logo,
        qrImage,
        paymentType,
        provider,
        region
    });

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
    card.dataset.shortDescription = method.shortDescription || "";
    card.dataset.badgeText = method.badgeText || "";
    card.dataset.appDisplayName = method.appDisplayName || displayName;
    card.dataset.openAppMode = method.openAppMode || "";
    card.dataset.deepLink = method.deepLinkUrl || method.deepLink || "";
    card.dataset.appStoreUrl = method.appStoreUrl || "";
    card.dataset.playStoreUrl = method.playStoreUrl || "";
    card.dataset.appLaunchMode = method.appLaunchMode || "";
    card.dataset.iosAppLaunchUrl = method.iosAppLaunchUrl || "";
    card.dataset.androidAppLaunchUrl = method.androidAppLaunchUrl || "";
    card.dataset.androidPackageName = method.androidPackageName || "";
    card.dataset.appStoreFallbackUrl = method.appStoreFallbackUrl || "";
    card.dataset.playStoreFallbackUrl = method.playStoreFallbackUrl || "";
    card.dataset.qrMode = method.qrMode || "";
    card.dataset.enableSaveQr = String(method.enableSaveQr === true);
    card.dataset.enableOpenApp = String(method.enableOpenApp === true);
    card.dataset.enableChecklist = String(method.enableChecklist === true);
    card.dataset.dynamicQrSupported = String(method.dynamicQrSupported === true);
    card.dataset.amountPrefillSupported = String(method.amountPrefillSupported === true);
    card.dataset.referenceSupported = String(method.referenceSupported === true);
    card.dataset.galleryScanSupported = String(method.galleryScanSupported === true);
    card.dataset.slipRequired = String(method.slipRequired !== false && paymentType !== "auto" && paymentType !== "wallet");
    card.dataset.autoVerificationSupported = String(method.autoVerificationSupported === true);
    card.dataset.webhookSupported = String(method.webhookSupported === true);
    card.dataset.checklistSteps = JSON.stringify(Array.isArray(method.checklistSteps) ? method.checklistSteps : []);
    card.dataset.bankLaunchers = JSON.stringify(Array.isArray(method.bankLaunchers) ? method.bankLaunchers : []);

    const isPromptPay = String(region).toUpperCase() === "TH" && key === "promptpay";
    const title = isPromptPay
        ? translatePaymentText("payment_promptpay_qr", "PromptPay QR")
        : displayName;
    const description = isPromptPay
        ? translatePaymentText("payment_promptpay_any_thai_bank", method.shortDescription || "Pay with any Thai banking app")
        : method.shortDescription;
    const bankChips = isPromptPay ? renderPromptPayBankChips(method.bankLaunchers || [], method) : "";

    card.innerHTML = `
        <img src="${logo}" class="pay-logo" alt="${title}" onerror="this.src='assets/payment/payment-neutral.svg'">

        <div class="pay-info">
            <span>${title}</span>
            ${getPaymentBadge(paymentType, method.badgeText)}
            ${description ? `<small class="pay-description">${description}</small>` : ""}
            ${bankChips}
            ${method.maintenanceMessage ? `<small class="pay-message">${method.maintenanceMessage}</small>` : ""}
        </div>
    `;

    card.addEventListener("click", () => selectPaymentCard(card));
    return card;
}

function getPaymentBadge(paymentType, badgeText = "") {
    if (badgeText) {
        return `<small class="manual-pay-badge">${badgeText}</small>`;
    }

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
    const originalMethod = card.__paymentMethod && typeof card.__paymentMethod === "object"
        ? card.__paymentMethod
        : {};

    document.querySelectorAll(".pay-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    window.AZIEL_MOTION?.emphasize(card, "selected");

    if (paymentInput) {
        paymentInput.value = card.dataset.method || "";
    }

    window.selectedPaymentData = {
        ...originalMethod,
        key: originalMethod.key || card.dataset.method || "",
        method: originalMethod.method || card.dataset.name || "",
        logo: originalMethod.logo || originalMethod.logoUrl || card.dataset.logo || "",
        logoUrl: originalMethod.logoUrl || originalMethod.logo || card.dataset.logo || "",
        qrImage: originalMethod.qrImage || card.dataset.qr || "",
        qrImageUrl: originalMethod.qrImageUrl || originalMethod.qrImage || card.dataset.qr || "",
        accountName: originalMethod.accountName || card.dataset.accountName || "",
        accountNumber: originalMethod.accountNumber || card.dataset.accountNumber || "",
        paymentType: originalMethod.paymentType || card.dataset.paymentType || "manual",
        provider: originalMethod.provider || card.dataset.provider || "manual",
        region: originalMethod.region || card.dataset.region || "",
        maintenanceMessage: originalMethod.maintenanceMessage || card.dataset.maintenanceMessage || "",
        appDisplayName: originalMethod.appDisplayName || card.dataset.appDisplayName || card.dataset.name || "",
        openAppMode: originalMethod.openAppMode || card.dataset.openAppMode || "disabled",
        deepLink: originalMethod.deepLink || originalMethod.deepLinkUrl || card.dataset.deepLink || "",
        deepLinkUrl: originalMethod.deepLinkUrl || originalMethod.deepLink || card.dataset.deepLink || "",
        appStoreUrl: originalMethod.appStoreUrl || card.dataset.appStoreUrl || "",
        playStoreUrl: originalMethod.playStoreUrl || card.dataset.playStoreUrl || "",
        appLaunchMode: originalMethod.appLaunchMode || card.dataset.appLaunchMode || "",
        iosAppLaunchUrl: originalMethod.iosAppLaunchUrl || card.dataset.iosAppLaunchUrl || "",
        androidAppLaunchUrl: originalMethod.androidAppLaunchUrl || card.dataset.androidAppLaunchUrl || "",
        androidPackageName: originalMethod.androidPackageName || card.dataset.androidPackageName || "",
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
        bankLaunchers: Array.isArray(originalMethod.bankLaunchers)
            ? originalMethod.bankLaunchers
            : parseChecklistSteps(card.dataset.bankLaunchers),
        checklistSteps: Array.isArray(originalMethod.checklistSteps)
            ? originalMethod.checklistSteps
            : parseChecklistSteps(card.dataset.checklistSteps)
    };

    localStorage.setItem("selectedPaymentMethod", window.selectedPaymentData.key);
    localStorage.setItem("selectedPaymentName", window.selectedPaymentData.method);
    localStorage.setItem("selectedPaymentQr", window.selectedPaymentData.qrImage);
    localStorage.setItem("selectedPaymentAccountName", window.selectedPaymentData.accountName);
    localStorage.setItem("selectedPaymentAccountNumber", window.selectedPaymentData.accountNumber);
    localStorage.setItem("selectedPaymentType", window.selectedPaymentData.paymentType);
    localStorage.setItem("selectedPaymentProvider", window.selectedPaymentData.provider);

    document.dispatchEvent(
        new CustomEvent("paymentChanged", {
            detail: window.selectedPaymentData
        })
    );
}

function normalizeSelectedPaymentMethod(method = {}, overrides = {}) {
    return {
        ...method,
        key: overrides.key || method.key || "",
        method: overrides.displayName || method.method || "",
        logo: overrides.logo || method.logo || method.logoUrl || "",
        logoUrl: method.logoUrl || overrides.logo || method.logo || "",
        qrImage: overrides.qrImage || method.qrImage || method.qrImageUrl || method.uploadedQrImage || "",
        qrImageUrl: method.qrImageUrl || overrides.qrImage || method.qrImage || method.uploadedQrImage || "",
        paymentType: overrides.paymentType || method.paymentType || "manual",
        provider: overrides.provider || method.provider || "manual",
        region: overrides.region || method.region || "",
        deepLink: method.deepLink || method.deepLinkUrl || "",
        deepLinkUrl: method.deepLinkUrl || method.deepLink || "",
        openAppMode: method.openAppMode || "disabled",
        appLaunchMode: method.appLaunchMode || "",
        iosAppLaunchUrl: method.iosAppLaunchUrl || "",
        androidAppLaunchUrl: method.androidAppLaunchUrl || "",
        androidPackageName: method.androidPackageName || "",
        appStoreFallbackUrl: method.appStoreFallbackUrl || "",
        playStoreFallbackUrl: method.playStoreFallbackUrl || "",
        qrMode: method.qrMode || "",
        receiptUploadEnabled: method.receiptUploadEnabled !== false,
        bankLaunchers: Array.isArray(method.bankLaunchers) ? method.bankLaunchers : [],
        checklistSteps: Array.isArray(method.checklistSteps) ? method.checklistSteps : []
    };
}

function translatePaymentText(key, fallback = "") {
    const translated = window.AZIEL_I18N?.t?.(key, fallback);
    if (translated && translated !== key) return translated;
    const storage = window.localStorage;
    const lang =
        storage?.getItem("azielLanguage") ||
        document.documentElement?.lang ||
        "en";
    return window.AZIEL_LANG?.[lang]?.[key] || window.AZIEL_LANG?.en?.[key] || fallback;
}

function renderPromptPayBankChips(launchers = [], parent = {}) {
    const enabled = window.AZIEL_PAYMENT_TRUST?.normalizePromptPayLaunchers?.(launchers, parent) ||
        (Array.isArray(launchers)
            ? launchers.filter(app => app && app.enabled !== false && normalizePaymentKey(app.key) !== "kplus")
            : []);
    const visible = enabled;
    const mobileOverflow = Math.max(0, enabled.length - 3);
    if (!visible.length) return "";
    return `
        <div class="pay-bank-chips" aria-label="${translatePaymentText("payment_supported_banks", "Supported banks")}">
            ${visible.map(app => `
                <span class="pay-bank-chip" title="${escapeHTML(app.label || app.displayName || app.appDisplayName || "Bank")}">
                    ${app.logoUrl || app.logo ? `<img src="${escapeHTML(app.logoUrl || app.logo)}" alt="" aria-hidden="true">` : ""}
                </span>
            `).join("")}
            ${mobileOverflow ? `<span class="pay-bank-chip pay-bank-chip--mobile-more" aria-label="${mobileOverflow} more supported bank">+${mobileOverflow}</span>` : ""}
        </div>
    `;
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function parseChecklistSteps(value) {
    try {
        const steps = JSON.parse(value || "[]");
        return Array.isArray(steps) ? steps : [];
    } catch (error) {
        return [];
    }
}

function normalizePaymentKey(name) {
    const key = String(name || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^a-z0-9]/g, "");
    const aliases = {
        azielwallet: "wallet",
        promptpay: "promptpay",
        promptpayauto: "promptpay",
        bangkokbank: "bangkokbank",
        manualbanktransfer: "manualbank"
    };
    return aliases[key] || key;
}

function getPaymentDisplayName(key) {
    if (window.AZIEL_PAYMENT_DISPLAY?.from) {
        return window.AZIEL_PAYMENT_DISPLAY.from(key, "Payment");
    }

    const names = {
        kbzpay: "KBZPay",
        wavepay: "WavePay",
        ayapay: "AYA Pay",
        promptpay: "PromptPay",
        scb: "SCB",
        bangkokbank: "Bangkok Bank",
        kplus: "K PLUS",
        krungsri: "Krungsri",
        mmqr: "MMQR",
        manualbank: "Manual Bank Transfer",
        wallet: "AZIEL Wallet"
    };

    return names[key] || "Payment";
}

function getPaymentCardLogo(method = {}, key = "") {
    if (method.logoUrl || method.logo || method.logoImage) {
        return method.logoUrl || method.logo || method.logoImage;
    }
    return getPaymentLogo(key || method.key || method.provider || method.method);
}

function getPaymentLogo(key) {
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

    return logos[normalizePaymentKey(key)] || "assets/payment/payment-neutral.svg";
}

function isKnownPaymentProvider(key) {
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

window.loadPaymentMethods = loadPaymentMethods;
