(function () {
    const t = (key, fallback) => window.AZIEL_LOCALE?.t?.(key, fallback) || fallback;
    const value = (...items) => items.find(item => item !== undefined && item !== null && String(item).trim()) || "";
    function supports(staged) {
        const region = String(staged?.session?.region || staged?.orderData?.region || staged?.selectedPayment?.region || "").toUpperCase();
        const type = String(staged?.paymentType || staged?.selectedPayment?.paymentType || staged?.session?.paymentType || "").toLowerCase();
        return region === "MM" && ["manual", "deeplink", "deep_link"].includes(type);
    }
    function detail(label, content) {
        if (!content) return null;
        const node = document.createElement("div"); node.className = "mm-payment-shell__detail";
        const name = document.createElement("span"); name.textContent = label;
        const data = document.createElement("strong"); data.textContent = content;
        node.append(name, data); return node;
    }
    function displayReference(content) {
        const text = String(content || "");
        if (text.length <= 32) return text;
        return `${text.slice(0, 15)}…${text.slice(-10)}`;
    }
    async function copyValue(button, content) {
        const original = button.textContent;
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(String(content));
            else {
                const area = document.createElement("textarea"); area.value = String(content); area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
                document.body.append(area); area.select();
                if (!document.execCommand?.("copy")) throw new Error("Clipboard unavailable");
                area.remove();
            }
            button.textContent = t("payment.copied", "Copied");
        } catch (_) { button.textContent = t("payment.copyFailed", "Copy failed"); }
        window.setTimeout(() => { button.textContent = original; }, 1400);
    }
    function copyableDetail(label, content, { compact = false } = {}) {
        const node = detail(label, compact ? displayReference(content) : content);
        if (!node) return null;
        if (compact) {
            const data = node.querySelector("strong");
            data.classList.add("mm-payment-shell__reference");
            data.dataset.fullValue = String(content);
        }
        const action = document.createElement("button"); action.type = "button"; action.className = "mm-payment-shell__copy"; action.textContent = t("payment.copy", "Copy");
        action.addEventListener("click", () => copyValue(action, content));
        node.append(action); return node;
    }
    function show(staged, { onSubmitted } = {}) {
        const order = staged.orderData || {}, session = staged.session || {};
        const payment = { ...(staged.selectedPayment || {}), ...(session.selectedPaymentMethod || {}) };
        const mount = document.getElementById("paymentSessionMount");
        const methodName = value(session.paymentName, payment.method, payment.paymentName, payment.name, payment.key);
        const shell = document.createElement("section"); shell.className = "checkout-card mm-payment-shell";
        const title = document.createElement("h2"); title.className = "mm-payment-shell__title"; title.textContent = `${t("payment.payWith", "Pay with")} ${methodName}`.trim();
        const amount = document.createElement("strong"); amount.className = "mm-payment-shell__amount"; amount.textContent = `${Number(value(session.amount, order.amount) || 0).toLocaleString()} ${value(session.currency, order.currency)}`.trim();
        const intro = document.createElement("p"); intro.textContent = t("payment.transferExactAmount", "Transfer the exact amount.");
        const hero = document.createElement("div"); hero.className = "mm-payment-shell__hero"; hero.append(title, amount, intro); shell.append(hero);
        const qrSource = value(session.qrImage, session.qrUrl, payment.qrImage, payment.qrUrl);
        if (qrSource) { const qrSection = document.createElement("section"); qrSection.className = "mm-payment-shell__qr-section"; const qrLabel = document.createElement("h3"); qrLabel.textContent = t("payment.scanToPay", "Scan to pay"); const qr = document.createElement("img"); qr.className = "mm-payment-shell__qr"; qr.src = qrSource; qr.alt = t("payment.qrCode", "Payment QR code"); qrSection.append(qrLabel, qr); shell.append(qrSection); }
        const details = document.createElement("div"); details.className = "mm-payment-shell__details";
        const reference = value(session.reference, session.commerceOrderId, order.commerceOrderId, order.orderId);
        const accountNameDetail = detail(t("payment.accountName", "Account name"), value(session.accountName, payment.accountName));
        const accountNumberDetail = copyableDetail(t("payment.accountNumber", "Account number"), value(session.accountNumber, payment.accountNumber));
        const referenceDetail = copyableDetail(t("payment.reference", "Reference"), reference, { compact: true });
        accountNameDetail?.classList.add("mm-payment-shell__account-name");
        accountNumberDetail?.classList.add("mm-payment-shell__account-number");
        referenceDetail?.classList.add("mm-payment-shell__reference-row");
        if (accountNumberDetail) details.append(accountNumberDetail);
        const extraDetails = document.createElement("div"); extraDetails.id = "mmPaymentExtraDetails"; extraDetails.className = "mm-payment-shell__detail-extra";
        [accountNameDetail, referenceDetail].filter(Boolean).forEach(node => extraDetails.append(node));
        if (extraDetails.childElementCount) {
            const detailToggle = document.createElement("button"); detailToggle.type = "button"; detailToggle.className = "mm-payment-shell__detail-toggle"; detailToggle.setAttribute("aria-controls", extraDetails.id);
            const mobileDetails = window.matchMedia("(max-width: 768px)");
            const setExpanded = expanded => { detailToggle.setAttribute("aria-expanded", String(expanded)); detailToggle.textContent = expanded ? t("payment.hideDetails", "Hide details") : t("payment.showDetails", "Show details"); extraDetails.hidden = !expanded; };
            setExpanded(!mobileDetails.matches);
            detailToggle.addEventListener("click", () => setExpanded(detailToggle.getAttribute("aria-expanded") !== "true"));
            mobileDetails.addEventListener?.("change", event => setExpanded(!event.matches));
            details.append(detailToggle, extraDetails);
        }
        if (details.childElementCount) { const detailSection = document.createElement("section"); detailSection.className = "mm-payment-shell__detail-section"; const detailTitle = document.createElement("h3"); detailTitle.textContent = t("payment.accountInformation", "Account information"); detailSection.append(detailTitle, details); shell.append(detailSection); }
        const deepLink = value(session.deepLink, session.deepLinkUrl, payment.deepLink, payment.deepLinkUrl);
        if (deepLink && (session.enableOpenApp === true || payment.enableOpenApp === true)) { const open = document.createElement("a"); open.className = "mm-payment-shell__open-app"; open.href = deepLink; open.textContent = t("payment.openApp", "Open payment app"); shell.append(open); }
        const receiptEnabled = session.receiptUploadEnabled !== false && payment.receiptUploadEnabled !== false;
        const slipRequired = receiptEnabled && session.requiresSlip !== false && payment.requiresSlip !== false && session.slipRequired !== false && payment.slipRequired !== false;
        const form = document.createElement("form"); form.className = "mm-payment-shell__form";
        const receiptTitle = document.createElement("h3"); receiptTitle.textContent = t("payment.uploadSlip", "Upload payment slip");
        const input = document.createElement("input"); input.id = "mmPaymentSlip"; input.className = "mm-payment-shell__file-input"; input.type = "file"; input.name = "slip"; input.accept = "image/*"; input.required = slipRequired;
        const label = document.createElement("label"); label.htmlFor = "mmPaymentSlip"; label.className = "mm-payment-shell__upload";
        const uploadIcon = document.createElement("span"); uploadIcon.className = "mm-payment-shell__upload-icon"; uploadIcon.setAttribute("aria-hidden", "true"); uploadIcon.textContent = "↑";
        const uploadCopy = document.createElement("span"); uploadCopy.className = "mm-payment-shell__upload-copy";
        const uploadAction = document.createElement("strong"); uploadAction.textContent = t("payment.chooseSlip", "Choose payment slip");
        const uploadHint = document.createElement("small"); uploadHint.textContent = t("payment.acceptedImages", "Image files accepted");
        uploadCopy.append(uploadAction, uploadHint); label.append(uploadIcon, uploadCopy);
        const fileState = document.createElement("span"); fileState.className = "mm-payment-shell__file-state"; fileState.textContent = t("payment.noSlipSelected", "No payment slip selected");
        const preview = document.createElement("img"); preview.className = "mm-payment-shell__preview"; preview.hidden = true;
        const submit = document.createElement("button"); submit.type = "submit"; submit.className = "primary-commerce-action"; submit.textContent = t("payment.submitPayment", "Submit Payment"); submit.disabled = slipRequired;
        const message = document.createElement("p"); message.className = "checkout-feedback"; message.setAttribute("role", "status");
        if (receiptEnabled) form.append(receiptTitle, input, label, fileState, preview);
        form.append(submit, message); shell.append(form); mount.replaceChildren(shell);
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            fileState.textContent = file?.name || t("payment.noSlipSelected", "No payment slip selected");
            uploadAction.textContent = file ? t("payment.replaceSlip", "Replace payment slip") : t("payment.chooseSlip", "Choose payment slip");
            submit.disabled = slipRequired && !file;
            if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
            if (file?.type?.startsWith("image/")) { const url = URL.createObjectURL(file); preview.src = url; preview.alt = t("payment.slipPreview", "Payment slip preview"); preview.dataset.objectUrl = url; preview.hidden = false; }
            else { preview.hidden = true; preview.removeAttribute("src"); preview.removeAttribute("alt"); delete preview.dataset.objectUrl; }
        });
        form.addEventListener("submit", async event => {
            event.preventDefault();
            const file = input.files?.[0];
            if (slipRequired && !file) { message.textContent = t("payment.slipRequired", "Please upload your payment slip."); return; }
            const backLink = document.getElementById("paymentBackLink");
            const lock = window.AZIEL_PURCHASE_TRANSITION?.acquire?.("SUBMITTING_PAYMENT", { controls: [input, submit, backLink], statusNode: message, message: t("payment.submitting", "Submitting payment...") });
            if (!lock) return;
            try {
                const result = await window.PaymentManual.submitReceipt(order, session, file, (_, text) => { message.textContent = text; });
                lock.release();
                onSubmitted?.({ orderId: result.orderId, data: result.data, amount: value(session.amount, order.amount), currency: value(session.currency, order.currency), methodName, reference });
            } catch (error) { message.textContent = error.message || t("payment.submitFailed", "Submission failed. Please try again."); lock.release(); }
        });
    }
    window.AZIEL_MM_PAYMENT_SHELL = Object.freeze({ supports, show });
})();
