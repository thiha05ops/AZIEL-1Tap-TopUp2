(function () {
    const t = (key, fallback, params = {}) => {
        const translated = window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback;
        return Object.entries(params).reduce((result, [name, replacement]) => result.replaceAll(`{${name}}`, String(replacement)), translated);
    };
    const value = (...items) => items.find(item => item !== undefined && item !== null && String(item).trim()) || "";
    let myanMyanPayCountdownInterval = null;
    let myanMyanPayCountdownClear = null;
    let myanMyanPayCountdownObserver = null;

    function countdownState(initiatedAt, now = Date.now()) {
        return window.AZIEL_MYANMYANPAY_QR_LIFECYCLE?.state?.(initiatedAt, now) || Object.freeze({ valid: false, expired: false, remainingSeconds: 0, deadlineMs: 0 });
    }

    function formatCountdown(seconds) {
        return window.AZIEL_MYANMYANPAY_QR_LIFECYCLE?.format?.(seconds) || "00:00";
    }

    function stopMyanMyanPayCountdown() {
        if (myanMyanPayCountdownInterval !== null) (myanMyanPayCountdownClear || window.clearInterval)(myanMyanPayCountdownInterval);
        myanMyanPayCountdownInterval = null;
        myanMyanPayCountdownClear = null;
        myanMyanPayCountdownObserver?.disconnect?.();
        myanMyanPayCountdownObserver = null;
    }

    function startMyanMyanPayCountdown(node, initiatedAt, options = {}) {
        stopMyanMyanPayCountdown();
        const lifecycle = window.AZIEL_MYANMYANPAY_QR_LIFECYCLE;
        if (!lifecycle) return stopMyanMyanPayCountdown;
        myanMyanPayCountdownClear = stop => stop?.();
        myanMyanPayCountdownInterval = lifecycle.start({
            createdAt: initiatedAt,
            now: options.now,
            setInterval: options.setInterval,
            clearInterval: options.clearInterval,
            onTick(state) {
                if (node.isConnected === false) { stopMyanMyanPayCountdown(); return; }
                node.classList?.toggle?.("is-expired", state.expired);
                node.textContent = state.valid && !state.expired
                    ? lifecycle.text("payWithin", { time: lifecycle.format(state.remainingSeconds) })
                    : "00:00";
                options.onTick?.(state);
            },
            onLocaleChange: options.onLocaleChange,
            onExpire: options.onExpire
        });
        return stopMyanMyanPayCountdown;
    }

    window.addEventListener?.("pagehide", stopMyanMyanPayCountdown);
    function isMyanMyanPay(staged = {}) {
        const session = staged.session || {};
        const payment = staged.selectedPayment || session.selectedPaymentMethod || {};
        return String(session.provider || payment.provider || "").toUpperCase() === "MYANMYANPAY" &&
            String(session.paymentMethod || payment.key || "").toLowerCase() === "myanmyanpay_mmqr" &&
            String(session.paymentChannel || payment.paymentChannel || "").toUpperCase() === "MYANMYANPAY_MMQR" &&
            String(session.confirmationMode || payment.confirmationMode || "").toLowerCase() === "provider_webhook";
    }
    function supports(staged) {
        if (isMyanMyanPay(staged)) return true;
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
    function saveDisplayedQr(qrSource, orderId) {
        if (!qrSource) return;
        const safeOrderId = String(orderId || "payment").replace(/[^a-z0-9_-]/gi, "-").slice(0, 48) || "payment";
        const download = document.createElement("a");
        download.href = qrSource;
        download.download = `aziel-mmqr-${safeOrderId}.png`;
        download.hidden = true;
        document.body.append(download);
        download.click();
        download.remove();
    }
    function show(staged, { onSubmitted } = {}) {
        stopMyanMyanPayCountdown();
        const order = staged.orderData || {}, session = staged.session || {};
        const payment = { ...(staged.selectedPayment || {}), ...(session.selectedPaymentMethod || {}) };
        const mount = document.getElementById("paymentSessionMount");
        const myanMyanPay = isMyanMyanPay(staged);
        const methodName = myanMyanPay ? "MMQR" : value(session.paymentName, payment.method, payment.paymentName, payment.name, payment.key);
        const methodLogoUrl = value(payment.logoUrl, payment.logo);
        const shell = document.createElement("section"); shell.className = `checkout-card mm-payment-shell${myanMyanPay ? " mm-payment-shell--mmqr" : ""}`;
        const title = document.createElement("h2"); title.className = "mm-payment-shell__title"; title.textContent = myanMyanPay ? t("payment.payWithMmqr", "Pay with MMQR") : `${t("payment.payWith", "Pay with")} ${methodName}`.trim();
        const amount = document.createElement("strong"); amount.className = "mm-payment-shell__amount"; amount.textContent = `${Number(value(session.amount, order.amount) || 0).toLocaleString()} ${value(session.currency, order.currency)}`.trim();
        const intro = document.createElement("p"); intro.textContent = t("payment.transferExactAmount", "Transfer the exact amount.");
        const hero = document.createElement("div"); hero.className = "mm-payment-shell__hero";
        if (myanMyanPay && methodLogoUrl) {
            const logo = document.createElement("img"); logo.className = "mm-payment-shell__mmqr-logo"; logo.alt = "MMQR"; logo.hidden = true;
            logo.addEventListener("load", () => { logo.hidden = false; }, { once: true });
            logo.addEventListener("error", () => logo.remove(), { once: true });
            logo.src = methodLogoUrl; hero.append(logo);
        }
        hero.append(title, amount);
        if (!myanMyanPay) hero.append(intro);
        shell.append(hero);
        const qrSource = value(session.qrImage, session.qrUrl, payment.qrImage, payment.qrUrl);
        let countdown = null;
        if (qrSource) {
            const qrSection = document.createElement("section"); qrSection.className = "mm-payment-shell__qr-section";
            const qrLabel = document.createElement("h3"); qrLabel.textContent = myanMyanPay ? t("payment.scanMmqr", "Scan the MMQR") : t("payment.scanToPay", "Scan to pay");
            const qr = document.createElement("img"); qr.className = "mm-payment-shell__qr"; qr.src = qrSource; qr.alt = myanMyanPay ? t("payment.mmqrCode", "MMQR payment QR code") : t("payment.qrCode", "Payment QR code");
            qrSection.append(qrLabel, qr);
            if (myanMyanPay) {
                const lifecycle = window.AZIEL_MYANMYANPAY_QR_LIFECYCLE;
                countdown = document.createElement("p"); countdown.className = "mm-payment-shell__countdown"; countdown.setAttribute("role", "timer"); countdown.setAttribute("aria-live", "polite");
                qrLabel.after(countdown);
                const expiredOverlay = document.createElement("div"); expiredOverlay.className = "mm-payment-shell__expired-overlay"; expiredOverlay.hidden = true; expiredOverlay.setAttribute("role", "status");
                const warningIcon = document.createElement("span"); warningIcon.className = "mm-payment-shell__warning-icon"; warningIcon.setAttribute("aria-hidden", "true"); warningIcon.textContent = "!";
                const expiredTitle = document.createElement("strong"); expiredTitle.textContent = lifecycle?.text("expiredTitle") || "QR Expired";
                const expiredWarning = document.createElement("span"); expiredWarning.textContent = lifecycle?.text("expiredWarning") || "Do not make a payment using this QR.";
                expiredOverlay.append(warningIcon, expiredTitle, expiredWarning); qrSection.append(expiredOverlay);
                const save = document.createElement("button"); save.type = "button"; save.className = "mm-payment-shell__save-qr"; save.innerHTML = '<i class="fa-solid fa-download" aria-hidden="true"></i><span>Save QR</span>';
                save.addEventListener("click", () => saveDisplayedQr(qrSource, value(session.commerceOrderId, session.orderId, order.commerceOrderId, order.orderId)));
                const compatibility = document.createElement("p"); compatibility.className = "mm-payment-shell__compatibility"; compatibility.textContent = lifecycle?.text("activeInstruction") || "Scan and complete your payment before the timer ends.\nYour payment will be confirmed automatically.";
                const warning = document.createElement("p"); warning.className = "mm-payment-shell__expiry-warning"; warning.textContent = lifecycle?.text("activeWarning") || "Do not make a payment after the timer reaches 00:00.";
                const expiredState = document.createElement("div"); expiredState.className = "mm-payment-shell__expired-state"; expiredState.hidden = true;
                const explanation = document.createElement("p"); explanation.textContent = lifecycle?.text("expiredExplanation") || "This payment QR has expired.\nPayments made using an expired QR will not be accepted by AZIEL.";
                const fresh = document.createElement("a"); fresh.className = "primary-commerce-action"; fresh.href = "/checkout"; fresh.textContent = lifecycle?.text("startNewPayment") || "Start New Payment";
                fresh.addEventListener("click", () => { stopMyanMyanPayCountdown(); sessionStorage.removeItem("azielPaymentPageSession"); sessionStorage.removeItem("azielProductCheckoutDraft"); });
                expiredState.append(explanation, fresh); qrSection.append(save, compatibility, warning, expiredState);
                qrSection._mmqrExpiryView = { qr, save, compatibility, warning, expiredOverlay, expiredState };
            }
            shell.append(qrSection);
        }
        const details = document.createElement("div"); details.className = "mm-payment-shell__details";
        const reference = value(session.reference, session.commerceOrderId, order.commerceOrderId, order.orderId);
        const accountNameDetail = detail(t("payment.accountName", "Account name"), value(session.accountName, payment.accountName));
        const accountNumberDetail = copyableDetail(t("payment.accountNumber", "Account number"), value(session.accountNumber, payment.accountNumber));
        const referenceDetail = copyableDetail(t("payment.reference", "Reference"), reference, { compact: true });
        accountNameDetail?.classList.add("mm-payment-shell__account-name");
        accountNumberDetail?.classList.add("mm-payment-shell__account-number");
        referenceDetail?.classList.add("mm-payment-shell__reference-row");
        if (accountNumberDetail && !myanMyanPay) details.append(accountNumberDetail);
        const extraDetails = document.createElement("div"); extraDetails.id = "mmPaymentExtraDetails"; extraDetails.className = "mm-payment-shell__detail-extra";
        if (myanMyanPay) {
            if (referenceDetail) details.append(referenceDetail);
        } else [accountNameDetail, referenceDetail].filter(Boolean).forEach(node => extraDetails.append(node));
        if (!myanMyanPay && extraDetails.childElementCount) {
            const detailToggle = document.createElement("button"); detailToggle.type = "button"; detailToggle.className = "mm-payment-shell__detail-toggle"; detailToggle.setAttribute("aria-controls", extraDetails.id);
            const mobileDetails = window.matchMedia("(max-width: 768px)");
            const setExpanded = expanded => { detailToggle.setAttribute("aria-expanded", String(expanded)); detailToggle.textContent = expanded ? t("payment.hideDetails", "Hide details") : t("payment.showDetails", "Show details"); extraDetails.hidden = !expanded; };
            setExpanded(!mobileDetails.matches);
            detailToggle.addEventListener("click", () => setExpanded(detailToggle.getAttribute("aria-expanded") !== "true"));
            mobileDetails.addEventListener?.("change", event => setExpanded(!event.matches));
            details.append(detailToggle, extraDetails);
        }
        if (details.childElementCount) {
            const detailSection = document.createElement("section"); detailSection.className = "mm-payment-shell__detail-section";
            if (!myanMyanPay) { const detailTitle = document.createElement("h3"); detailTitle.textContent = t("payment.accountInformation", "Account information"); detailSection.append(detailTitle); }
            detailSection.append(details); shell.append(detailSection);
        }
        const deepLink = value(session.deepLink, session.deepLinkUrl, payment.deepLink, payment.deepLinkUrl);
        if (!myanMyanPay && deepLink && (session.enableOpenApp === true || payment.enableOpenApp === true)) { const open = document.createElement("a"); open.className = "mm-payment-shell__open-app"; open.href = deepLink; open.textContent = t("payment.openApp", "Open payment app"); shell.append(open); }
        if (myanMyanPay) {
            const status = document.createElement("p");
            status.className = `checkout-feedback ${qrSource ? "" : "is-error"}`.trim();
            status.setAttribute("role", "status");
            if (qrSource) {
                const waiting = document.createElement("strong"); waiting.textContent = t("payment.waiting", "Waiting for payment");
                const automatic = document.createElement("span"); automatic.textContent = t("payment.confirmAutomatically", "We'll confirm your payment automatically.");
                status.replaceChildren(waiting, document.createElement("br"), automatic);
            } else status.textContent = t("payment.providerQrUnavailable", "Payment QR is unavailable. Do not send payment; return to checkout and try again.");
            shell.append(status);

            const providerAttribution = document.createElement("p");
            providerAttribution.className = "mm-payment-shell__provider-attribution";
            providerAttribution.textContent = "Payment Powered by MyanMyanPay";
            shell.append(providerAttribution);

            mount.replaceChildren(shell);
            if (countdown) {
                const view = shell.querySelector(".mm-payment-shell__qr-section")?._mmqrExpiryView;
                startMyanMyanPayCountdown(countdown, value(session.initiatedAt, session.paymentInitiatedAt), {
                    onLocaleChange(current) {
                        countdown.textContent = current.valid && !current.expired ? lifecycle.text("payWithin", { time: lifecycle.format(current.remainingSeconds) }) : "00:00";
                        expiredTitle.textContent = lifecycle.text("expiredTitle");
                        expiredWarning.textContent = lifecycle.text("expiredWarning");
                        compatibility.textContent = lifecycle.text("activeInstruction");
                        warning.textContent = lifecycle.text("activeWarning");
                        explanation.textContent = lifecycle.text("expiredExplanation");
                        fresh.textContent = lifecycle.text("startNewPayment");
                    },
                    onExpire() {
                        const section = countdown.closest(".mm-payment-shell__qr-section");
                        section?.classList.add("is-mmqr-expired");
                        if (view) {
                            view.expiredOverlay.hidden = false;
                            view.expiredState.hidden = false;
                            view.save.hidden = true;
                            view.compatibility.hidden = true;
                            view.warning.hidden = true;
                        }
                        status.hidden = true;
                    }
                });
                if (typeof MutationObserver === "function") {
                    myanMyanPayCountdownObserver = new MutationObserver(() => { if (!countdown.isConnected) stopMyanMyanPayCountdown(); });
                    myanMyanPayCountdownObserver.observe(mount, { childList: true });
                }
            }
            return;
        }
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
    window.AZIEL_MM_PAYMENT_SHELL = Object.freeze({ supports, show, _test: Object.freeze({ countdownState, formatCountdown, startMyanMyanPayCountdown, stopMyanMyanPayCountdown, durationMs: window.AZIEL_MYANMYANPAY_QR_LIFECYCLE?.VALIDITY_MS }) });
})();
