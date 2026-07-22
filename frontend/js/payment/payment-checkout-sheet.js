// frontend/js/payment/payment-checkout-sheet.js
// Shared AZIEL customer payment checkout sheet.

(function () {
    let activeState = null;
    const DYNAMIC_PROMPTPAY_QR_VERSION = "promptpay-emv-merchant-proxy-v2";
    let qrExpiryTimer = null;

    function escapeHTML(value) {
        const utilEscape = window.PaymentUtils?.escapeHTML;
        if (utilEscape) return utilEscape(value);
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function normalizeUrl(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";
        if (window.PaymentUtils?.normalizeUrl) return window.PaymentUtils.normalizeUrl(raw);
        if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
        return raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
    }

    function getModal() {
        let modal = document.getElementById("azPaymentCheckoutSheet");
        if (modal) return modal;

        modal = document.createElement("div");
        modal.id = "azPaymentCheckoutSheet";
        modal.className = "az-payment-sheet";
        modal.innerHTML = `
            <div class="az-payment-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="azPaymentSheetTitle">
                <button type="button" class="az-payment-sheet__close" data-role="close" aria-label="Close payment instructions">×</button>

                <div class="az-payment-sheet__body">
                    <header class="az-payment-sheet__header">
                        <h2 id="azPaymentSheetTitle" class="az-payment-sheet__title">Payment</h2>
                        <strong id="azPaymentSheetAmount" class="az-payment-sheet__amount">-</strong>
                        <span id="azPaymentSheetSubtitle" class="az-payment-sheet__subtitle">Transfer the exact amount</span>
                    </header>

                    <div id="azPaymentSheetDetails" class="az-payment-sheet__details"></div>

                    <figure id="azPaymentSheetQrWrap" class="az-payment-sheet__qr" hidden>
                        <img id="azPaymentSheetQrImage" alt="Payment QR">
                        <span id="azPaymentSheetQrExpiry" class="az-payment-sheet__qr-expiry" hidden></span>
                        <figcaption id="azPaymentSheetQrFallback" hidden>QR image unavailable. Use the account details above.</figcaption>
                        <button type="button" id="azPaymentSheetRetryQr" class="az-payment-sheet__action" hidden>Retry QR</button>
                        <small id="azPaymentSheetQrDiagnostic" hidden></small>
                    </figure>

                    <div id="azPaymentSheetActions" class="az-payment-sheet__actions" hidden>
                        <button type="button" id="azPaymentSheetSaveQr" class="az-payment-sheet__action" hidden>Save QR</button>
                        <button type="button" id="azPaymentSheetOpenBankApp" class="az-payment-sheet__action" hidden>Open Bank App</button>
                    </div>

                    <section id="azPaymentSheetDesktopBanks" class="az-payment-sheet__desktop-banks" hidden></section>

                    <div id="azPaymentSheetAppFallback" class="az-payment-sheet__fallback" hidden></div>

                    <section id="azPaymentSheetChecklist" class="az-payment-sheet__checklist" hidden>
                        <span>Payment progress</span>
                        <ol id="azPaymentSheetChecklistSteps"></ol>
                    </section>

                    <div id="azPaymentSheetMobileNav" class="az-payment-sheet__mobile-nav" hidden>
                        <button type="button" id="azPaymentSheetContinueReceipt" class="az-payment-sheet__action">Continue to Receipt</button>
                        <button type="button" id="azPaymentSheetBackQr" class="az-payment-sheet__secondary">Back to QR</button>
                    </div>

                    <p id="azPaymentSheetInstructions" class="az-payment-sheet__instructions"></p>

                    <button type="button" id="azPaymentSheetOpenApp" class="az-payment-sheet__secondary" hidden>Open Payment App</button>

                    <section id="azPaymentSheetReceiptSummary" class="az-payment-sheet__receipt-summary" hidden></section>

                    <section id="azPaymentSheetReceipt" class="az-payment-sheet__receipt">
                        <div class="az-payment-sheet__receipt-copy">
                            <strong id="azPaymentSheetReceiptTitle">Payment receipt</strong>
                            <span id="azPaymentSheetReceiptHelper">Choose the screenshot after you finish the transfer.</span>
                        </div>

                        <label class="az-payment-sheet__upload">
                            <span id="azPaymentSheetUploadLabel">Choose screenshot</span>
                            <small>Image file, up to the platform upload limit</small>
                            <input type="file" id="azPaymentSheetSlipInput" accept="image/*">
                        </label>

                        <div id="azPaymentSheetPreview" class="az-payment-sheet__preview" hidden>
                            <span id="azPaymentSheetFileName"></span>
                            <img id="azPaymentSheetPreviewImage" src="" alt="Selected payment receipt">
                            <button type="button" id="azPaymentSheetRemoveFile">Remove</button>
                        </div>
                    </section>

                    <div id="azPaymentSheetMessage" class="az-payment-sheet__message" role="status" aria-live="polite"></div>
                </div>

                <div id="azPaymentMobileBankChooser" class="az-payment-sheet__mobile-chooser" hidden></div>

                <button type="button" id="azPaymentSheetSubmit" class="az-payment-sheet__submit">Submit for Verification</button>
            </div>
        `;

        document.body.appendChild(modal);

        modal.addEventListener("click", event => {
            if (event.target === modal) close("backdrop");
        });
        modal.querySelector("[data-role='close']")?.addEventListener("click", () => close("button"));
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && modal.classList.contains("show")) close("escape");
        });

        return modal;
    }

    function row(label, value, copyValue) {
        const display = String(value || "").trim();
        if (!display || display === "-") return "";
        const copy = String(copyValue ?? display).trim();
        return `
            <div class="az-payment-sheet__row">
                <span>${escapeHTML(label)}</span>
                <strong>${escapeHTML(display)}</strong>
                ${copy ? `<button type="button" data-copy="${escapeHTML(copy)}">Copy</button>` : ""}
            </div>
        `;
    }

    function setMessage(type, message) {
        const el = document.getElementById("azPaymentSheetMessage");
        if (!el) return;
        el.className = `az-payment-sheet__message${type ? ` is-${type}` : ""}`;
        el.textContent = message || "";
    }

    function setLoading(isLoading, text) {
        const btn = document.getElementById("azPaymentSheetSubmit");
        if (!btn) return;
        btn.disabled = Boolean(isLoading);
        btn.textContent = isLoading ? (text || "Submitting...") : (activeState?.submitLabel || "Submit for Verification");
    }

    function showToast(message, type = "info") {
        if (window.AZIEL_UI?.toast?.[type]) {
            window.AZIEL_UI.toast[type](message);
            return;
        }
        if (window.PaymentUtils?.showToast) window.PaymentUtils.showToast(message);
    }

    function bool(value) {
        return value === true || value === "true";
    }

    function t(key, fallback = "") {
        const translated = window.AZIEL_I18N?.t?.(key, fallback);
        if (translated && translated !== key) return translated;
        const storage = window.localStorage;
        const lang =
            storage?.getItem("azielLanguage") ||
            storage?.getItem("azielLang") ||
            storage?.getItem("aziel_lang") ||
            storage?.getItem("language") ||
            storage?.getItem("selectedLanguage") ||
            document.documentElement?.lang ||
            "en";
        return window.AZIEL_LANG?.[lang]?.[key] || window.AZIEL_LANG?.en?.[key] || fallback || key;
    }

    function clearQrExpiryCountdown() {
        if (qrExpiryTimer) {
            clearInterval(qrExpiryTimer);
            qrExpiryTimer = null;
        }
        const el = document.getElementById("azPaymentSheetQrExpiry");
        if (el) {
            el.hidden = true;
            el.textContent = "";
        }
    }

    function startQrExpiryCountdown(expiresAt) {
        clearQrExpiryCountdown();
        const el = document.getElementById("azPaymentSheetQrExpiry");
        const expiry = expiresAt ? new Date(expiresAt).getTime() : 0;
        if (!el || !Number.isFinite(expiry) || expiry <= Date.now()) return;

        const tick = () => {
            const seconds = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
            const minutes = Math.floor(seconds / 60);
            const remainder = String(seconds % 60).padStart(2, "0");
            el.textContent = `${t("payment_qr_expires_in", "QR expires in")} ${minutes}:${remainder}`;
            el.hidden = false;
            if (seconds <= 0) {
                clearQrExpiryCountdown();
                setQrLoading(false, t("payment_qr_expired_retry", "QR expired. Please retry."));
            }
        };

        tick();
        qrExpiryTimer = setInterval(tick, 1000);
    }

    function isDynamicPromptPayMode(options = {}) {
        return options.qrMode === "aziel_promptpay_dynamic";
    }

    function shouldGenerateDynamicPromptPay(options = {}) {
        return isDynamicPromptPayMode(options);
    }

    function renderedQrSourceType(options = {}, qr = "") {
        if (isDynamicPromptPayMode(options)) return qr ? "dynamic_response" : "";
        if (options.qrMode === "uploaded_static" && qr) return "uploaded_static";
        if (options.qrMode === "provider_generated" && qr) return "provider_generated";
        return "";
    }

    function isDevelopmentHost() {
        const host = window.location.hostname;
        return host === ["local", "host"].join("") || host === ["127", "0", "0", "1"].join(".");
    }

    function setQrDiagnostic(options = {}, sourceType = "") {
        const el = document.getElementById("azPaymentSheetQrDiagnostic");
        if (!el) return;
        el.hidden = true;
        el.textContent = "";
    }

    function isMobileViewport() {
        return window.matchMedia?.("(max-width: 600px)")?.matches === true;
    }

    function isMobilePromptPayFlow(options = activeState) {
        return Boolean(options && isDynamicPromptPayMode(options) && isMobileViewport());
    }

    function isDesktopPromptPayFlow(options = activeState) {
        return Boolean(options && isDynamicPromptPayMode(options) && !isMobileViewport());
    }

    function checkoutMethodCode(options = {}) {
        return String(options.methodCode || options.key || options.paymentMethod || "").trim().toLowerCase();
    }

    function createActiveQr(options = {}, sourceType = "", imageUrlOrDataUrl = "", payload = "") {
        const image = String(imageUrlOrDataUrl || "").trim();
        if (!image || !sourceType) return null;
        return {
            mode: options.qrMode || "",
            sourceType,
            imageUrlOrDataUrl: image,
            payload: payload || "",
            amount: normalizedComparableAmount(options.amount),
            reference: String(options.reference || ""),
            methodCode: checkoutMethodCode(options)
        };
    }

    function createActiveDynamicQr(options = {}, response = {}) {
        return Object.freeze({
            mode: "aziel_promptpay_dynamic",
            sourceType: "dynamic_response",
            imageDataUrl: String(response.qrImage || ""),
            payload: String(response.qrPayload || ""),
            amount: normalizedComparableAmount(response.amount ?? options.amount),
            reference: String(response.orderReference || options.reference || ""),
            generatedAt: Date.now()
        });
    }

    function activeQrMatchesCheckout(activeQr = {}, options = {}) {
        return Boolean(activeQr?.imageUrlOrDataUrl) &&
            String(activeQr.mode || "") === String(options.qrMode || "") &&
            String(activeQr.reference || "") === String(options.reference || "") &&
            String(activeQr.methodCode || "") === checkoutMethodCode(options) &&
            String(activeQr.amount || "") === normalizedComparableAmount(options.amount);
    }

    function activeDynamicQrMatchesCheckout(activeDynamicQr = {}, options = {}) {
        return Boolean(activeDynamicQr?.imageDataUrl) &&
            activeDynamicQr.mode === "aziel_promptpay_dynamic" &&
            activeDynamicQr.sourceType === "dynamic_response" &&
            String(activeDynamicQr.reference || "") === String(options.reference || "") &&
            String(activeDynamicQr.amount || "") === normalizedComparableAmount(options.amount);
    }

    function setActiveQr(activeQr) {
        activeState.activeQr = activeQrMatchesCheckout(activeQr, activeState || {}) ? activeQr : null;
    }

    function setActiveDynamicQr(activeDynamicQr) {
        activeState.activeDynamicQr = activeDynamicQrMatchesCheckout(activeDynamicQr, activeState || {}) ? activeDynamicQr : null;
    }

    function clearActiveQr() {
        if (activeState) activeState.activeQr = null;
    }

    function clearActiveDynamicQr() {
        if (activeState) activeState.activeDynamicQr = null;
    }

    function checkoutStorageKey(options = {}) {
        const reference = safeFilePart(options.reference || "payment");
        return `aziel:payment-checkout:${reference}`;
    }

    function normalizedComparableAmount(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number.toFixed(2) : "";
    }

    function sameCheckoutIdentity(snapshot = {}, options = {}) {
        const methodCode = String(options.methodCode || options.key || options.paymentMethod || "").trim().toLowerCase();
        const snapshotMethod = String(snapshot.methodCode || "").trim().toLowerCase();
        return Boolean(snapshot) &&
            snapshot.schemaVersion === DYNAMIC_PROMPTPAY_QR_VERSION &&
            String(snapshot.reference || "") === String(options.reference || "") &&
            snapshotMethod === methodCode &&
            normalizedComparableAmount(snapshot.amount) === normalizedComparableAmount(options.amount) &&
            String(snapshot.currency || "").toUpperCase() === String(options.currency || "").toUpperCase() &&
            String(snapshot.qrMode || "") === String(options.qrMode || "");
    }

    function persistCheckoutState(options = {}) {
        try {
            const snapshot = {
                schemaVersion: DYNAMIC_PROMPTPAY_QR_VERSION,
                methodCode: options.methodCode || options.key || "",
                methodName: options.methodName || "",
                amount: options.amount,
                currency: options.currency,
                reference: options.reference || "",
                qrImageUrl: options.qrImageUrl || options.qrImage || "",
                qrMode: options.qrMode || "",
                dynamicQr: options.dynamicQr || null,
                completedChecklistActions: Array.from(options.completedChecklistActions || [])
            };
            sessionStorage.setItem(checkoutStorageKey(options), JSON.stringify(snapshot));
        } catch (error) {
            // Checkout state persistence is a convenience only.
        }
    }

    function restoreCheckoutState(options = {}) {
        try {
            const raw = sessionStorage.getItem(checkoutStorageKey(options));
            const snapshot = raw ? JSON.parse(raw) : null;
            if (!sameCheckoutIdentity(snapshot, options)) {
                sessionStorage.removeItem(checkoutStorageKey(options));
                return {};
            }
            return snapshot;
        } catch (error) {
            return {};
        }
    }

    function safeFilePart(value = "payment") {
        return String(value || "payment")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "payment";
    }

    function safeMethodKey(value = "") {
        return String(value || "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9_-]+/g, "")
            .slice(0, 80);
    }

    function getQrProxyUrl(options = {}) {
        const methodKey = safeMethodKey(options.methodCode || options.key || options.paymentMethod || "");
        if (!methodKey) return "";

        const params = new URLSearchParams();
        const region = String(options.region || "").trim().toUpperCase();
        const reference = String(options.reference || "").trim();
        if (region) params.set("region", region);
        if (reference) params.set("reference", reference);

        return `/api/payment-methods/${encodeURIComponent(methodKey)}/qr-download${params.toString() ? `?${params}` : ""}`;
    }

    function inferImageType(blob, fallbackUrl = "") {
        const type = String(blob?.type || "").toLowerCase();
        if (type.startsWith("image/")) return type;
        if (/\.jpe?g($|\?)/i.test(fallbackUrl)) return "image/jpeg";
        if (/\.webp($|\?)/i.test(fallbackUrl)) return "image/webp";
        return "image/png";
    }

    function fileExtensionForType(type = "") {
        if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
        if (type.includes("webp")) return "webp";
        if (type.includes("gif")) return "gif";
        return "png";
    }

    function normalizeQrFilename(filename = "aziel-payment-qr.png", type = "image/png") {
        const clean = String(filename || "aziel-payment-qr")
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 120) || "aziel-payment-qr";
        const withoutExtension = clean.replace(/\.(png|jpe?g|webp|gif)$/i, "");
        return `${withoutExtension}.${fileExtensionForType(type)}`;
    }

    async function blobFromCanvas(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error("QR image is unavailable."));
            }, "image/png");
        });
    }

    function dataUrlToBlob(dataUrl) {
        const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
        if (!match) throw new Error("Dynamic QR image is unavailable.");
        const mimeType = match[1] || "image/png";
        if (!mimeType.toLowerCase().startsWith("image/")) throw new Error("Dynamic QR image is unavailable.");
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return new Blob([bytes], { type: mimeType });
    }

    async function fetchImageBlob(url) {
        const isLocalObject = /^(data:|blob:)/i.test(String(url || ""));
        const res = await fetch(url, isLocalObject
            ? {}
            : {
                credentials: "same-origin",
                cache: "no-store"
            });
        if (!res.ok) throw new Error("QR image download failed.");

        const blob = await res.blob();
        const type = inferImageType(blob, url);
        if (!type.startsWith("image/")) throw new Error("QR image download failed.");
        return blob.type === type ? blob : blob.slice(0, blob.size, type);
    }

    async function requestDynamicPromptPayQr(options = {}) {
        const methodKey = safeMethodKey(options.methodCode || options.key || options.paymentMethod || "");
        if (!methodKey) throw new Error("Payment method is unavailable.");

        const res = await fetch(`/api/payment-methods/${encodeURIComponent(methodKey)}/promptpay-qr`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(window.PaymentUtils?.authHeaders?.() || window.AZIEL?.authHeaders?.() || {})
            },
            body: JSON.stringify({
                amount: options.amount,
                currency: options.currency,
                orderReference: options.reference
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.message || "Could not generate PromptPay QR.");
        }
        return data;
    }

    async function resolveQrBlob({ href, qrCanvas, options, sourceType }) {
        if (qrCanvas?.toBlob) {
            return {
                blob: await blobFromCanvas(qrCanvas),
                source: "canvas"
            };
        }

        if (!href) throw new Error("QR image is unavailable.");

        try {
            return {
                blob: await fetchImageBlob(href),
                source: "direct"
            };
        } catch (error) {
            const proxyUrl = getQrProxyUrl(options);
            if (!proxyUrl) throw error;
            return {
                blob: await fetchImageBlob(proxyUrl),
                source: "proxy"
            };
        }
    }

    async function shareOrDownloadQr(blob, filename, context = {}) {
        const options = context.options || {};
        const activeQr = context.activeQr || null;
        const activeDynamicQr = context.activeDynamicQr || null;
        const dynamicShare = isDynamicPromptPayMode(options);
        if (dynamicShare) {
            if (!activeDynamicQr) {
                throw new Error("Dynamic QR is missing");
            }
            if (activeDynamicQr.sourceType !== "dynamic_response") {
                throw new Error("Mobile dynamic QR source ownership violation");
            }
            if (!activeDynamicQr.imageDataUrl.startsWith("data:image/")) {
                throw new Error("Mobile dynamic QR is not a generated data URL");
            }
        }

        const type = inferImageType(blob);
        const safeFilename = normalizeQrFilename(filename, type);

        if (typeof File === "function" && navigator.share) {
            const file = new File([blob], safeFilename, { type });
            if (isDevelopmentHost()) {
                console.info("[AZIEL MOBILE QR SHARE]", {
                    qrMode: options.qrMode || "",
                    sourceType: activeDynamicQr?.sourceType || activeQr?.sourceType || "",
                    sourcePrefix: activeDynamicQr?.imageDataUrl?.slice(0, 80) || activeQr?.imageUrlOrDataUrl?.slice(0, 80) || "",
                    fileName: file?.name,
                    fileType: file?.type,
                    fileSize: file?.size,
                    staticQrUrl: ""
                });
            }
            if (navigator.canShare?.({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: "AZIEL payment QR",
                    text: "Save this payment QR"
                });
                return "share";
            }
        }

        const url = URL.createObjectURL(blob);
        try {
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = safeFilename;
            anchor.rel = "noopener noreferrer";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            return "download";
        } finally {
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    async function saveDynamicQr(activeDynamicQr) {
        if (!activeDynamicQr) {
            throw new Error("Dynamic QR is missing");
        }
        if (activeDynamicQr.mode !== "aziel_promptpay_dynamic") {
            throw new Error("Dynamic QR save source ownership violation");
        }
        if (activeDynamicQr.sourceType !== "dynamic_response") {
            throw new Error("Dynamic QR source ownership violation");
        }
        if (!activeDynamicQr.imageDataUrl.startsWith("data:image/")) {
            throw new Error("Dynamic QR is not a data URL");
        }

        const blob = dataUrlToBlob(activeDynamicQr.imageDataUrl);
        const filename = `scb-${safeFilePart(activeDynamicQr.reference || "qr")}-${safeFilePart(activeDynamicQr.generatedAt || Date.now())}.png`;
        await shareOrDownloadQr(blob, filename, {
            options: {
                qrMode: "aziel_promptpay_dynamic",
                amount: activeDynamicQr.amount,
                reference: activeDynamicQr.reference
            },
            activeDynamicQr
        });
    }

    async function saveUploadedStaticQr(paymentMethod) {
        const { blob } = await resolveQrBlob({
            href: paymentMethod?.imageUrlOrDataUrl || "",
            qrCanvas: null,
            options: paymentMethod?.options || {},
            sourceType: "uploaded_static"
        });
        const filename = `${safeFilePart(paymentMethod?.options?.methodCode || "aziel-payment")}-${safeFilePart(paymentMethod?.options?.reference || "qr")}.png`;
        await shareOrDownloadQr(blob, filename, {
            options: paymentMethod?.options || {},
            activeQr: paymentMethod
        });
    }

    async function saveProviderQr(providerQr) {
        const { blob } = await resolveQrBlob({
            href: providerQr?.imageUrlOrDataUrl || "",
            qrCanvas: null,
            options: providerQr?.options || {},
            sourceType: "provider_generated"
        });
        const filename = `${safeFilePart(providerQr?.options?.methodCode || "aziel-payment")}-${safeFilePart(providerQr?.options?.reference || "qr")}.png`;
        await shareOrDownloadQr(blob, filename, {
            options: providerQr?.options || {},
            activeQr: providerQr
        });
    }

    function knownChecklistAction(action = "") {
        return [
            "save_qr",
            "open_app",
            "scan_saved_qr",
            "upload_receipt",
            "wait_for_confirmation",
            "confirm_payment"
        ].includes(action);
    }

    function dynamicPromptPayChecklistSteps() {
        if (isDesktopPromptPayFlow()) {
            return [
                { key: "scan_or_save_qr", label: t("payment_desktop_checklist_scan_or_save_qr", "Scan or save the QR"), action: "scan_saved_qr", enabled: true, sortOrder: 10 },
                { key: "pay_with_bank_app", label: t("payment_desktop_checklist_pay_with_bank_app", "Pay using your banking app"), action: "open_app", enabled: true, sortOrder: 20 },
                { key: "upload_receipt", label: t("payment_desktop_checklist_upload_receipt", "Upload the payment receipt"), action: "upload_receipt", enabled: true, sortOrder: 30 }
            ];
        }
        return [
            { key: "save_qr", label: t("payment_checklist_save_qr", "Save QR"), action: "save_qr", enabled: true, sortOrder: 10 },
            { key: "open_app", label: t("payment_checklist_open_banking_app", "Open banking app"), action: "open_app", enabled: true, sortOrder: 20 },
            { key: "scan_saved_qr", label: t("payment_checklist_scan_saved_qr", "Scan the saved QR and pay"), action: "scan_saved_qr", enabled: true, sortOrder: 30 },
            { key: "upload_receipt", label: t("payment_checklist_upload_receipt", "Upload payment receipt"), action: "upload_receipt", enabled: true, sortOrder: 40 }
        ];
    }

    function defaultChecklistSteps(options = {}) {
        if (isDynamicPromptPayMode(options)) return dynamicPromptPayChecklistSteps();
        const steps = [];
        if (options.enableSaveQr && (options.qrImageUrl || options.qrImage)) {
            steps.push({ key: "save_qr", label: t("payment_save_qr", "Save QR"), action: "save_qr", enabled: true, sortOrder: 10 });
        }
        if (options.enableOpenApp && (
            options.deepLink ||
            options.deepLinkUrl ||
            options.iosAppLaunchUrl ||
            options.androidAppLaunchUrl ||
            options.androidPackageName ||
            options.openAppMode === "bank_chooser"
        )) {
            steps.push({
                key: "open_app",
                label: options.openAppMode === "bank_chooser"
                    ? t("payment_open_banking_app", "Open Banking App")
                    : `Open ${options.appDisplayName || options.methodName || "payment app"}`,
                action: "open_app",
                enabled: true,
                sortOrder: 20
            });
        }
        if (options.requiresSlip !== false) {
            steps.push({ key: "upload_receipt", label: t("payment_upload_receipt", "Upload Receipt"), action: "upload_receipt", enabled: true, sortOrder: 30 });
        } else {
            steps.push({ key: "wait_for_confirmation", label: "Wait for confirmation", action: "wait_for_confirmation", enabled: true, sortOrder: 30 });
        }
        return steps;
    }

    function normalizeChecklistSteps(options = {}) {
        if (isDynamicPromptPayMode(options)) return dynamicPromptPayChecklistSteps();
        const configured = Array.isArray(options.checklistSteps) ? options.checklistSteps : [];
        const source = configured.length ? configured : defaultChecklistSteps(options);

        return source
            .filter(step => step && step.enabled !== false && knownChecklistAction(step.action))
            .map((step, index) => ({
                key: step.key || step.action || `step_${index}`,
                label: translateChecklistLabel(step),
                action: step.action,
                sortOrder: Number(step.sortOrder || (index + 1) * 10)
            }))
            .sort((a, b) => a.sortOrder - b.sortOrder);
    }

    function translateChecklistLabel(step = {}) {
        const action = step.action || "";
        const raw = String(step.label || "").trim();
        const standard = {
            save_qr: ["Save QR"],
            open_app: ["Open Banking App", "Open banking app"],
            scan_saved_qr: ["Scan the saved QR and pay"],
            upload_receipt: ["Upload Receipt", "Upload receipt"]
        };
        const key = {
            save_qr: "payment_save_qr",
            open_app: "payment_open_banking_app",
            scan_saved_qr: "payment_checklist_scan_saved_qr",
            upload_receipt: "payment_upload_receipt"
        }[action];
        if (key && (!raw || standard[action]?.includes(raw))) return t(key, raw || action.replaceAll("_", " "));
        return raw || String(action || "").replaceAll("_", " ");
    }

    function updateChecklist(action, state = "complete") {
        if (!activeState?.checklistSteps?.length || !action) return;

        const completed = new Set(activeState.completedChecklistActions || []);
        if (state === "complete") completed.add(action);
        activeState.completedChecklistActions = completed;

        const list = document.getElementById("azPaymentSheetChecklistSteps");
        if (!list) return;

        const firstIncomplete = activeState.checklistSteps.find(step => !completed.has(step.action));
        list.querySelectorAll("[data-action]").forEach(item => {
            const itemAction = item.getAttribute("data-action") || "";
            const isComplete = completed.has(itemAction);
            const isActive = !isComplete && firstIncomplete?.action === itemAction;
            item.classList.toggle("is-complete", isComplete);
            item.classList.toggle("is-active", isActive);
            item.setAttribute("aria-current", isActive ? "step" : "false");
        });
    }

    function renderChecklist(modal, options = {}) {
        const box = modal.querySelector("#azPaymentSheetChecklist");
        const list = modal.querySelector("#azPaymentSheetChecklistSteps");
        if (!box || !list) return;

        const steps = bool(options.enableChecklist)
            ? normalizeChecklistSteps(options)
            : [];

        activeState.checklistSteps = steps;
        activeState.completedChecklistActions = new Set();

        if (!steps.length) {
            box.hidden = true;
            list.innerHTML = "";
            return;
        }

        list.innerHTML = steps.map((step, index) => `
            <li data-action="${escapeHTML(step.action)}" class="${index === 0 ? "is-active" : ""}" aria-current="${index === 0 ? "step" : "false"}">
                <i aria-hidden="true"></i>
                <span>${escapeHTML(step.label)}</span>
            </li>
        `).join("");
        box.hidden = false;
    }

    function renderMobileReceiptSummary(modal, options = {}) {
        const summary = modal.querySelector("#azPaymentSheetReceiptSummary");
        if (!summary) return;
        const amount = Number(options.amount || 0);
        const amountText = `${amount.toLocaleString()} ${options.currency || ""}`.trim();
        const product = [options.productName || options.game || "", options.packageName || ""]
            .filter(Boolean)
            .join(" · ");
        const expiry = options.dynamicQr?.expiresAt
            ? `${t("payment_qr_expires_in", "QR expires in")} ${new Date(options.dynamicQr.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "";
        summary.innerHTML = [
            amountText ? `<div><span>${escapeHTML(t("total", "Total"))}</span><strong>${escapeHTML(amountText)}</strong></div>` : "",
            product ? `<div><span>${escapeHTML(t("package", "Package"))}</span><strong>${escapeHTML(product)}</strong></div>` : "",
            expiry ? `<div><span>${escapeHTML(t("payment_promptpay_qr", "PromptPay QR"))}</span><strong>${escapeHTML(expiry)}</strong></div>` : ""
        ].filter(Boolean).join("");
    }

    function setMobilePromptPayStep(step = "qr") {
        if (!activeState) return;
        activeState.mobileStep = step === "receipt" ? "receipt" : "qr";
        applyMobilePromptPayState();
        persistCheckoutState(activeState);
    }

    function applyMobilePromptPayState() {
        const modal = document.getElementById("azPaymentCheckoutSheet");
        if (!modal || !activeState) return;
        const isMobileFlow = isMobilePromptPayFlow(activeState);
        const isDesktopFlow = isDesktopPromptPayFlow(activeState);
        const step = activeState.mobileStep === "receipt" ? "receipt" : "qr";
        const nav = modal.querySelector("#azPaymentSheetMobileNav");
        const continueBtn = modal.querySelector("#azPaymentSheetContinueReceipt");
        const backBtn = modal.querySelector("#azPaymentSheetBackQr");
        const receipt = modal.querySelector("#azPaymentSheetReceipt");
        const summary = modal.querySelector("#azPaymentSheetReceiptSummary");
        const submit = modal.querySelector("#azPaymentSheetSubmit");
        const chooser = modal.querySelector("#azPaymentMobileBankChooser");

        modal.classList.toggle("is-mobile-promptpay", isMobileFlow);
        modal.classList.toggle("is-mobile-step-qr", isMobileFlow && step === "qr");
        modal.classList.toggle("is-mobile-step-receipt", isMobileFlow && step === "receipt");
        modal.classList.toggle("is-desktop-promptpay", isDesktopFlow);

        if (nav) nav.hidden = !isMobileFlow;
        if (continueBtn) {
            continueBtn.hidden = !isMobileFlow || step !== "qr";
            continueBtn.textContent = t("payment_continue_to_receipt", "Continue to Receipt");
            continueBtn.onclick = () => setMobilePromptPayStep("receipt");
        }
        if (backBtn) {
            backBtn.hidden = !isMobileFlow || step !== "receipt";
            backBtn.textContent = t("payment_back_to_qr", "Back to QR");
            backBtn.onclick = () => setMobilePromptPayStep("qr");
        }
        if (receipt) receipt.hidden = activeState.requiresSlip ? (isMobileFlow && step !== "receipt") : true;
        if (summary) {
            summary.hidden = !isMobileFlow || step !== "receipt";
            if (isMobileFlow && step === "receipt") renderMobileReceiptSummary(modal, activeState);
        }
        if (submit) submit.hidden = isMobileFlow && step !== "receipt";
        if (!isMobileFlow && submit) submit.hidden = false;
        if (!isMobileFlow && receipt) receipt.hidden = !activeState.requiresSlip;
        if (!isMobileFlow && summary) summary.hidden = true;
        if (!isMobileFlow && chooser) {
            chooser.hidden = true;
            chooser.innerHTML = "";
        }
        if (isDesktopFlow) renderDesktopSupportedBanks(activeState);
    }

    async function saveQrAsset(config = {}) {
        const filename = config.filename || `${safeFilePart(config.options?.methodCode || "aziel-payment")}-${safeFilePart(config.options?.reference || "qr")}.png`;
        const dynamicSave = isDynamicPromptPayMode(config.options || {});
        try {
            if (dynamicSave) {
                if (!config.activeDynamicQr) throw new Error("Dynamic QR is missing");
                await saveDynamicQr(config.activeDynamicQr);
                config.onSuccess?.();
                config.setMessage?.("success", "QR ready to save");
                showToast("QR ready to save", "success");
                return;
            }
            const { blob } = await resolveQrBlob({
                href: config.href || "",
                qrCanvas: config.qrCanvas,
                options: config.options || {},
                sourceType: config.sourceType || ""
            });
            await shareOrDownloadQr(blob, filename, {
                options: config.options || {},
                activeQr: config.activeQr || null,
                activeDynamicQr: config.activeDynamicQr || null
            });
            config.onSuccess?.();
            config.setMessage?.("success", "QR ready to save");
            showToast("QR ready to save", "success");
        } catch (error) {
            if (error?.name === "AbortError") return;
            const message = dynamicSave
                ? "Dynamic QR could not be saved. Please try again."
                : "Could not save QR. Long-press the image to save.";
            config.setMessage?.("error", message);
            showToast(message, "error");
        }
    }

    async function downloadQr(options = {}) {
        const activeQr = activeState?.activeQr;
        const activeDynamicQr = activeState?.activeDynamicQr;

        if (isDevelopmentHost()) {
            console.info("[AZIEL QR SAVE]", {
                qrMode: options.qrMode || "",
                sourceType: activeDynamicQr?.sourceType || activeQr?.sourceType || "",
                sourcePrefix: activeDynamicQr?.imageDataUrl?.slice(0, 40) || activeQr?.imageUrlOrDataUrl?.slice(0, 40) || "",
                fallbackEndpointUsed: false
            });
        }

        try {
            if (isDynamicPromptPayMode(options)) {
                if (!activeDynamicQrMatchesCheckout(activeDynamicQr, options)) {
                    throw new Error("Dynamic QR is missing");
                }
                await saveDynamicQr(activeDynamicQr);
                updateChecklist("save_qr");
                setMessage("success", "QR ready to save");
                showToast("QR ready to save", "success");
                return;
            }

            if (!activeQrMatchesCheckout(activeQr, options) || !activeQr.imageUrlOrDataUrl) {
                setMessage("error", "QR image is unavailable.");
                return;
            }

            const saveConfig = {
                ...activeQr,
                options
            };
            if (activeQr.sourceType === "uploaded_static") {
                await saveUploadedStaticQr(saveConfig);
            } else if (activeQr.sourceType === "provider_generated") {
                await saveProviderQr(saveConfig);
            } else {
                throw new Error("QR image is unavailable.");
            }
            updateChecklist("save_qr");
            setMessage("success", "QR ready to save");
            showToast("QR ready to save", "success");
        } catch (error) {
            const message = isDynamicPromptPayMode(options)
                ? "Dynamic QR could not be saved. Please try again."
                : "Could not save QR. Long-press the image to save.";
            setMessage("error", message);
            showToast(message, "error");
        }
    }

    function setQrLoading(isLoading, message = "") {
        const qrWrap = document.getElementById("azPaymentSheetQrWrap");
        const qrImg = document.getElementById("azPaymentSheetQrImage");
        const qrFallback = document.getElementById("azPaymentSheetQrFallback");
        const retry = document.getElementById("azPaymentSheetRetryQr");
        if (!qrWrap || !qrImg || !qrFallback) return;
        clearQrExpiryCountdown();
        qrWrap.hidden = false;
        qrImg.hidden = true;
        qrImg.removeAttribute("src");
        clearActiveQr();
        clearActiveDynamicQr();
        qrFallback.hidden = false;
        qrFallback.textContent = message || (isLoading ? "Generating Dynamic PromptPay QR..." : "QR image unavailable. Use the account details above.");
        if (retry) retry.hidden = isLoading;
        setQrDiagnostic(activeState || {}, "");
    }

    function setQrImage(qr, sourceType = "", payload = "") {
        const modal = document.getElementById("azPaymentCheckoutSheet");
        const qrWrap = modal?.querySelector("#azPaymentSheetQrWrap");
        const qrImg = modal?.querySelector("#azPaymentSheetQrImage");
        const qrFallback = modal?.querySelector("#azPaymentSheetQrFallback");
        const retry = modal?.querySelector("#azPaymentSheetRetryQr");
        if (!qr || !qrWrap || !qrImg) {
            if (qrWrap) qrWrap.hidden = true;
            clearActiveQr();
            clearActiveDynamicQr();
            return;
        }
        if (sourceType === "dynamic_response") {
            setActiveDynamicQr(createActiveDynamicQr(activeState || {}, {
                qrImage: qr,
                qrPayload: payload,
                amount: activeState?.amount,
                orderReference: activeState?.reference
            }));
            clearActiveQr();
        } else {
            setActiveQr(createActiveQr(activeState || {}, sourceType, qr, payload));
            clearActiveDynamicQr();
        }
        qrImg.hidden = false;
        qrImg.src = qr;
        qrImg.onerror = () => {
            qrImg.removeAttribute("src");
            qrImg.hidden = true;
            clearActiveQr();
            clearActiveDynamicQr();
            if (qrFallback) {
                qrFallback.textContent = "QR image unavailable. Use the account details above.";
                qrFallback.hidden = false;
            }
        };
        if (qrFallback) qrFallback.hidden = true;
        if (retry) retry.hidden = true;
        setQrDiagnostic(activeState || {}, sourceType);
        if (sourceType === "dynamic_response") startQrExpiryCountdown(activeState?.dynamicQr?.expiresAt);
        else clearQrExpiryCountdown();
        qrWrap.hidden = false;
    }

    function updateActionButtons(options = {}) {
        const modal = document.getElementById("azPaymentCheckoutSheet");
        const actions = modal?.querySelector("#azPaymentSheetActions");
        const saveQr = modal?.querySelector("#azPaymentSheetSaveQr");
        const openBankApp = modal?.querySelector("#azPaymentSheetOpenBankApp");
        const qr = isDynamicPromptPayMode(options)
            ? (activeDynamicQrMatchesCheckout(activeState?.activeDynamicQr, options) ? activeState.activeDynamicQr.imageDataUrl : "")
            : (activeQrMatchesCheckout(activeState?.activeQr, options) ? activeState.activeQr.imageUrlOrDataUrl : "");
        const appTarget = resolveAppLaunchTarget(options);
        const directOpenAppMode = String(options.openAppMode || "direct") !== "bank_chooser";
        const androidPackageCapability = directOpenAppMode && hasAndroidLaunchCapability(options);
        const desktopPromptPay = isDesktopPromptPayFlow(options);
        const canSaveQr = bool(options.enableSaveQr) && Boolean(qr);
        const canOpenApp = !desktopPromptPay && bool(options.enableOpenApp) &&
            (String(options.openAppMode || "direct") === "bank_chooser" || Boolean(appTarget.url) || androidPackageCapability);
        if (actions) actions.hidden = !(canSaveQr || canOpenApp);
        if (saveQr) {
            saveQr.hidden = !canSaveQr;
            saveQr.textContent = t("payment_save_qr", "Save QR");
            saveQr.onclick = canSaveQr ? () => downloadQr(activeState) : null;
        }
        if (openBankApp) {
            const appName = String(options.openAppMode || "direct") === "bank_chooser"
                ? t("payment_choose_banking_app", "Banking App")
                : options.appDisplayName || options.methodName || "Bank App";
            openBankApp.hidden = !canOpenApp;
            openBankApp.textContent = isMobilePromptPayFlow(options)
                ? t("payment_open_banking_app", "Open Banking App")
                : appTarget.source === "store" ? `${t("payment_open_install_app", "Open / Install")} ${appName}` : `${t("payment_open_app_short", "Open")} ${appName}`;
            openBankApp.onclick = canOpenApp ? () => openPaymentApp(activeState) : null;
        }
        renderDesktopSupportedBanks(options);
    }

    function configuredThaiBankApps() {
        if (Array.isArray(activeState?.bankLaunchers) && activeState.bankLaunchers.length) {
            return window.AZIEL_PAYMENT_TRUST?.normalizePromptPayLaunchers?.(activeState.bankLaunchers, activeState) ||
                activeState.bankLaunchers
                    .filter(app => app && app.enabled !== false)
                    .filter(app => String(app.key || "").toLowerCase() !== "kplus")
                    .map(app => ({
                        key: app.key || "",
                        label: app.displayName || app.appDisplayName || app.label || "Banking App",
                        logo: app.logoUrl || app.logo || "",
                        enabled: app.enabled !== false,
                        openAppMode: "direct",
                        appLaunchMode: app.appLaunchMode || "APP_ONLY",
                        iosAppLaunchUrl: app.iosAppLaunchUrl || "",
                        androidAppLaunchUrl: app.androidAppLaunchUrl || "",
                        androidPackageName: app.androidPackageName || "",
                        appStoreFallbackUrl: app.appStoreFallbackUrl || "",
                        playStoreFallbackUrl: app.playStoreFallbackUrl || ""
                    }));
        }
        return Array.isArray(window.AZIEL_TH_BANK_APPS)
            ? window.AZIEL_TH_BANK_APPS.filter(app => app && app.enabled !== false)
            : [];
    }

    function renderDesktopSupportedBanks(options = {}) {
        const modal = document.getElementById("azPaymentCheckoutSheet");
        const box = modal?.querySelector("#azPaymentSheetDesktopBanks");
        if (!box) return;

        if (!isDesktopPromptPayFlow(options)) {
            box.hidden = true;
            box.innerHTML = "";
            return;
        }

        const apps = configuredThaiBankApps().slice(0, 4);
        if (!apps.length) {
            box.hidden = true;
            box.innerHTML = "";
            return;
        }

        box.innerHTML = `
            <span>${escapeHTML(t("payment_supported_banking_apps", "Supported Banking Apps"))}</span>
            <div class="az-payment-sheet__desktop-bank-logos" aria-label="${escapeHTML(t("payment_supported_banking_apps", "Supported Banking Apps"))}">
                ${apps.map(app => `
                    <span title="${escapeHTML(app.label || app.appDisplayName || "Banking App")}">
                        ${app.logo ? `<img src="${escapeHTML(app.logo)}" alt="" aria-hidden="true">` : ""}
                    </span>
                `).join("")}
            </div>
        `;
        box.hidden = false;
    }

    async function generateDynamicQrForActiveState() {
        if (!activeState || !shouldGenerateDynamicPromptPay(activeState)) return;
        clearActiveQr();
        clearActiveDynamicQr();
        activeState.qrImageUrl = "";
        activeState.qrImage = "";
        activeState.dynamicQr = null;
        setQrLoading(true);
        setMessage("", "");
        updateActionButtons({ ...activeState, qrImageUrl: "" });

        try {
            const data = await requestDynamicPromptPayQr(activeState);
            if (!activeState || activeState.reference !== data.orderReference) return;
            activeState.qrImageUrl = data.qrImage;
            activeState.qrImage = data.qrImage;
            activeState.dynamicQr = {
                qrPayload: data.qrPayload,
                expiresAt: data.expiresAt,
                orderReference: data.orderReference
            };
            setQrImage(data.qrImage, "dynamic_response", data.qrPayload);
            updateActionButtons(activeState);
            applyMobilePromptPayState();
            persistCheckoutState(activeState);
        } catch (error) {
            setQrLoading(false, error.message || "Could not generate PromptPay QR.");
            setMessage("error", "Could not generate PromptPay QR. Please retry.");
        }
    }

    function resolveAppLaunchTarget(options = {}) {
        const mode = String(options.appLaunchMode || "OFFICIAL_PAYMENT_DEEPLINK").toUpperCase();
        const helper = window.AZIEL_ANDROID_APP_LAUNCH;
        const platform = helper?.resolvePlatform?.() || "desktop";
        const isIOS = platform === "ios";
        const isAndroid = platform === "android";
        const androidIntentUrl = helper?.buildAndroidIntentUrl?.({
            androidPackageName: options.androidPackageName || "",
            androidAppLaunchUrl: options.androidAppLaunchUrl || "",
            playStoreFallbackUrl: options.playStoreFallbackUrl || options.playStoreUrl || ""
        }) || "";
        const androidExplicitUrl = helper?.isSafeLaunchUrl?.(options.androidAppLaunchUrl || "")
            ? options.androidAppLaunchUrl
            : "";
        const iosDirectUrl = options.iosAppLaunchUrl || "";
        const iosStoreUrl = options.appStoreFallbackUrl || options.appStoreUrl || "";
        const androidStoreUrl = options.playStoreFallbackUrl || options.playStoreUrl || "";

        if (isAndroid) {
            return {
                mode,
                platform,
                url: androidExplicitUrl || androidIntentUrl || androidStoreUrl,
                storeUrl: androidStoreUrl,
                source: androidExplicitUrl ? "android_explicit" : androidIntentUrl ? "android_intent" : "store"
            };
        }

        if (mode === "APP_ONLY") {
            const url = isIOS
                ? (iosDirectUrl || iosStoreUrl)
                : "";
            return {
                mode,
                platform,
                url,
                storeUrl: isIOS
                    ? iosStoreUrl
                    : isAndroid
                        ? androidStoreUrl
                        : iosStoreUrl || androidStoreUrl,
                source: isAndroid && androidExplicitUrl ? "android_explicit" : isAndroid && androidIntentUrl ? "android_intent" : iosDirectUrl ? "direct" : "store"
            };
        }
        return {
            mode,
            platform,
            url: options.deepLink || options.deepLinkUrl || "",
            storeUrl: isIOS
                ? iosStoreUrl
                : isAndroid
                    ? androidStoreUrl
                    : iosStoreUrl || androidStoreUrl,
            source: "deeplink"
        };
    }

    function resolveBankProfileLaunchTarget(profile = {}) {
        return resolveAppLaunchTarget({
            appLaunchMode: profile.appLaunchMode || "OFFICIAL_PAYMENT_DEEPLINK",
            deepLink: profile.deepLink || profile.deepLinkUrl || "",
            deepLinkUrl: profile.deepLinkUrl || profile.deepLink || "",
            iosAppLaunchUrl: profile.iosAppLaunchUrl || "",
            androidAppLaunchUrl: profile.androidAppLaunchUrl || "",
            androidPackageName: profile.androidPackageName || "",
            appStoreFallbackUrl: profile.appStoreFallbackUrl || profile.appStoreUrl || "",
            playStoreFallbackUrl: profile.playStoreFallbackUrl || profile.playStoreUrl || "",
            appStoreUrl: profile.appStoreUrl || "",
            playStoreUrl: profile.playStoreUrl || ""
        });
    }

    function hasAndroidLaunchCapability(options = {}) {
        const helper = window.AZIEL_ANDROID_APP_LAUNCH;
        if (helper?.resolvePlatform?.() !== "android") return false;
        return helper?.hasAndroidLaunchCapability?.({
            androidPackageName: options.androidPackageName || "",
            androidAppLaunchUrl: options.androidAppLaunchUrl || "",
            playStoreFallbackUrl: options.playStoreFallbackUrl || options.playStoreUrl || ""
        }) === true;
    }

    function showBankChooser(options = {}) {
        if (isMobilePromptPayFlow(options)) {
            showMobileBankChooser(options);
            return;
        }

        const fallback = document.getElementById("azPaymentSheetAppFallback");
        if (!fallback) return;

        const apps = configuredThaiBankApps();
        if (!apps.length) {
            fallback.innerHTML = `<span>${escapeHTML(t("payment_bank_app_unavailable", "Bank app unavailable. Open your banking app and import the saved QR."))}</span>`;
            fallback.hidden = false;
            setMessage("success", t("payment_open_app_manual_guidance", "Open your banking app and import the saved QR. Return here after transfer and upload your receipt."));
            return;
        }

        fallback.innerHTML = `
            <span>${escapeHTML(t("payment_choose_banking_app_hint", "Choose a banking app. This only opens the app; it does not change the payment."))}</span>
            <div class="az-payment-sheet__bank-list">
                ${apps.map((app, index) => {
                    const target = resolveBankProfileLaunchTarget(app);
                    const disabled = !target.url && !hasAndroidLaunchCapability(app);
                    const labelPrefix = target.source === "store" ? t("payment_open_install_app", "Open / Install") : t("payment_open_app_short", "Open");
                    const appName = app.label || app.appDisplayName || "Banking App";
                    return `
                        <button type="button" data-bank-index="${index}" ${disabled ? "disabled" : ""}>
                            ${app.logo ? `<img src="${escapeHTML(app.logo)}" alt="" aria-hidden="true">` : ""}
                            <span>${escapeHTML(`${labelPrefix} ${appName}`)}</span>
                        </button>
                    `;
                }).join("")}
                <button type="button" data-bank-cancel="true">
                    <span>${escapeHTML(t("payment_cancel", "Cancel"))}</span>
                </button>
            </div>
        `;
        fallback.hidden = false;
        fallback.querySelectorAll("[data-bank-index]").forEach(button => {
            button.addEventListener("click", () => {
                const profile = apps[Number(button.getAttribute("data-bank-index") || 0)];
                launchBankProfile(profile, options);
            });
        });
        fallback.querySelector("[data-bank-cancel='true']")?.addEventListener("click", () => {
            fallback.hidden = true;
        });
    }

    function showMobileBankChooser(options = {}) {
        const chooser = document.getElementById("azPaymentMobileBankChooser");
        if (!chooser) return;
        const apps = configuredThaiBankApps();
        if (!apps.length) {
            setMessage("success", t("payment_open_app_manual_guidance", "Open your banking app and import the saved QR. Return here after transfer and upload your receipt."));
            return;
        }

        chooser.innerHTML = `
            <div class="az-payment-sheet__mobile-chooser-card" role="dialog" aria-modal="false" aria-label="${escapeHTML(t("payment_choose_banking_app", "Choose Banking App"))}">
                <header>
                    <strong>${escapeHTML(t("payment_choose_banking_app", "Choose Banking App"))}</strong>
                    <button type="button" data-mobile-bank-cancel aria-label="${escapeHTML(t("payment_cancel", "Cancel"))}">×</button>
                </header>
                <div class="az-payment-sheet__mobile-bank-list">
                    ${apps.map((app, index) => {
                        const target = resolveBankProfileLaunchTarget(app);
                        const disabled = !target.url && !hasAndroidLaunchCapability(app);
                        const appName = app.label || app.appDisplayName || "Banking App";
                        return `
                            <button type="button" data-mobile-bank-index="${index}" ${disabled ? "disabled" : ""}>
                                <i aria-hidden="true">${app.logo ? `<img src="${escapeHTML(app.logo)}" alt="">` : ""}</i>
                                <span>${escapeHTML(appName)}</span>
                                <b aria-hidden="true">›</b>
                            </button>
                        `;
                    }).join("")}
                </div>
                <button type="button" class="az-payment-sheet__mobile-cancel" data-mobile-bank-cancel>${escapeHTML(t("payment_cancel", "Cancel"))}</button>
            </div>
        `;
        chooser.hidden = false;
        chooser.querySelectorAll("[data-mobile-bank-index]").forEach(button => {
            button.addEventListener("click", () => {
                const profile = apps[Number(button.getAttribute("data-mobile-bank-index") || 0)];
                chooser.hidden = true;
                launchBankProfile(profile, options);
            });
        });
        chooser.querySelectorAll("[data-mobile-bank-cancel]").forEach(button => {
            button.addEventListener("click", () => {
                chooser.hidden = true;
            });
        });
    }

    function launchBankProfile(profile = {}, options = {}) {
        const target = resolveBankProfileLaunchTarget(profile);
        if (!target.url) {
            setMessage("error", t("payment_bank_app_unavailable", "Bank app unavailable. Open your banking app and import the saved QR."));
            return;
        }
        updateChecklist("open_app");
        persistCheckoutState(activeState || options);
        setMessage("success", `${t("payment_opening_bank_app", "Opening")} ${profile.label || profile.appDisplayName || "banking app"}. ${t("payment_return_upload_receipt", "Return here after transfer and upload your receipt.")}`);
        window.location.href = target.url;
    }

    function openPaymentApp(options = {}) {
        const openAppMode = String(options.openAppMode || "direct");
        if (openAppMode === "disabled") {
            setMessage("error", "Payment app opening is disabled for this method.");
            return;
        }
        if (openAppMode === "bank_chooser") {
            showBankChooser(options);
            return;
        }

        const target = resolveAppLaunchTarget(options);
        if (!target.url) {
            setMessage("error", "Payment app link is unavailable.");
            return;
        }

        updateChecklist("open_app");
        persistCheckoutState(activeState || options);
        setMessage("success", `Opening ${options.appDisplayName || options.methodName || "payment app"}. Return here after transfer and upload your receipt.`);
        window.location.href = target.url;

        const fallback = document.getElementById("azPaymentSheetAppFallback");
        if (!fallback) return;

        window.setTimeout(() => {
            if (!document.getElementById("azPaymentCheckoutSheet")?.classList.contains("show")) return;

            const links = [
                `<button type="button" data-role="stay-here">Stay Here</button>`,
                target.storeUrl ? `<a href="${escapeHTML(target.storeUrl)}" target="_blank" rel="noopener noreferrer">${target.platform === "android" ? "Open Play Store" : "Open App Store"}</a>` : ""
            ].filter(Boolean);

            if (!links.length) return;
            fallback.innerHTML = `
                <span>Bank app could not be opened.</span>
                ${links.join("")}
            `;
            fallback.hidden = false;
            fallback.querySelector("[data-role='stay-here']")?.addEventListener("click", () => {
                fallback.hidden = true;
            });
        }, 1400);
    }

    function selectedFile() {
        return document.getElementById("azPaymentSheetSlipInput")?.files?.[0] || null;
    }

    function bindFilePreview() {
        const input = document.getElementById("azPaymentSheetSlipInput");
        const preview = document.getElementById("azPaymentSheetPreview");
        const image = document.getElementById("azPaymentSheetPreviewImage");
        const name = document.getElementById("azPaymentSheetFileName");
        const submit = document.getElementById("azPaymentSheetSubmit");

        if (!input || !preview || !image || !name) return;

        input.value = "";
        preview.hidden = true;
        image.removeAttribute("src");
        name.textContent = "";
        if (submit && activeState?.requiresSlip) submit.disabled = true;

        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            name.textContent = file.name || "Selected payment receipt";
            image.src = URL.createObjectURL(file);
            preview.hidden = false;
            setMessage("", "");
            updateChecklist("upload_receipt");
            if (submit) submit.disabled = false;
        };

        document.getElementById("azPaymentSheetRemoveFile").onclick = () => {
            input.value = "";
            preview.hidden = true;
            image.removeAttribute("src");
            name.textContent = "";
            if (submit && activeState?.requiresSlip) submit.disabled = true;
        };
    }

    function show(options = {}) {
        const modal = getModal();
        const amount = Number(options.amount || 0);
        const currency = options.currency || "";
        const requiresSlip = options.requiresSlip !== false;
        const methodName = window.AZIEL_PAYMENT_DISPLAY?.from?.(
            options.methodName || options.paymentMethod,
            options.methodName || options.paymentMethod || "Payment"
        ) || options.methodName || options.paymentMethod || "Payment";
        const reference = options.reference || "";
        const restored = restoreCheckoutState(options);
        const dynamicQr = shouldGenerateDynamicPromptPay(options);
        const qr = dynamicQr
            ? ""
            : normalizeUrl(options.qrImageUrl || options.qrImage || restored.qrImageUrl || "");
        const qrSourceType = renderedQrSourceType(options, qr);
        const submitLabel = options.submitLabel || (requiresSlip ? "Submit for Verification" : "Continue");

        activeState = {
            ...options,
            qrImageUrl: qr,
            qrImage: qr,
            dynamicQr: dynamicQr ? null : restored.dynamicQr || options.dynamicQr || null,
            activeQr: null,
            activeDynamicQr: null,
            requiresSlip,
            submitLabel,
            checklistSteps: [],
            completedChecklistActions: new Set(restored.completedChecklistActions || []),
            mobileStep: "qr"
        };
        if (dynamicQr) activeState.submitLabel = t("payment_submit_for_verification", submitLabel);

        modal.querySelector("#azPaymentSheetTitle").textContent = `${methodName} Transfer`;
        modal.querySelector("#azPaymentSheetAmount").textContent = `${amount.toLocaleString()} ${currency}`.trim();
        modal.querySelector("#azPaymentSheetSubtitle").textContent = dynamicQr
            ? t("payment_promptpay_dynamic_subtitle", "Scan the amount-specific PromptPay QR")
            : options.subtitle || "Transfer the exact amount";
        modal.querySelector("#azPaymentSheetInstructions").textContent =
            dynamicQr
                ? t("payment_promptpay_manual_instructions", "Save the QR, open your banking app, scan the saved QR, then upload your payment receipt.")
                : options.instructions || (requiresSlip
                    ? "Transfer the exact amount, then upload the payment receipt."
                    : "Scan or complete the payment using the details shown.");

        const detailRows = [
            row("Account", options.accountName || "", options.accountName || ""),
            row("Account Number", options.accountNumber || "", options.accountNumber || ""),
            row("Reference", reference, reference)
        ].join("");
        modal.querySelector("#azPaymentSheetDetails").innerHTML = dynamicQr && detailRows
            ? `
                <details class="az-payment-sheet__fallback-details">
                    <summary>${escapeHTML(t("payment_transfer_details_fallback", "Fallback transfer details"))}</summary>
                    ${detailRows}
                </details>
            `
            : detailRows;

        modal.querySelectorAll("[data-copy]").forEach(btn => {
            btn.addEventListener("click", () => {
                const value = btn.getAttribute("data-copy") || "";
                if (window.PaymentUtils?.copy) window.PaymentUtils.copy(value);
                else navigator.clipboard?.writeText(value);
            });
        });

        const retryQr = modal.querySelector("#azPaymentSheetRetryQr");
        if (retryQr) {
            retryQr.onclick = () => generateDynamicQrForActiveState();
        }

        if (qr) setQrImage(qr, qrSourceType);
        else if (dynamicQr) setQrLoading(true);
        else modal.querySelector("#azPaymentSheetQrWrap").hidden = true;

        const fallback = modal.querySelector("#azPaymentSheetAppFallback");
        if (fallback) {
            fallback.hidden = true;
            fallback.innerHTML = "";
        }
        const mobileChooser = modal.querySelector("#azPaymentMobileBankChooser");
        if (mobileChooser) {
            mobileChooser.hidden = true;
            mobileChooser.innerHTML = "";
        }
        updateActionButtons(activeState);

        renderChecklist(modal, {
            ...options,
            methodName,
            qrImageUrl: qr,
            requiresSlip
        });

        const openApp = modal.querySelector("#azPaymentSheetOpenApp");
        if (openApp) {
            openApp.hidden = true;
            openApp.onclick = null;
        }

        modal.querySelector("#azPaymentSheetReceiptTitle").textContent = t("payment_upload_receipt_title", "Upload Payment Receipt");
        modal.querySelector("#azPaymentSheetReceiptHelper").textContent = t("payment_receipt_helper", "Choose the screenshot after you finish the transfer.");
        modal.querySelector("#azPaymentSheetUploadLabel").textContent = t("payment_choose_screenshot", "Choose Screenshot");
        modal.querySelector("#azPaymentSheetReceipt").hidden = !requiresSlip;
        modal.querySelector("#azPaymentSheetSubmit").textContent = dynamicQr
            ? activeState.submitLabel
            : submitLabel;
        modal.querySelector("#azPaymentSheetSubmit").onclick = async () => {
            const file = selectedFile();
            if (requiresSlip && !file) {
                setMessage("error", "Please choose your payment receipt first.");
                modal.querySelector("#azPaymentSheetSlipInput")?.focus();
                return;
            }
            if (shouldGenerateDynamicPromptPay(activeState) && !activeState.dynamicQr?.qrPayload) {
                setMessage("error", "Please generate the payment QR before submitting your receipt.");
                return;
            }

            try {
                setLoading(true, options.loadingText || "Submitting...");
                const result = await options.onSubmit?.({
                    file,
                    setMessage,
                    close,
                    setLoading,
                    options: activeState
                });
                if (result !== false) setMessage("success", options.successMessage || "Submitted for verification.");
            } catch (error) {
                console.log("Payment checkout sheet submit error:", error);
                setMessage("error", error.message || "Submission failed. Please try again.");
            } finally {
                setLoading(false);
            }
        };

        bindFilePreview();
        applyMobilePromptPayState();
        activeState.completedChecklistActions?.forEach?.(action => updateChecklist(action));
        setMessage("", options.error || "");
        modal.classList.add("show");
        document.body.classList.add("az-payment-sheet-open");
        modal.querySelector("[data-role='close']")?.focus();
        persistCheckoutState(activeState);

        if (dynamicQr && !qr) {
            generateDynamicQrForActiveState();
        }
    }

    function close(reason = "programmatic") {
        const modal = document.getElementById("azPaymentCheckoutSheet");
        modal?.classList.remove("show");
        document.body.classList.remove("az-payment-sheet-open");
        clearQrExpiryCountdown();
        activeState?.onClose?.(reason);
        activeState = null;
    }

    window.PaymentCheckoutSheet = {
        show,
        close,
        setMessage,
        setLoading
    };

    window.PaymentQrSaver = {
        save: saveQrAsset,
        safeFilePart
    };
})();
