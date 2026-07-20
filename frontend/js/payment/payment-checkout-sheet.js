// frontend/js/payment/payment-checkout-sheet.js
// Shared AZIEL customer payment checkout sheet.

(function () {
    let activeState = null;

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

    function safeFilePart(value = "payment") {
        return String(value || "payment")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "payment";
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
        if (options.enableOpenApp && options.deepLink) {
            steps.push({
                key: "open_app",
                label: `Open ${options.appDisplayName || options.methodName || "payment app"}`,
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

    async function downloadQr(options = {}) {
        const modal = document.getElementById("azPaymentCheckoutSheet");
        const qrImg = modal?.querySelector("#azPaymentSheetQrImage");
        const qrCanvas = modal?.querySelector("#azPaymentSheetQrWrap canvas");
        const filename = `${safeFilePart(options.methodCode || options.methodName || "aziel-payment")}-${safeFilePart(options.reference || "qr")}.png`;

        let href = "";
        if (qrCanvas?.toDataURL) {
            href = qrCanvas.toDataURL("image/png");
        } else if (qrImg?.src) {
            href = qrImg.currentSrc || qrImg.src;
        }

        if (!href) {
            setMessage("error", "QR image is unavailable.");
            return;
        }

        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = filename;
        anchor.rel = "noopener noreferrer";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        updateChecklist("save_qr");
        showToast("QR saved", "success");
    }

    function openPaymentApp(options = {}) {
        const deepLink = String(options.deepLink || "").trim();
        if (!deepLink) {
            setMessage("error", "Payment app link is unavailable.");
            return;
        }

        updateChecklist("open_app");
        setMessage("success", `Opening ${options.appDisplayName || options.methodName || "payment app"}. Return here after transfer and upload your receipt.`);
        window.location.href = deepLink;

        const fallback = document.getElementById("azPaymentSheetAppFallback");
        if (!fallback) return;

        window.setTimeout(() => {
            if (!document.getElementById("azPaymentCheckoutSheet")?.classList.contains("show")) return;

            const links = [
                options.appStoreUrl ? `<a href="${escapeHTML(options.appStoreUrl)}" target="_blank" rel="noopener noreferrer">App Store</a>` : "",
                options.playStoreUrl ? `<a href="${escapeHTML(options.playStoreUrl)}" target="_blank" rel="noopener noreferrer">Google Play</a>` : ""
            ].filter(Boolean);

            if (!links.length) return;
            fallback.innerHTML = `
                <span>App did not open?</span>
                ${links.join("")}
            `;
            fallback.hidden = false;
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

        if (!input || !preview || !image || !name) return;

        input.value = "";
        preview.hidden = true;
        image.removeAttribute("src");
        name.textContent = "";

        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            name.textContent = file.name || "Selected payment receipt";
            image.src = URL.createObjectURL(file);
            preview.hidden = false;
            setMessage("", "");
            updateChecklist("upload_receipt");
        };

        document.getElementById("azPaymentSheetRemoveFile").onclick = () => {
            input.value = "";
            preview.hidden = true;
            image.removeAttribute("src");
            name.textContent = "";
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
        const qr = normalizeUrl(options.qrImageUrl || options.qrImage || "");
        const submitLabel = options.submitLabel || (requiresSlip ? "Submit for Verification" : "Continue");

        activeState = {
            ...options,
            requiresSlip,
            submitLabel,
            checklistSteps: [],
            completedChecklistActions: new Set()
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

        const qrWrap = modal.querySelector("#azPaymentSheetQrWrap");
        const qrImg = modal.querySelector("#azPaymentSheetQrImage");
        const qrFallback = modal.querySelector("#azPaymentSheetQrFallback");
        if (qr && qrWrap && qrImg) {
            qrImg.src = qr;
            qrImg.onerror = () => {
                qrImg.removeAttribute("src");
                qrFallback.hidden = false;
            };
            qrFallback.hidden = true;
            qrWrap.hidden = false;
        } else if (qrWrap) {
            qrWrap.hidden = true;
        }

        const actions = modal.querySelector("#azPaymentSheetActions");
        const saveQr = modal.querySelector("#azPaymentSheetSaveQr");
        const openBankApp = modal.querySelector("#azPaymentSheetOpenBankApp");
        const fallback = modal.querySelector("#azPaymentSheetAppFallback");
        const canSaveQr = bool(options.enableSaveQr) && Boolean(qr);
        const canOpenApp = bool(options.enableOpenApp) && Boolean(options.deepLink);
        if (fallback) {
            fallback.hidden = true;
            fallback.innerHTML = "";
        }
        if (actions) actions.hidden = !(canSaveQr || canOpenApp);
        if (saveQr) {
            saveQr.hidden = !canSaveQr;
            saveQr.onclick = canSaveQr ? () => downloadQr(activeState) : null;
        }
        if (openBankApp) {
            const appName = options.appDisplayName || methodName;
            openBankApp.hidden = !canOpenApp;
            openBankApp.textContent = `Open ${appName}`;
            openBankApp.onclick = canOpenApp ? () => openPaymentApp(activeState) : null;
        }

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
        setMessage("", options.error || "");
        modal.classList.add("show");
        document.body.classList.add("az-payment-sheet-open");
        modal.querySelector("[data-role='close']")?.focus();
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
})();
