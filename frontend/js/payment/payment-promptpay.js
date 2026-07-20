// frontend/js/payment/payment-promptpay.js
// AZIEL PromptPay / Auto Payment V2.5

(function () {
    let pollingTimer = null;
    let promptPayGuideState = null;

    function show(orderData, paymentSession) {
        const modal = PaymentUtils.prepareModal(orderData, paymentSession);
        if (!modal) return;

        PaymentUtils.setModalTitle("Scan & Pay");

        const qr =
            paymentSession.qrUrl ||
            paymentSession.qrImage ||
            window.selectedPaymentData?.qrImage ||
            "";

        PaymentUtils.showQr(qr);

        promptPayGuideState = createGuideState(orderData, paymentSession, qr);
        PaymentUtils.renderDynamic(renderPromptPayGuidance(promptPayGuideState));
        bindPromptPayGuidance(promptPayGuideState);

        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerText = "Waiting for Payment";
        }

        PaymentUtils.startCountdown(600);

        modal.classList.add("show");
        startPolling(orderData.orderId);
    }

    function startPolling(orderId) {
        stopPolling();

        pollingTimer = setInterval(async () => {
            try {
                const res = await fetch(
                    PaymentUtils.apiUrl(`/api/payment/status/${orderId}`)
                );

                const data = await res.json();

                if (!data.success) return;

                if (data.status === "paid") {
                    completeGuideStep("wait_for_confirmation");
                    stopPolling();
                    PaymentUtils.stopCountdown();

                    PaymentUtils.showSuccess(
                        orderId,
                        "Payment Success",
                        "Payment detected. Admin will process your top-up soon."
                    );
                }
            } catch (error) {
                console.log("PromptPay polling error:", error);
            }
        }, 3000);
    }

    function stopPolling() {
        if (pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = null;
        }
    }

    function selectedPayment() {
        return window.selectedPaymentData || {};
    }

    function createGuideState(orderData, paymentSession, qr) {
        const payment = selectedPayment();
        const enableSaveQr = paymentSession.enableSaveQr === true || payment.enableSaveQr === true;
        const enableOpenApp = paymentSession.enableOpenApp === true || payment.enableOpenApp === true;
        const enableChecklist = paymentSession.enableChecklist === true || payment.enableChecklist === true;
        const deepLink = paymentSession.deepLink || paymentSession.deepLinkUrl || payment.deepLink || payment.deepLinkUrl || "";
        const appName = paymentSession.appDisplayName || payment.appDisplayName || "Banking App";
        const bankApps = getPromptPayBankApps(deepLink, appName, paymentSession, payment);
        const hasAppOption = bankApps.length > 0;
        const steps = normalizeSteps(paymentSession.checklistSteps || payment.checklistSteps || [], {
            enableSaveQr,
            enableOpenApp: enableOpenApp || hasAppOption,
            enableChecklist,
            deepLink: hasAppOption ? "configured" : "",
            appName
        });

        return {
            orderId: orderData.orderId,
            methodCode: paymentSession.paymentMethod || payment.key || "promptpay",
            qr,
            enableSaveQr,
            enableOpenApp: enableOpenApp || hasAppOption,
            enableChecklist,
            deepLink,
            appName,
            appStoreUrl: paymentSession.appStoreUrl || payment.appStoreUrl || "",
            playStoreUrl: paymentSession.playStoreUrl || payment.playStoreUrl || "",
            bankApps,
            steps,
            completed: new Set()
        };
    }

    function getPromptPayBankApps(deepLink, appName, paymentSession, payment) {
        const configuredApps = Array.isArray(window.AZIEL_TH_BANK_APPS) ? window.AZIEL_TH_BANK_APPS : [];

        if (configuredApps.length) {
            return configuredApps.map(app => ({
                label: app.label || "Banking App",
                deepLink: app.deepLink || "",
                appStoreUrl: app.appStoreUrl || "",
                playStoreUrl: app.playStoreUrl || ""
            })).filter(app => app.deepLink);
        }

        if (!deepLink) return [];

        return [{
            label: appName || "Banking App",
            deepLink,
            appStoreUrl: paymentSession.appStoreUrl || payment.appStoreUrl || "",
            playStoreUrl: paymentSession.playStoreUrl || payment.playStoreUrl || ""
        }];
    }

    function normalizeSteps(steps = [], options = {}) {
        if (!options.enableChecklist) return [];

        const source = Array.isArray(steps) && steps.length
            ? steps
            : [
                { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
                { key: "open_app", label: `Open ${options.appName}`, action: "open_app", enabled: true, sortOrder: 20 },
                { key: "wait_for_confirmation", label: "Wait for payment confirmation", action: "wait_for_confirmation", enabled: true, sortOrder: 30 }
            ];

        return source
            .filter(step => step?.enabled !== false)
            .filter(step => {
                if (step.action === "save_qr") return options.enableSaveQr;
                if (step.action === "open_app") return options.enableOpenApp && options.deepLink;
                return step.action === "wait_for_confirmation" || step.action === "confirm_payment";
            })
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    }

    function renderPromptPayGuidance(state) {
        const saveButton = state.enableSaveQr && state.qr
            ? `<button type="button" class="promptpay-guide-action" id="promptPaySaveQr">Save QR</button>`
            : "";
        const openButton = state.enableOpenApp && state.bankApps.length
            ? state.bankApps.map((app, index) => `
                <button type="button" class="promptpay-guide-action" data-promptpay-open-app="${index}">
                    Open ${escapeHTML(app.label)}
                </button>
            `).join("")
            : "";
        const actions = saveButton || openButton
            ? `<div class="promptpay-guide-actions">${saveButton}${openButton}</div>`
            : "";
        const checklist = state.steps.length
            ? `
                <div class="promptpay-guide-checklist">
                    <span>Payment progress</span>
                    <ol>
                        ${state.steps.map((step, index) => `
                            <li data-action="${escapeHTML(step.action)}" class="${index === 0 ? "is-active" : ""}">
                                <i aria-hidden="true"></i>
                                <span>${escapeHTML(step.label || step.action)}</span>
                            </li>
                        `).join("")}
                    </ol>
                </div>
            `
            : "";

        return `
            <div class="promptpay-box promptpay-guide">
                <p class="manual-payment-note">
                    <strong>Waiting for payment...</strong>
                    <span>Please scan the QR and complete payment. Confirmation remains automatic.</span>
                </p>
                ${actions}
                <div id="promptPayAppFallback" class="promptpay-app-fallback" hidden></div>
                ${checklist}
            </div>
        `;
    }

    function bindPromptPayGuidance(state) {
        document.getElementById("promptPaySaveQr")?.addEventListener("click", () => savePromptPayQr(state));
        document.querySelectorAll("[data-promptpay-open-app]").forEach(btn => {
            btn.addEventListener("click", () => {
                const index = Number(btn.getAttribute("data-promptpay-open-app") || 0);
                openPromptPayApp(state, state.bankApps[index]);
            });
        });
    }

    async function savePromptPayQr(state) {
        const qr = document.getElementById("modalQrImage");
        const href = qr?.currentSrc || qr?.src || state.qr || "";
        if (!href) {
            PaymentUtils.showToast?.("QR image is unavailable.");
            return;
        }

        if (window.PaymentQrSaver?.save) {
            await window.PaymentQrSaver.save({
                href,
                filename: `${safeFilePart(state.methodCode)}-${safeFilePart(state.orderId)}.png`,
                options: {
                    methodCode: state.methodCode,
                    paymentMethod: state.methodCode,
                    reference: state.orderId,
                    region: state.region
                },
                setMessage: (type, message) => PaymentUtils.showToast?.(message, type),
                onSuccess: () => completeGuideStep("save_qr")
            });
            return;
        }

        PaymentUtils.showToast?.("Could not save QR. Long-press the image to save.", "error");
    }

    function openPromptPayApp(state, app = {}) {
        if (!app.deepLink) return;
        completeGuideStep("open_app");
        window.location.href = app.deepLink;

        setTimeout(() => {
            const box = document.getElementById("promptPayAppFallback");
            if (!box || !document.getElementById("paymentConfirmModal")?.classList.contains("show")) return;
            const links = [
                app.appStoreUrl ? `<a href="${escapeHTML(app.appStoreUrl)}" target="_blank" rel="noopener noreferrer">App Store</a>` : "",
                app.playStoreUrl ? `<a href="${escapeHTML(app.playStoreUrl)}" target="_blank" rel="noopener noreferrer">Google Play</a>` : ""
            ].filter(Boolean);
            if (!links.length) return;
            box.innerHTML = `<span>App did not open?</span>${links.join("")}`;
            box.hidden = false;
        }, 1400);
    }

    function completeGuideStep(action) {
        if (!promptPayGuideState?.steps?.length) return;
        promptPayGuideState.completed.add(action);
        const firstIncomplete = promptPayGuideState.steps.find(step => !promptPayGuideState.completed.has(step.action));
        document.querySelectorAll(".promptpay-guide-checklist [data-action]").forEach(item => {
            const itemAction = item.getAttribute("data-action") || "";
            const complete = promptPayGuideState.completed.has(itemAction);
            const active = !complete && firstIncomplete?.action === itemAction;
            item.classList.toggle("is-complete", complete);
            item.classList.toggle("is-active", active);
        });
    }

    function safeFilePart(value = "promptpay") {
        return String(value || "promptpay").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "promptpay";
    }

    function escapeHTML(value) {
        return window.PaymentUtils?.escapeHTML?.(value) || String(value ?? "");
    }

    window.PaymentPromptPay = {
        show,
        stopPolling
    };
})();
