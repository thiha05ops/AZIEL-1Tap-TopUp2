// frontend/js/payment/payment-checkout-sheet.js
// Shared AZIEL customer payment checkout sheet.

(function () {
    let activeState = null;
    const DYNAMIC_PROMPTPAY_QR_VERSION = "promptpay-emv-merchant-proxy-v2";

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
                        <figcaption id="azPaymentSheetQrFallback" hidden>QR image unavailable. Use the account details above.</figcaption>
                        <button type="button" id="azPaymentSheetRetryQr" class="az-payment-sheet__action" hidden>Retry QR</button>
                        <small id="azPaymentSheetQrDiagnostic" hidden></small>
                    </figure>

                    <div id="azPaymentSheetActions" class="az-payment-sheet__actions" hidden>
                        <button type="button" id="azPaymentSheetSaveQr" class="az-payment-sheet__action" hidden>Save QR</button>
                        <button type="button" id="azPaymentSheetOpenBankApp" class="az-payment-sheet__action" hidden>Open Bank App</button>
                    </div>

                    <div id="azPaymentSheetAppFallback" class="az-payment-sheet__fallback" hidden></div>

                    <section id="azPaymentSheetChecklist" class="az-payment-sheet__checklist" hidden>
                        <span>Payment progress</span>
                        <ol id="azPaymentSheetChecklistSteps"></ol>
                    </section>

                    <p id="azPaymentSheetInstructions" class="az-payment-sheet__instructions"></p>

                    <button type="button" id="azPaymentSheetOpenApp" class="az-payment-sheet__secondary" hidden>Open Payment App</button>

                    <section id="azPaymentSheetReceipt" class="az-payment-sheet__receipt">
                        <div class="az-payment-sheet__receipt-copy">
                            <strong>Payment receipt</strong>
                            <span>Choose the screenshot after you finish the transfer.</span>
                        </div>

                        <label class="az-payment-sheet__upload">
                            <span>Choose screenshot</span>
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
        if (!isDevelopmentHost()) {
            el.hidden = true;
            el.textContent = "";
            return;
        }
        el.textContent = `dev: qrMode=${options.qrMode || "unknown"}; source=${sourceType || "none"}`;
        el.hidden = false;
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
            "upload_receipt",
            "wait_for_confirmation",
            "confirm_payment"
        ].includes(action);
    }

    function defaultChecklistSteps(options = {}) {
        const steps = [];
        if (options.enableSaveQr && (options.qrImageUrl || options.qrImage)) {
            steps.push({ key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 });
        }
        if (options.enableOpenApp && (options.deepLink || options.deepLinkUrl || options.openAppMode === "bank_chooser")) {
            steps.push({
                key: "open_app",
                label: options.openAppMode === "bank_chooser"
                    ? "Open banking app"
                    : `Open ${options.appDisplayName || options.methodName || "payment app"}`,
                action: "open_app",
                enabled: true,
                sortOrder: 20
            });
        }
        if (options.requiresSlip !== false) {
            steps.push({ key: "upload_receipt", label: "Upload receipt", action: "upload_receipt", enabled: true, sortOrder: 30 });
        } else {
            steps.push({ key: "wait_for_confirmation", label: "Wait for confirmation", action: "wait_for_confirmation", enabled: true, sortOrder: 30 });
        }
        return steps;
    }

    function normalizeChecklistSteps(options = {}) {
        const configured = Array.isArray(options.checklistSteps) ? options.checklistSteps : [];
        const source = configured.length ? configured : defaultChecklistSteps(options);

        return source
            .filter(step => step && step.enabled !== false && knownChecklistAction(step.action))
            .map((step, index) => ({
                key: step.key || step.action || `step_${index}`,
                label: step.label || String(step.action || "").replaceAll("_", " "),
                action: step.action,
                sortOrder: Number(step.sortOrder || (index + 1) * 10)
            }))
            .sort((a, b) => a.sortOrder - b.sortOrder);
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
        const canSaveQr = bool(options.enableSaveQr) && Boolean(qr);
        const canOpenApp = bool(options.enableOpenApp) &&
            (String(options.openAppMode || "direct") === "bank_chooser" || Boolean(appTarget.url));
        if (actions) actions.hidden = !(canSaveQr || canOpenApp);
        if (saveQr) {
            saveQr.hidden = !canSaveQr;
            saveQr.onclick = canSaveQr ? () => downloadQr(activeState) : null;
        }
        if (openBankApp) {
            const appName = String(options.openAppMode || "direct") === "bank_chooser"
                ? "Bank App"
                : options.appDisplayName || options.methodName || "Bank App";
            openBankApp.hidden = !canOpenApp;
            openBankApp.textContent = `Open ${appName}`;
            openBankApp.onclick = canOpenApp ? () => openPaymentApp(activeState) : null;
        }
    }

    function configuredThaiBankApps() {
        return Array.isArray(window.AZIEL_TH_BANK_APPS)
            ? window.AZIEL_TH_BANK_APPS.filter(app => app && app.enabled !== false)
            : [];
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
            persistCheckoutState(activeState);
        } catch (error) {
            setQrLoading(false, error.message || "Could not generate PromptPay QR.");
            setMessage("error", "Could not generate PromptPay QR. Please retry.");
        }
    }

    function resolveAppLaunchTarget(options = {}) {
        const mode = String(options.appLaunchMode || "OFFICIAL_PAYMENT_DEEPLINK").toUpperCase();
        const userAgent = navigator.userAgent || "";
        const isIOS = /iPad|iPhone|iPod/i.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const isAndroid = /Android/i.test(userAgent);
        if (mode === "APP_ONLY") {
            return {
                mode,
                platform: isIOS ? "ios" : isAndroid ? "android" : "desktop",
                url: isIOS
                    ? options.iosAppLaunchUrl || ""
                    : isAndroid
                        ? options.androidAppLaunchUrl || ""
                        : options.iosAppLaunchUrl || options.androidAppLaunchUrl || "",
                storeUrl: isIOS
                    ? options.appStoreFallbackUrl || options.appStoreUrl || ""
                    : isAndroid
                        ? options.playStoreFallbackUrl || options.playStoreUrl || ""
                        : ""
            };
        }
        return {
            mode,
            platform: isIOS ? "ios" : isAndroid ? "android" : "desktop",
            url: options.deepLink || options.deepLinkUrl || "",
            storeUrl: isIOS
                ? options.appStoreFallbackUrl || options.appStoreUrl || ""
                : isAndroid
                    ? options.playStoreFallbackUrl || options.playStoreUrl || ""
                    : ""
        };
    }

    function resolveBankProfileLaunchTarget(profile = {}) {
        return resolveAppLaunchTarget({
            appLaunchMode: profile.appLaunchMode || "OFFICIAL_PAYMENT_DEEPLINK",
            deepLink: profile.deepLink || profile.deepLinkUrl || "",
            deepLinkUrl: profile.deepLinkUrl || profile.deepLink || "",
            iosAppLaunchUrl: profile.iosAppLaunchUrl || "",
            androidAppLaunchUrl: profile.androidAppLaunchUrl || "",
            appStoreFallbackUrl: profile.appStoreFallbackUrl || profile.appStoreUrl || "",
            playStoreFallbackUrl: profile.playStoreFallbackUrl || profile.playStoreUrl || "",
            appStoreUrl: profile.appStoreUrl || "",
            playStoreUrl: profile.playStoreUrl || ""
        });
    }

    function showBankChooser(options = {}) {
        const fallback = document.getElementById("azPaymentSheetAppFallback");
        if (!fallback) return;

        const apps = configuredThaiBankApps();
        if (!apps.length) {
            fallback.innerHTML = "<span>Open your banking app and import the saved QR.</span>";
            fallback.hidden = false;
            setMessage("success", "Open your banking app and import the saved QR. Return here after transfer and upload your receipt.");
            return;
        }

        fallback.innerHTML = `
            <span>Choose a banking app. This only opens the app; it does not change the payment.</span>
            <div class="az-payment-sheet__bank-list">
                ${apps.map((app, index) => {
                    const target = resolveBankProfileLaunchTarget(app);
                    const disabled = !target.url;
                    return `
                        <button type="button" data-bank-index="${index}" ${disabled ? "disabled" : ""}>
                            ${app.logo ? `<img src="${escapeHTML(app.logo)}" alt="" aria-hidden="true">` : ""}
                            <span>${escapeHTML(app.label || app.appDisplayName || "Banking App")}</span>
                        </button>
                    `;
                }).join("")}
                <button type="button" data-bank-fallback="other">
                    <span>Other Bank</span>
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
        fallback.querySelector("[data-bank-fallback='other']")?.addEventListener("click", () => {
            setMessage("success", "Open your banking app and import the saved QR. Return here after transfer and upload your receipt.");
        });
    }

    function launchBankProfile(profile = {}, options = {}) {
        const target = resolveBankProfileLaunchTarget(profile);
        if (!target.url) {
            setMessage("error", "This banking app link is unavailable. Open your banking app and import the saved QR.");
            return;
        }
        updateChecklist("open_app");
        persistCheckoutState(activeState || options);
        setMessage("success", `Opening ${profile.label || profile.appDisplayName || "banking app"}. Return here after transfer and upload your receipt.`);
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
            completedChecklistActions: new Set(restored.completedChecklistActions || [])
        };

        modal.querySelector("#azPaymentSheetTitle").textContent = `${methodName} Transfer`;
        modal.querySelector("#azPaymentSheetAmount").textContent = `${amount.toLocaleString()} ${currency}`.trim();
        modal.querySelector("#azPaymentSheetSubtitle").textContent = options.subtitle || "Transfer the exact amount";
        modal.querySelector("#azPaymentSheetInstructions").textContent =
            options.instructions || (requiresSlip
                ? "Transfer the exact amount, then upload the payment receipt."
                : "Scan or complete the payment using the details shown.");

        modal.querySelector("#azPaymentSheetDetails").innerHTML = [
            row("Account", options.accountName || "", options.accountName || ""),
            row("Account Number", options.accountNumber || "", options.accountNumber || ""),
            row("Reference", reference, reference)
        ].join("");

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

        modal.querySelector("#azPaymentSheetReceipt").hidden = !requiresSlip;
        modal.querySelector("#azPaymentSheetSubmit").textContent = submitLabel;
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
