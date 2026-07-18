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
            submitLabel
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

        const openApp = modal.querySelector("#azPaymentSheetOpenApp");
        if (options.deepLink) {
            openApp.hidden = false;
            openApp.textContent = `Open ${methodName} App`;
            openApp.onclick = () => {
                setMessage("success", "Opening payment app. Return here after transfer and upload your receipt.");
                setTimeout(() => {
                    window.location.href = options.deepLink;
                }, 250);
            };
        } else {
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
