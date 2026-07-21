// frontend/js/admin-payments.js
// AZIEL Admin Payment Methods Manager V2.5

let adminPaymentMethods = [];
let adminPaymentsInitialized = false;

const ADMIN_PAYMENT_PROVIDERS = Object.freeze({
    promptpay: { key: "promptpay", label: "PromptPay", region: "TH" },
    scb: { key: "scb", label: "SCB", region: "TH" },
    bangkok_bank: { key: "bangkok_bank", label: "Bangkok Bank", region: "TH" },
    kplus: { key: "kplus", label: "K PLUS", region: "TH" },
    krungsri: { key: "krungsri", label: "Krungsri", region: "TH" },
    krungthai: { key: "krungthai", label: "Krungthai NEXT", region: "TH" },
    kbzpay: { key: "kbzpay", label: "KBZPay", region: "MM" },
    wavepay: { key: "wavepay", label: "WavePay", region: "MM" },
    ayapay: { key: "ayapay", label: "AYA Pay", region: "MM" },
    mmqr: { key: "mmqr", label: "MMQR", region: "MM" },
    manual_bank: { key: "manual_bank", label: "Manual Bank Transfer", region: "MM" },
    wallet: { key: "wallet", label: "AZIEL Wallet", region: "GLOBAL" }
});

const ADMIN_PROVIDER_BY_REGION_TYPE = Object.freeze({
    TH: {
        auto: ["promptpay"],
        deeplink: ["scb", "bangkok_bank", "kplus", "krungsri", "krungthai"],
        manual: ["promptpay", "scb", "bangkok_bank", "kplus", "krungsri", "krungthai"],
        wallet: ["wallet"]
    },
    MM: {
        auto: [],
        deeplink: ["kbzpay", "wavepay", "ayapay", "manual_bank"],
        manual: ["kbzpay", "wavepay", "ayapay", "mmqr", "manual_bank"],
        wallet: ["wallet"]
    }
});

document.addEventListener("DOMContentLoaded", () => {
    initAdminPaymentsController();
});

function initAdminPaymentsController() {
    if (adminPaymentsInitialized) return;
    adminPaymentsInitialized = true;

    if (isAdminSectionActive("payments") || !document.getElementById("section-payments")) {
        loadAdminPaymentMethods();
    }

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "payments") {
            loadAdminPaymentMethods();
        }
    });

}

async function loadAdminPaymentMethods() {
    const box = document.getElementById("paymentMethodsContainer");
    if (!box) return;

    box.innerHTML = `<div class="admin-list-empty">Loading payment methods...</div>`;

    try {
        const data = await adminFetch("/api/admin/payment-methods");

        if (!data || !data.success) {
            box.innerHTML = `<div class="admin-list-empty">${data?.message || "Failed to load payment methods"}</div>`;
            return;
        }

        adminPaymentMethods = Array.isArray(data.methods) ? data.methods : [];
        renderAdminPaymentMethods(adminPaymentMethods);

    } catch (error) {
        console.log("Load admin payments error:", error);
        box.innerHTML = `<div class="admin-list-empty">Server error while loading payment methods</div>`;
    }
}

function renderAdminPaymentMethods(methods) {
    const box = document.getElementById("paymentMethodsContainer");
    if (!box) return;

    const toolbar = `
        <div class="admin-payment-toolbar">
            <button class="admin-secondary-btn" type="button" data-action="add-payment-method">
                Add Payment Method
            </button>
        </div>
    `;

    if (!methods.length) {
        box.innerHTML = `${toolbar}<div class="admin-list-empty">No payment methods found.</div>`;
        bindAdminPaymentActions();
        return;
    }

    box.innerHTML = toolbar + methods.map(method => {
        const qr = method.uploadedQrImage || method.qrImageUrl || method.qrImage || "";
        const qrUrl = getAdminPaymentUploadUrl(qr);
        const type = method.paymentType || "manual";
        const provider = normalizeAdminProvider(method.provider || method.key || "");
        const displayName = formatPaymentName(method.method || method.key || "Payment");
        const logoUrl = method.logoUrl || getAdminPaymentLogo(method);
        const readiness = getAdminPaymentReadiness(method);
        const status = getAdminPaymentStatus(method, readiness);

        return `
            <div class="payment-method-card" data-id="${escapeAdminHTML(method._id)}" data-key="${escapeAdminHTML(method.key || "")}" data-region="${escapeAdminHTML(method.region || "")}">
                <div class="payment-header">
                    <div class="payment-method-summary-main">
                        <img class="payment-method-summary-logo" src="${escapeAdminHTML(logoUrl)}" alt="${escapeAdminHTML(displayName)} logo" onerror="this.src='/assets/payment/payment-neutral.svg'">
                        <div>
                            <h4>${escapeAdminHTML(displayName)} <small>${escapeAdminHTML(getRegionLabel(method.region))} · ${escapeAdminHTML(getPaymentTypeLabel(type))}</small></h4>
                            <p>${escapeAdminHTML(method.shortDescription || getPaymentTypeDescription(method.key, type, provider))}</p>
                            <p class="payment-readiness-meter">${escapeAdminHTML(readinessSummary(readiness))}</p>
                            <div class="payment-summary-capabilities">
                                ${capabilityChip("QR", hasPaymentQr(method))}
                                ${capabilityChip("App", method.enableOpenApp === true && Boolean(method.deepLinkUrl))}
                                ${capabilityChip("Receipt", method.receiptUploadEnabled !== false && method.slipRequired !== false)}
                            </div>
                        </div>
                    </div>
                    <div class="payment-summary-actions">
                        <p class="payment-config-status ${escapeAdminHTML(status.className)}">${escapeAdminHTML(status.label)}</p>
                        ${readiness.missing.length ? `
                            <p class="payment-config-warning">Missing: ${escapeAdminHTML(readiness.missing.join(", "))}</p>
                        ` : ""}
                        <button class="admin-small-btn" type="button" data-action="preview-payment-method" data-id="${escapeAdminHTML(method._id)}">Preview</button>
                        <button class="admin-small-btn" type="button" data-action="edit-payment-method" data-id="${escapeAdminHTML(method._id)}">Edit</button>
                    </div>

                    <label class="switch">
                        <input class="pm-enabled" type="checkbox" ${method.enabled ? "checked" : ""}>
                        <span>Enabled</span>
                    </label>
                </div>

                <details class="payment-method-editor">
                    <summary>Edit ${escapeAdminHTML(displayName)}</summary>

                <section class="payment-config-section">
                    <h5>Method Overview</h5>

                <div class="settings-row">
                    <div>
                        <label>Payment Method</label>
                        <small>Canonical method identity. Provider is assigned automatically.</small>
                    </div>
                    <select class="pm-method-key" disabled>
                        ${methodIdentityOptionsHTML(method.region, method.key)}
                    </select>
                </div>

                <div class="settings-row">
                    <div>
                        <label>Display Name</label>
                        <small>User-facing payment label shown on storefront cards and summaries</small>
                    </div>
                    <input class="pm-method" type="text" value="${escapeAdminHTML(method.method || "")}">
                </div>

                <div class="settings-row">
                    <div>
                        <label>Region</label>
                        <small>Controls public regional availability</small>
                    </div>
                    <select class="pm-region">
                        <option value="MM" ${method.region === "MM" ? "selected" : ""}>Myanmar</option>
                        <option value="TH" ${method.region === "TH" ? "selected" : ""}>Thailand</option>
                    </select>
                </div>

                <div class="settings-row">
                    <div>
                        <label>Payment Type</label>
                        <small>PromptPay auto, bank app + slip, manual QR, or AZIEL Wallet</small>
                    </div>
                    <select class="pm-type">
                        <option value="manual" ${type === "manual" ? "selected" : ""}>Manual QR + Slip</option>
                        <option value="auto" ${type === "auto" ? "selected" : ""}>Auto Payment</option>
                        <option value="deeplink" ${type === "deeplink" ? "selected" : ""}>Bank App + Slip</option>
                        <option value="wallet" ${type === "wallet" ? "selected" : ""}>AZIEL Wallet</option>
                    </select>
                </div>

                <div class="settings-row">
                    <div>
                        <label>Current State</label>
                        <small>${escapeAdminHTML(readinessSummary(readiness))}</small>
                    </div>
                    <span class="payment-config-status ${escapeAdminHTML(status.className)}">${escapeAdminHTML(status.label)}</span>
                </div>
                </section>

                <section class="payment-config-section">
                    <h5>Customer Display</h5>

                <div class="settings-row">
                    <div>
                        <label>Payment Card Logo URL</label>
                        <small>Dedicated card logo. Do not use the payment QR as the logo.</small>
                    </div>
                    <input class="pm-logo-url" type="text" value="${escapeAdminHTML(method.logoUrl || "")}">
                </div>

                <div class="settings-row">
                    <div>
                        <label>Upload Payment Card Logo</label>
                        <small>Replaces the storefront card logo only</small>
                    </div>
                    <input class="pm-logo-file" type="file" accept="image/*">
                </div>

                <div class="payment-inline-actions">
                    <button class="admin-small-btn upload-logo-btn" type="button" data-action="upload-payment-logo" data-id="${escapeAdminHTML(method._id)}">
                        Upload Logo
                    </button>
                    <button class="admin-small-btn" type="button" data-action="remove-payment-logo">
                        Remove Logo
                    </button>
                </div>

                <div class="settings-row">
                    <div>
                        <label>Short Description</label>
                        <small>Brief customer-facing helper text</small>
                    </div>
                    <input class="pm-description" type="text" value="${escapeAdminHTML(method.shortDescription || "")}" placeholder="Pay using the K PLUS mobile app">
                </div>

                <div class="settings-row">
                    <div>
                        <label>Badge Text</label>
                        <small>Compact payment-card badge</small>
                    </div>
                    <input class="pm-badge" type="text" value="${escapeAdminHTML(method.badgeText || "")}" placeholder="Bank App">
                </div>

                <div class="settings-row">
                    <div>
                        <label>Sort Order</label>
                        <small>Lower numbers appear first</small>
                    </div>
                    <input class="pm-sort-order" type="number" step="1" value="${escapeAdminHTML(method.sortOrder || 0)}">
                </div>

                <div class="admin-payment-card-preview">
                    <img src="${escapeAdminHTML(logoUrl)}" alt="" onerror="this.src='/assets/payment/payment-neutral.svg'">
                    <div>
                        <strong>${escapeAdminHTML(displayName)}</strong>
                        <small>${escapeAdminHTML(method.badgeText || getPaymentTypeLabel(type))}</small>
                        <span>${escapeAdminHTML(method.shortDescription || getPaymentTypeDescription(method.key, type, provider))}</span>
                    </div>
                </div>
                </section>

                <section class="payment-config-section payment-account-section">
                    <h5>Receiving Account</h5>

                <div class="settings-row">
                    <div>
                        <label>Account Name</label>
                        <small>Receiver name shown to users</small>
                    </div>
                    <input class="pm-name" type="text" value="${escapeAdminHTML(method.accountName || "")}">
                </div>

                <div class="settings-row">
                    <div>
                        <label>Account Number</label>
                        <small>Bank / phone / recipient ID users can copy</small>
                    </div>
                    <input class="pm-number" type="text" value="${escapeAdminHTML(method.accountNumber || "")}">
                </div>

                <div class="settings-row">
                    <div>
                        <label>Recipient Label</label>
                        <small>Optional label shown before the recipient value</small>
                    </div>
                    <input class="pm-recipient-label" type="text" value="${escapeAdminHTML(method.recipientLabel || "")}" placeholder="Account number">
                </div>

                <div class="settings-row">
                    <div>
                        <label>Payment Reference Instructions</label>
                        <small>Optional note for manual transfers</small>
                    </div>
                    <textarea class="pm-reference-instructions">${escapeAdminHTML(method.referenceInstructions || "")}</textarea>
                </div>

                <p class="payment-section-help">Copy preview: ${escapeAdminHTML(method.accountName || "Account name")} · ${escapeAdminHTML(method.accountNumber || "Recipient ID")}</p>
                </section>

                <section class="payment-config-section payment-qr-section">
                    <h5>QR Payment</h5>

                <div class="settings-row">
                    <div>
                        <label>QR Mode</label>
                        <small>Controls whether QR is generated by provider or uploaded by Admin</small>
                    </div>
	                    <select class="pm-qr-mode">
	                        <option value="provider_generated" ${method.qrMode === "provider_generated" ? "selected" : ""}>Provider Generated Dynamic QR</option>
	                        <option value="aziel_promptpay_dynamic" ${method.qrMode === "aziel_promptpay_dynamic" ? "selected" : ""}>AZIEL Generated PromptPay QR</option>
	                        <option value="uploaded_static" ${method.qrMode === "uploaded_static" || !method.qrMode ? "selected" : ""}>Uploaded Static QR</option>
	                        <option value="none" ${method.qrMode === "none" ? "selected" : ""}>No QR</option>
	                    </select>
	                </div>

	                <div class="settings-row pm-promptpay-dynamic-field">
	                    <div>
	                        <label>PromptPay Recipient Type</label>
	                        <small>Used only for AZIEL-generated PromptPay QR</small>
	                    </div>
	                    <select class="pm-promptpay-recipient-type">
	                        <option value="" ${!method.promptPayRecipientType ? "selected" : ""}>Select recipient type</option>
	                        <option value="PHONE" ${method.promptPayRecipientType === "PHONE" ? "selected" : ""}>Phone</option>
	                        <option value="NATIONAL_ID" ${method.promptPayRecipientType === "NATIONAL_ID" ? "selected" : ""}>National ID</option>
	                        <option value="TAX_ID" ${method.promptPayRecipientType === "TAX_ID" ? "selected" : ""}>Tax ID</option>
	                    </select>
	                </div>

	                <div class="settings-row pm-promptpay-dynamic-field">
	                    <div>
	                        <label>PromptPay Recipient Value</label>
	                        <small>Stored server-side and masked in public responses</small>
	                    </div>
	                    <input class="pm-promptpay-recipient-value" type="text" value="${escapeAdminHTML(method.promptPayRecipientValue || "")}" placeholder="Phone or 13-digit ID">
	                </div>

	                <div class="settings-row pm-promptpay-dynamic-field">
	                    <div>
	                        <label>QR Expiry Minutes</label>
	                        <small>Checkout guidance only; does not confirm payment</small>
	                    </div>
	                    <input class="pm-dynamic-qr-expiry" type="number" min="1" max="1440" step="1" value="${escapeAdminHTML(method.dynamicQrExpiryMinutes || 15)}">
	                </div>

	                <div class="settings-row">
                    <div>
                        <label>QR Image URL</label>
                        <small>Manual QR fallback. PromptPay auto uses provider QR.</small>
                    </div>
                    <input class="pm-qr" type="text" value="${escapeAdminHTML(method.qrImageUrl || "")}">
                </div>

                <div class="settings-row">
                    <div>
                        <label>Upload QR Image</label>
                        <small>For KBZPay, WavePay, AYA Pay, manual PromptPay, etc.</small>
                    </div>
                    <input class="pm-file" type="file" accept="image/*">
                </div>

                <button class="admin-small-btn upload-qr-btn" type="button" data-action="upload-payment-qr" data-id="${escapeAdminHTML(method._id)}">
                    Upload QR Photo
                </button>

                <input class="pm-uploaded-qr" type="hidden" value="${escapeAdminHTML(method.uploadedQrImage || "")}">
                <input class="pm-uploaded-qr-evidence" type="hidden" value="${escapeAdminHTML(JSON.stringify(method.uploadedQrImageEvidence || null))}">

                ${qrUrl && !isAdminUploadedImageFailed(qrUrl) ? `
                    <div class="payment-qr-preview">
                        <img src="${escapeAdminHTML(qrUrl)}" data-src="${escapeAdminHTML(qrUrl)}" alt="QR Preview" onerror="handleAdminPaymentImageError(this)">
                    </div>
                ` : qrUrl ? adminMissingImageHTML("QR image unavailable", "div") : `
                    <div class="pm-empty-preview">No QR preview</div>
                `}

                <p class="payment-section-help">${escapeAdminHTML(getQrCustomerExperience(method))}</p>
                </section>

                <section class="payment-config-section">
                    <h5>Availability</h5>

                <div class="settings-row">
                    <div>
                        <label>Maintenance Message</label>
                        <small>Show warning or delay note to users</small>
                    </div>
                    <textarea class="pm-message">${escapeAdminHTML(method.maintenanceMessage || "")}</textarea>
                </div>

                <div class="settings-row">
                    <div>
                        <label>Availability Schedule</label>
                        <small>Optional operator note, for example business hours</small>
                    </div>
                    <input class="pm-availability-schedule" type="text" value="${escapeAdminHTML(method.availabilitySchedule || "")}">
                </div>
                </section>

                <div class="payment-capability-details">
                    <h5>Bank App</h5>

	                    <div class="settings-row">
	                        <div>
	                            <label>App Display Name</label>
	                            <small>Used for Open App button labels</small>
	                        </div>
	                        <input class="pm-app-name" type="text" value="${escapeAdminHTML(method.appDisplayName || "")}" placeholder="SCB EASY">
	                    </div>

	                    <div class="settings-row">
	                        <div>
	                            <label>Open App Mode</label>
	                            <small>Direct opens this method's app; bank chooser lets PromptPay users choose an app</small>
	                        </div>
	                        <select class="pm-open-app-mode">
	                            <option value="direct" ${method.openAppMode === "direct" ? "selected" : ""}>Direct</option>
	                            <option value="bank_chooser" ${method.openAppMode === "bank_chooser" ? "selected" : ""}>Bank Chooser</option>
	                            <option value="disabled" ${method.openAppMode === "disabled" || !method.openAppMode ? "selected" : ""}>Disabled</option>
	                        </select>
	                    </div>

	                    <div class="settings-row">
	                        <div>
	                            <label>App Launch Mode</label>
	                            <small>APP_ONLY opens the bank app for gallery scan guidance</small>
	                        </div>
	                        <select class="pm-app-launch-mode">
	                            <option value="APP_ONLY" ${method.appLaunchMode === "APP_ONLY" ? "selected" : ""}>App Only</option>
	                            <option value="OFFICIAL_PAYMENT_DEEPLINK" ${method.appLaunchMode !== "APP_ONLY" ? "selected" : ""}>Official Payment Deeplink</option>
	                        </select>
	                    </div>

	                    <div class="settings-row pm-official-deeplink-field">
	                        <div>
	                            <label>Official Payment Deeplink URL</label>
	                            <small>Only required for official payment deeplink mode</small>
	                        </div>
	                        <input class="pm-deeplink" type="text" value="${escapeAdminHTML(method.deepLinkUrl || "")}">
	                    </div>

	                    <div class="settings-row pm-app-launch-field">
	                        <div>
	                            <label>iOS App Launch URL</label>
	                            <small>Configured bank app launcher URL; no amount prefill is claimed</small>
	                        </div>
	                        <input class="pm-ios-app-launch" type="text" value="${escapeAdminHTML(method.iosAppLaunchUrl || "")}">
	                    </div>

	                    <div class="settings-row pm-app-launch-field">
	                        <div>
	                            <label>Android App Launch URL</label>
	                            <small>Configured bank app launcher URL; no amount prefill is claimed</small>
	                        </div>
	                        <input class="pm-android-app-launch" type="text" value="${escapeAdminHTML(method.androidAppLaunchUrl || "")}">
	                    </div>

                    <div class="settings-row">
                        <div>
	                            <label>App Store Fallback</label>
	                            <small>Optional HTTPS fallback</small>
	                        </div>
	                        <input class="pm-app-store" type="text" value="${escapeAdminHTML(method.appStoreFallbackUrl || method.appStoreUrl || "")}">
                    </div>

                    <div class="settings-row">
                        <div>
	                            <label>Play Store Fallback</label>
	                            <small>Optional HTTPS fallback</small>
	                        </div>
	                        <input class="pm-play-store" type="text" value="${escapeAdminHTML(method.playStoreFallbackUrl || method.playStoreUrl || "")}">
                    </div>
                </div>

                <div class="payment-capability-details">
                    <h5>Customer Actions</h5>

                    <div class="settings-row capability-grid">
                        ${capabilityToggle("pm-enable-save-qr", "Enable Save QR", method.enableSaveQr)}
                        ${capabilityToggle("pm-enable-open-app", "Enable Open App", method.enableOpenApp)}
                        ${capabilityToggle("pm-enable-checklist", "Enable Checklist", method.enableChecklist)}
                        ${capabilityToggle("pm-dynamic-qr", "Dynamic QR Supported", method.dynamicQrSupported)}
                        ${capabilityToggle("pm-amount-prefill", "Amount Prefill Supported", method.amountPrefillSupported)}
                        ${capabilityToggle("pm-reference", "Reference Supported", method.referenceSupported)}
                        ${capabilityToggle("pm-gallery-scan", "Gallery Scan Supported", method.galleryScanSupported)}
                        ${capabilityToggle("pm-slip-required", "Slip Required", method.slipRequired !== false)}
                    </div>
                </div>

                <div class="payment-capability-details">
                    <h5>Verification</h5>

                    <div class="settings-row capability-grid">
                        ${capabilityToggle("pm-receipt-upload", "Receipt Upload Enabled", method.receiptUploadEnabled !== false)}
                        ${capabilityToggle("pm-auto-verification", "Auto Verification Supported", method.autoVerificationSupported)}
                        ${capabilityToggle("pm-webhook", "Webhook Supported", method.webhookSupported)}
                    </div>

                    <div class="settings-row">
                        <div>
                            <label>Confirmation Mode</label>
                            <small>Payment truth source used by the system</small>
                        </div>
                        <select class="pm-confirmation-mode">
                            <option value="manual_admin" ${method.confirmationMode === "manual_admin" || !method.confirmationMode ? "selected" : ""}>Manual Admin Verification</option>
                            <option value="provider_webhook" ${method.confirmationMode === "provider_webhook" ? "selected" : ""}>Provider Webhook Confirmation</option>
                            <option value="automatic_provider" ${method.confirmationMode === "automatic_provider" ? "selected" : ""}>Automatic Provider Confirmation (Legacy)</option>
                            <option value="wallet_internal" ${method.confirmationMode === "wallet_internal" ? "selected" : ""}>AZIEL Wallet Internal Confirmation</option>
                        </select>
                    </div>
                </div>

                <div class="payment-capability-details">
                    <h5>Checklist</h5>
                    <small class="payment-section-help">Allowed actions: save_qr, open_app, upload_receipt, wait_for_confirmation, confirm_payment</small>
                    <div class="pm-checklist-presets">
                        <button type="button" class="admin-small-btn" data-action="manual-bank-preset">Use Manual Bank Preset</button>
                        <button type="button" class="admin-small-btn" data-action="promptpay-preset">Use PromptPay Auto Preset</button>
                        <button type="button" class="admin-small-btn" data-action="clear-checklist">Clear Steps</button>
                    </div>
                    ${checklistStepBuilder(method.checklistSteps || [])}
                    <div class="pm-checklist-preview">
                        <strong>Payment Progress</strong>
                        <ol>${renderChecklistPreview(method.checklistSteps || [], method)}</ol>
                    </div>
                </div>

                ${method.key === "promptpay" ? `
                    <div class="payment-method-hint">
                        <strong>PromptPay Auto</strong>
                        <span>Use auto payment type. QR is generated by the PromptPay provider flow.</span>
                    </div>
                ` : ""}

                ${method.key === "scb" ? `
                    <div class="payment-method-hint">
                        <strong>SCB Deeplink</strong>
                        <span>Use deeplink payment type for SCB. Add account name/number for copy flow.</span>
                    </div>
                ` : ""}

                <details class="payment-capability-details payment-system-info">
                    <summary>Advanced / System Information</summary>
                    <p>System key: <code>${escapeAdminHTML(method.key || "")}</code></p>
                    <p>Internal provider: <code>${escapeAdminHTML(provider || "")}</code></p>
                    <p>Provider adapter names such as OPN/Omise are implementation details and are not shown to customers.</p>
                </details>

                <div class="payment-editor-savebar">
                    <button class="save-payment-btn" type="button" data-action="save-payment-method" data-id="${escapeAdminHTML(method._id)}">
                        Save ${escapeAdminHTML(displayName)}
                    </button>
                </div>
                </details>
            </div>
        `;
    }).join("");

    bindAdminPaymentActions();
}

function formatPaymentName(value) {
    return window.AZIEL_PAYMENT_DISPLAY?.from?.(value, value || "Payment") || value || "Payment";
}

function normalizeAdminProvider(value = "") {
    const raw = String(value || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "")
        .replace(/-/g, "_")
        .replace(/[^a-z0-9_]/g, "");

    const aliases = {
        omise: "promptpay",
        opnpromptpay: "promptpay",
        prompt_pay: "promptpay",
        aya: "ayapay",
        aya_pay: "ayapay",
        kbz_pay: "kbzpay",
        wave_pay: "wavepay",
        bangkokbank: "bangkok_bank",
        bbl: "bangkok_bank",
        k_plus: "kplus",
        krungthai_next: "krungthai",
        krungthainext: "krungthai",
        ktb: "krungthai",
        azielwallet: "wallet",
        manual: "manual_bank"
    };

    return ADMIN_PAYMENT_PROVIDERS[raw] ? raw : aliases[raw] || raw;
}

function providerKeysFor(region = "MM", paymentType = "manual") {
    const regionKey = String(region || "MM").toUpperCase() === "TH" ? "TH" : "MM";
    const typeKey = ["auto", "deeplink", "wallet"].includes(String(paymentType || "").toLowerCase())
        ? String(paymentType).toLowerCase()
        : "manual";
    return ADMIN_PROVIDER_BY_REGION_TYPE[regionKey]?.[typeKey] || [];
}

function providerOptionsHTML(region, paymentType, selectedProvider) {
    const selected = normalizeAdminProvider(selectedProvider);
    const keys = providerKeysFor(region, paymentType);
    return keys.map(key => {
        const provider = ADMIN_PAYMENT_PROVIDERS[key];
        return `<option value="${provider.key}" ${selected === provider.key ? "selected" : ""}>${provider.label}</option>`;
    }).join("");
}

function getAdminPaymentReadiness(method = {}) {
    if (Array.isArray(method.missingConfiguration)) {
        return { ready: method.publicReady === true, missing: method.missingConfiguration };
    }

    const missing = [];
    const type = String(method.paymentType || "manual").toLowerCase();
    const provider = normalizeAdminProvider(method.provider || method.key || "");
    if (!method.method && !ADMIN_PAYMENT_PROVIDERS[provider]?.label) missing.push("display name");
    if (!providerKeysFor(method.region, type).includes(provider)) missing.push("valid provider");
    if (type !== "wallet" && type !== "auto") {
        if (method.qrMode !== "aziel_promptpay_dynamic") {
            if (!String(method.accountName || "").trim()) missing.push("account name");
            if (!String(method.accountNumber || "").trim()) missing.push("account number");
        }
        if (!(method.qrImage || method.qrImageUrl || method.uploadedQrImage || method.qrMode === "aziel_promptpay_dynamic")) missing.push("QR image");
        if (method.qrMode === "aziel_promptpay_dynamic") {
            if (!method.dynamicQrSupported) missing.push("dynamic QR supported");
            if (!method.amountPrefillSupported) missing.push("amount prefill supported");
            if (!method.promptPayRecipientType || !method.promptPayRecipientValue) missing.push("PromptPay recipient");
        }
    }
    if (method.enableOpenApp === true && method.openAppMode !== "disabled") {
        if (!String(method.appDisplayName || "").trim()) missing.push("app display name");
        if (method.openAppMode === "bank_chooser") {
            // The chooser can still provide a safe instruction fallback when no direct app profile is configured.
        } else if (method.appLaunchMode === "APP_ONLY") {
            if (!String(method.iosAppLaunchUrl || method.androidAppLaunchUrl || "").trim()) missing.push("app launch URL");
        } else if (!String(method.deepLinkUrl || "").trim()) {
            missing.push("deep link URL");
        }
    }
    return { ready: missing.length === 0, missing };
}

function getAdminPaymentStatus(method = {}, readiness = { ready: false }) {
    if (!readiness.ready) return { label: "Draft", className: "is-draft" };
    if (method.enabled) return { label: "Enabled", className: "is-enabled" };
    return { label: "Ready", className: "is-ready" };
}

function capabilityToggle(className, label, checked) {
    return `
        <label class="payment-capability-toggle">
            <input class="${className}" type="checkbox" ${checked ? "checked" : ""}>
            <span>${escapeAdminHTML(label)}</span>
        </label>
    `;
}

function getAdminPaymentLogo(method = {}) {
    const key = normalizeAdminProvider(method.provider || method.key || "");
    if (method.logoUrl) return method.logoUrl;
    const logos = {
        promptpay: "/assets/payment/promptpay.png",
        scb: "/assets/payment/scb.png",
        bangkok_bank: "/assets/payment/bank-neutral.svg",
        kplus: "/assets/payment/bank-neutral.svg",
        krungsri: "/assets/payment/bank-neutral.svg",
        kbzpay: "/assets/payment/kbzpay.png",
        wavepay: "/assets/payment/wavepay.png",
        ayapay: "/assets/payment/ayapay.png",
        mmqr: "/assets/payment/payment-neutral.svg",
        manual_bank: "/assets/payment/bank-neutral.svg",
        wallet: "/assets/logo.png"
    };
    return logos[key] || "/assets/payment/payment-neutral.svg";
}

function getRegionLabel(region = "") {
    return String(region).toUpperCase() === "TH" ? "Thailand" : "Myanmar";
}

function getPaymentTypeLabel(type = "manual") {
    const labels = {
        auto: "Auto Payment",
        deeplink: "Bank App + Slip",
        manual: "Manual QR + Slip",
        wallet: "AZIEL Wallet"
    };
    return labels[String(type || "manual").toLowerCase()] || "Manual QR + Slip";
}

function readinessSummary(readiness = { ready: false, missing: [] }) {
    if (readiness.ready) return "Ready for storefront";
    if (!readiness.missing?.length) return "Needs review";
    return `${readiness.missing.length} item${readiness.missing.length === 1 ? "" : "s"} missing`;
}

function capabilityChip(label, ok) {
    return `<span class="payment-capability-chip ${ok ? "is-ok" : "is-missing"}">${escapeAdminHTML(label)} ${ok ? "✓" : "○"}</span>`;
}

function hasPaymentQr(method = {}) {
    if (method.qrMode === "provider_generated") return true;
    if (method.qrMode === "aziel_promptpay_dynamic") return true;
    return Boolean(method.qrImage || method.qrImageUrl || method.uploadedQrImage || method.finalQrImage);
}

function methodIdentityOptionsHTML(region = "MM", selected = "") {
    const groups = {
        TH: [
            ["promptpay", "PromptPay"],
            ["scb", "SCB"],
            ["bangkok_bank", "Bangkok Bank"],
            ["kplus", "K PLUS"],
            ["krungsri", "Krungsri"],
            ["wallet", "AZIEL Wallet"]
        ],
        MM: [
            ["kbzpay", "KBZPay"],
            ["wavepay", "WavePay"],
            ["ayapay", "AYA Pay"],
            ["mmqr", "MMQR"],
            ["manual_bank", "Manual Bank Transfer"],
            ["wallet", "AZIEL Wallet"]
        ]
    };
    const list = groups[String(region || "MM").toUpperCase() === "TH" ? "TH" : "MM"];
    return list.map(([value, label]) => `
        <option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>
    `).join("");
}

function getQrCustomerExperience(method = {}) {
    if (method.qrMode === "provider_generated") return "Customer experience: QR is generated by the payment provider and may include amount.";
    if (method.qrMode === "aziel_promptpay_dynamic") return "Customer experience: AZIEL generates an amount-specific PromptPay QR; receipt upload and admin verification remain required.";
    if (method.qrMode === "none") return "Customer experience: no QR is shown for this method.";
    if (method.amountPrefillSupported) return "Customer experience: QR may include receiver and amount when supported.";
    return "Customer experience: QR contains receiver only; user must enter the exact amount.";
}

function renderChecklistPreview(steps = [], method = {}) {
    const visible = (Array.isArray(steps) ? steps : []).filter(step => step.enabled !== false);
    if (!visible.length) return `<li><span>○</span> No checklist steps configured</li>`;
    return visible.map((step, index) => {
        const marker = index === 0 ? "●" : "○";
        const label = String(step.label || step.action || "").replace("Open Banking App", `Open ${method.appDisplayName || "Banking App"}`);
        return `<li><span>${marker}</span> ${escapeAdminHTML(label)}</li>`;
    }).join("");
}

function checklistActionOptions(selected = "") {
    return [
        ["save_qr", "Save QR"],
        ["open_app", "Open App"],
        ["upload_receipt", "Upload Receipt"],
        ["wait_for_confirmation", "Wait for Confirmation"],
        ["confirm_payment", "Confirm Payment"]
    ].map(([value, label]) => `
        <option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>
    `).join("");
}

function checklistStepBuilder(steps = []) {
    const normalized = Array.isArray(steps) && steps.length
        ? steps
        : [];

    return `
        <div class="pm-checklist-builder">
            <div class="pm-checklist-steps">
                ${normalized.map(checklistStepRow).join("")}
            </div>
            <button type="button" class="admin-small-btn pm-add-checklist-step">Add Step</button>
        </div>
    `;
}

function checklistStepRow(step = {}) {
    return `
        <div class="pm-checklist-step">
            <select class="pm-step-action">${checklistActionOptions(step.action || "upload_receipt")}</select>
            <input class="pm-step-label" type="text" value="${escapeAdminHTML(step.label || "")}" placeholder="Step label">
            <label class="payment-capability-toggle compact">
                <input class="pm-step-enabled" type="checkbox" ${step.enabled === false ? "" : "checked"}>
                <span>Enabled</span>
            </label>
            <input class="pm-step-order" type="number" step="1" value="${escapeAdminHTML(step.sortOrder || 0)}" aria-label="Sort order">
            <button type="button" class="pm-step-up" aria-label="Move step up">↑</button>
            <button type="button" class="pm-step-down" aria-label="Move step down">↓</button>
            <button type="button" class="pm-step-remove" aria-label="Remove step">Remove</button>
        </div>
    `;
}

function bindAdminPaymentActions() {
    document.querySelector('[data-action="add-payment-method"]')?.addEventListener("click", addAdminPaymentMethod);

    document.querySelectorAll('[data-action="save-payment-method"]').forEach(btn => {
        btn.addEventListener("click", () => saveAdminPaymentMethod(btn.dataset.id));
    });

    document.querySelectorAll('[data-action="edit-payment-method"]').forEach(btn => {
        btn.addEventListener("click", () => {
            const card = btn.closest(".payment-method-card");
            const editor = card?.querySelector(".payment-method-editor");
            if (editor) editor.open = true;
            editor?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
    });

    document.querySelectorAll('[data-action="preview-payment-method"]').forEach(btn => {
        btn.addEventListener("click", () => showAdminPaymentPreview(btn.closest(".payment-method-card")));
    });
    document.querySelectorAll(".pm-provider").forEach(select => {

        select.addEventListener("change", e => {

            autoPaymentConfig(
                e.target.closest(".payment-method-card")
            );

        });

    });

    document.querySelectorAll(".pm-region").forEach(select => {
        select.addEventListener("change", e => {
            refreshPaymentEditorVisibility(e.target.closest(".payment-method-card"));
        });
    });

    document.querySelectorAll(".pm-type").forEach(select => {

        select.addEventListener("change", e => {
            refreshPaymentEditorVisibility(e.target.closest(".payment-method-card"));

        });

    });

    document.querySelectorAll(".payment-method-card")
        .forEach(card => {

            refreshPaymentEditorVisibility(card);

        });

    document.querySelectorAll('[data-action="upload-payment-qr"]').forEach(btn => {
        btn.addEventListener("click", () => uploadAdminPaymentQR(btn.dataset.id));
    });

    document.querySelectorAll('[data-action="upload-payment-logo"]').forEach(btn => {
        btn.addEventListener("click", () => uploadAdminPaymentLogo(btn.dataset.id));
    });

    document.querySelectorAll('[data-action="remove-payment-logo"]').forEach(btn => {
        btn.addEventListener("click", () => {
            const card = btn.closest(".payment-method-card");
            const input = card?.querySelector(".pm-logo-url");
            if (input) input.value = "";
            updateInlineCardPreview(card);
        });
    });

    bindChecklistBuilderActions();
    bindChecklistPresetActions();
    bindPaymentPreviewInputs();
}

function bindChecklistBuilderActions() {
    document.querySelectorAll(".pm-add-checklist-step").forEach(btn => {
        btn.onclick = () => {
            const list = btn.closest(".pm-checklist-builder")?.querySelector(".pm-checklist-steps");
            if (!list) return;
            const count = list.querySelectorAll(".pm-checklist-step").length;
            list.insertAdjacentHTML("beforeend", checklistStepRow({
                action: "upload_receipt",
                label: "Upload receipt",
                enabled: true,
                sortOrder: (count + 1) * 10
            }));
            bindChecklistBuilderActions();
            updateChecklistPreview(btn.closest(".payment-method-card"));
        };
    });

    document.querySelectorAll(".pm-step-remove").forEach(btn => {
        btn.onclick = () => {
            const card = btn.closest(".payment-method-card");
            btn.closest(".pm-checklist-step")?.remove();
            updateChecklistPreview(card);
        };
    });

    document.querySelectorAll(".pm-step-up").forEach(btn => {
        btn.onclick = () => {
            const card = btn.closest(".payment-method-card");
            const row = btn.closest(".pm-checklist-step");
            row?.previousElementSibling?.before(row);
            renumberChecklistRows(row?.parentElement);
            updateChecklistPreview(card);
        };
    });

    document.querySelectorAll(".pm-step-down").forEach(btn => {
        btn.onclick = () => {
            const card = btn.closest(".payment-method-card");
            const row = btn.closest(".pm-checklist-step");
            row?.nextElementSibling?.after(row);
            renumberChecklistRows(row?.parentElement);
            updateChecklistPreview(card);
        };
    });

    document.querySelectorAll(".pm-step-action, .pm-step-label, .pm-step-enabled").forEach(input => {
        input.oninput = () => updateChecklistPreview(input.closest(".payment-method-card"));
        input.onchange = () => updateChecklistPreview(input.closest(".payment-method-card"));
    });
}

function bindChecklistPresetActions() {
    document.querySelectorAll('[data-action="manual-bank-preset"]').forEach(btn => {
        btn.onclick = () => applyChecklistPreset(btn.closest(".payment-method-card"), [
            { action: "save_qr", label: "Save QR" },
            { action: "open_app", label: "Open Bank App" },
            { action: "upload_receipt", label: "Upload Receipt" }
        ]);
    });

    document.querySelectorAll('[data-action="promptpay-preset"]').forEach(btn => {
        btn.onclick = () => applyChecklistPreset(btn.closest(".payment-method-card"), [
            { action: "save_qr", label: "Save QR" },
            { action: "open_app", label: "Open Banking App" },
            { action: "wait_for_confirmation", label: "Waiting for Payment Confirmation" }
        ]);
    });

    document.querySelectorAll('[data-action="clear-checklist"]').forEach(btn => {
        btn.onclick = () => applyChecklistPreset(btn.closest(".payment-method-card"), []);
    });
}

function applyChecklistPreset(card, steps = []) {
    const list = card?.querySelector(".pm-checklist-steps");
    if (!list) return;
    list.innerHTML = steps.map((step, index) => checklistStepRow({
        key: step.action,
        action: step.action,
        label: step.label,
        enabled: true,
        sortOrder: (index + 1) * 10
    })).join("");
    bindChecklistBuilderActions();
    updateChecklistPreview(card);
}

function updateChecklistPreview(card) {
    const preview = card?.querySelector(".pm-checklist-preview ol");
    if (!preview) return;
    preview.innerHTML = renderChecklistPreview(collectChecklistSteps(card), collectAdminPaymentFormState(card));
}

function bindPaymentPreviewInputs() {
    document.querySelectorAll(".payment-method-card input, .payment-method-card select, .payment-method-card textarea").forEach(input => {
        input.addEventListener("input", () => {
            const card = input.closest(".payment-method-card");
            refreshPaymentEditorVisibility(card);
            updateInlineCardPreview(card);
            updateChecklistPreview(card);
        });
        input.addEventListener("change", () => {
            const card = input.closest(".payment-method-card");
            refreshPaymentEditorVisibility(card);
            updateInlineCardPreview(card);
            updateChecklistPreview(card);
        });
    });
}

function renumberChecklistRows(list) {
    list?.querySelectorAll(".pm-checklist-step").forEach((row, index) => {
        const input = row.querySelector(".pm-step-order");
        if (input) input.value = String((index + 1) * 10);
    });
}

async function saveAdminPaymentMethod(id) {
    const card = document.querySelector(`.payment-method-card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;

    const payload = {
        method: card.querySelector(".pm-method")?.value || "",
        region: card.querySelector(".pm-region")?.value || "MM",
        enabled: card.querySelector(".pm-enabled")?.checked || false,
        accountName: card.querySelector(".pm-name")?.value || "",
        accountNumber: card.querySelector(".pm-number")?.value || "",
        logoUrl: card.querySelector(".pm-logo-url")?.value || "",
        shortDescription: card.querySelector(".pm-description")?.value || "",
        badgeText: card.querySelector(".pm-badge")?.value || "",
        recipientLabel: card.querySelector(".pm-recipient-label")?.value || "",
        referenceInstructions: card.querySelector(".pm-reference-instructions")?.value || "",
        qrMode: card.querySelector(".pm-qr-mode")?.value || "uploaded_static",
        qrImageUrl: card.querySelector(".pm-qr")?.value || "",
        uploadedQrImage: card.querySelector(".pm-uploaded-qr")?.value || "",
        uploadedQrImageEvidence: parseAdminPaymentEvidence(card.querySelector(".pm-uploaded-qr-evidence")?.value),
        maintenanceMessage: card.querySelector(".pm-message")?.value || "",
        availabilitySchedule: card.querySelector(".pm-availability-schedule")?.value || "",
        paymentType: card.querySelector(".pm-type")?.value || "manual",
        provider: normalizeAdminProvider(card.querySelector(".pm-provider")?.value || ""),
	        appDisplayName: card.querySelector(".pm-app-name")?.value || "",
	        openAppMode: card.querySelector(".pm-open-app-mode")?.value || "disabled",
	        deepLinkUrl: card.querySelector(".pm-deeplink")?.value || "",
	        appLaunchMode: card.querySelector(".pm-app-launch-mode")?.value || "OFFICIAL_PAYMENT_DEEPLINK",
	        iosAppLaunchUrl: card.querySelector(".pm-ios-app-launch")?.value || "",
	        androidAppLaunchUrl: card.querySelector(".pm-android-app-launch")?.value || "",
	        appStoreUrl: card.querySelector(".pm-app-store")?.value || "",
	        playStoreUrl: card.querySelector(".pm-play-store")?.value || "",
	        appStoreFallbackUrl: card.querySelector(".pm-app-store")?.value || "",
	        playStoreFallbackUrl: card.querySelector(".pm-play-store")?.value || "",
	        promptPayRecipientType: card.querySelector(".pm-promptpay-recipient-type")?.value || "",
	        promptPayRecipientValue: card.querySelector(".pm-promptpay-recipient-value")?.value || "",
	        dynamicQrExpiryMinutes: Number(card.querySelector(".pm-dynamic-qr-expiry")?.value || 15),
        enableSaveQr: card.querySelector(".pm-enable-save-qr")?.checked || false,
        enableOpenApp: card.querySelector(".pm-enable-open-app")?.checked || false,
        enableChecklist: card.querySelector(".pm-enable-checklist")?.checked || false,
        dynamicQrSupported: card.querySelector(".pm-dynamic-qr")?.checked || false,
        amountPrefillSupported: card.querySelector(".pm-amount-prefill")?.checked || false,
        referenceSupported: card.querySelector(".pm-reference")?.checked || false,
        galleryScanSupported: card.querySelector(".pm-gallery-scan")?.checked || false,
        slipRequired: card.querySelector(".pm-slip-required")?.checked || false,
        receiptUploadEnabled: card.querySelector(".pm-receipt-upload")?.checked || false,
        autoVerificationSupported: card.querySelector(".pm-auto-verification")?.checked || false,
        webhookSupported: card.querySelector(".pm-webhook")?.checked || false,
        confirmationMode: card.querySelector(".pm-confirmation-mode")?.value || "manual_admin",
        checklistSteps: collectChecklistSteps(card),
        sortOrder: Number(card.querySelector(".pm-sort-order")?.value || 0)
    };

    if (card.dataset.key === "promptpay" && payload.provider === "promptpay" && payload.region === "TH" && payload.qrMode !== "aziel_promptpay_dynamic") {
        payload.paymentType = "auto";
    }

    if (["scb", "bangkok_bank", "kplus", "krungsri", "krungthai"].includes(payload.provider) && payload.region === "TH" && payload.paymentType !== "manual") {
        payload.paymentType = "deeplink";
    }

    if (payload.provider === "wallet") {
        payload.paymentType = "wallet";
    }

    try {
        const data = await adminFetch(`/api/admin/payment-methods/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!data || !data.success) {
            showAdminToast?.(data?.message || "Save failed", "error");
            return;
        }

        showAdminToast?.("Payment method saved", "success");
        await loadAdminPaymentMethods();

    } catch (error) {
        console.log("Save payment method error:", error);
        showAdminToast?.("Server error", "error");
    }
}

function collectAdminPaymentFormState(card) {
    const key = card?.dataset.key || "";
    const method = card?.querySelector(".pm-method")?.value || "";
    const paymentType = card?.querySelector(".pm-type")?.value || "manual";
    return {
        key,
        method,
        region: card?.querySelector(".pm-region")?.value || "MM",
        paymentType,
        provider: normalizeAdminProvider(key),
        logoUrl: card?.querySelector(".pm-logo-url")?.value || "",
        shortDescription: card?.querySelector(".pm-description")?.value || "",
        badgeText: card?.querySelector(".pm-badge")?.value || "",
        accountName: card?.querySelector(".pm-name")?.value || "",
        accountNumber: card?.querySelector(".pm-number")?.value || "",
        recipientLabel: card?.querySelector(".pm-recipient-label")?.value || "",
        referenceInstructions: card?.querySelector(".pm-reference-instructions")?.value || "",
        qrMode: card?.querySelector(".pm-qr-mode")?.value || "uploaded_static",
        qrImageUrl: card?.querySelector(".pm-qr")?.value || "",
        uploadedQrImage: card?.querySelector(".pm-uploaded-qr")?.value || "",
	        appDisplayName: card?.querySelector(".pm-app-name")?.value || "",
	        openAppMode: card?.querySelector(".pm-open-app-mode")?.value || "disabled",
	        deepLinkUrl: card?.querySelector(".pm-deeplink")?.value || "",
	        appLaunchMode: card?.querySelector(".pm-app-launch-mode")?.value || "OFFICIAL_PAYMENT_DEEPLINK",
	        iosAppLaunchUrl: card?.querySelector(".pm-ios-app-launch")?.value || "",
	        androidAppLaunchUrl: card?.querySelector(".pm-android-app-launch")?.value || "",
	        appStoreFallbackUrl: card?.querySelector(".pm-app-store")?.value || "",
	        playStoreFallbackUrl: card?.querySelector(".pm-play-store")?.value || "",
	        promptPayRecipientType: card?.querySelector(".pm-promptpay-recipient-type")?.value || "",
	        promptPayRecipientValue: card?.querySelector(".pm-promptpay-recipient-value")?.value || "",
	        dynamicQrExpiryMinutes: Number(card?.querySelector(".pm-dynamic-qr-expiry")?.value || 15),
	        enableSaveQr: card?.querySelector(".pm-enable-save-qr")?.checked || false,
        enableOpenApp: card?.querySelector(".pm-enable-open-app")?.checked || false,
        enableChecklist: card?.querySelector(".pm-enable-checklist")?.checked || false,
        slipRequired: card?.querySelector(".pm-slip-required")?.checked || false,
        receiptUploadEnabled: card?.querySelector(".pm-receipt-upload")?.checked || false,
        confirmationMode: card?.querySelector(".pm-confirmation-mode")?.value || "manual_admin",
        checklistSteps: collectChecklistSteps(card)
    };
}

async function addAdminPaymentMethod() {
    const regionInput = window.prompt("Step 1: Choose region (TH or MM)", "TH") || "TH";
    const region = regionInput.trim().toUpperCase() === "MM" ? "MM" : "TH";
    const methods = getMethodChoices(region);
    const methodList = methods.map((item, index) => `${index + 1}. ${item.label}`).join("\n");
    const methodChoice = window.prompt(`Step 2: Choose payment method\n${methodList}`, "1");
    const selected = methods[Number(methodChoice) - 1] || methods.find(item => item.key === normalizeAdminProvider(methodChoice));
    if (!selected) return;

    const existing = adminPaymentMethods.find(method =>
        String(method.region || "").toUpperCase() === region &&
        String(method.key || "").toLowerCase() === selected.key
    );
    if (existing) {
        showAdminToast?.(`${selected.label} already exists for ${getRegionLabel(region)}. Opening existing configuration.`, "error");
        const card = document.querySelector(`.payment-method-card[data-id="${CSS.escape(existing._id)}"]`);
        const editor = card?.querySelector(".payment-method-editor");
        if (editor) editor.open = true;
        card?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
    }

    let paymentType = selected.paymentType;
    if (!paymentType) {
        const typeInput = window.prompt("Step 3: Payment type (manual, deeplink, auto, wallet)", "manual") || "manual";
        paymentType = ["manual", "deeplink", "auto", "wallet"].includes(typeInput.trim().toLowerCase())
            ? typeInput.trim().toLowerCase()
            : "manual";
    }

    const method = selected.label;
    const key = selected.key;
    if (!key) return;

    try {
        const data = await adminFetch("/api/admin/payment-methods", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                method,
                key,
                region,
                enabled: false,
                paymentType,
                slipRequired: ["manual", "deeplink"].includes(paymentType),
                receiptUploadEnabled: ["manual", "deeplink"].includes(paymentType),
                qrMode: paymentType === "auto" ? "provider_generated" : paymentType === "wallet" ? "none" : "uploaded_static",
            confirmationMode: paymentType === "auto" ? "provider_webhook" : paymentType === "wallet" ? "wallet_internal" : "manual_admin"
            })
        });

        if (!data || !data.success) {
            showAdminToast?.(data?.message || "Create failed", "error");
            return;
        }

        showAdminToast?.("Payment method created", "success");
        await loadAdminPaymentMethods();
    } catch (error) {
        console.log("Create payment method error:", error);
        showAdminToast?.("Server error", "error");
    }
}

function getMethodChoices(region) {
    const choices = {
        TH: [
            { key: "promptpay", label: "PromptPay", paymentType: "auto" },
            { key: "scb", label: "SCB", paymentType: "deeplink" },
            { key: "bangkok_bank", label: "Bangkok Bank", paymentType: "deeplink" },
            { key: "kplus", label: "K PLUS", paymentType: "deeplink" },
            { key: "krungsri", label: "Krungsri", paymentType: "deeplink" },
            { key: "wallet", label: "AZIEL Wallet", paymentType: "wallet" }
        ],
        MM: [
            { key: "kbzpay", label: "KBZPay", paymentType: "manual" },
            { key: "wavepay", label: "WavePay", paymentType: "manual" },
            { key: "ayapay", label: "AYA Pay", paymentType: "manual" },
            { key: "mmqr", label: "MMQR", paymentType: "manual" },
            { key: "manual_bank", label: "Manual Bank Transfer", paymentType: "manual" },
            { key: "wallet", label: "AZIEL Wallet", paymentType: "wallet" }
        ]
    };
    return choices[String(region).toUpperCase() === "TH" ? "TH" : "MM"];
}

async function uploadAdminPaymentQR(id) {
    const card = document.querySelector(`.payment-method-card[data-id="${CSS.escape(id)}"]`);
    const file = card?.querySelector(".pm-file")?.files?.[0];

    if (!file) {
        showAdminToast?.("Choose QR image first", "error");
        return;
    }

    const formData = new FormData();
    formData.append("qr", file);

    try {
        const data = await adminFetch("/api/admin/upload-payment-qr", {
            method: "POST",
            body: formData
        });

        if (!data || !data.success) {
            showAdminToast?.(data?.message || "QR upload failed", "error");
            return;
        }

        const input = card.querySelector(".pm-uploaded-qr");
        if (input) input.value = data.image;

        const evidenceInput = card.querySelector(".pm-uploaded-qr-evidence");
        if (evidenceInput) evidenceInput.value = JSON.stringify(data.evidence || null);

        showAdminToast?.("QR uploaded. Saving method...", "success");

        await saveAdminPaymentMethod(id);

    } catch (error) {
        console.log("Upload QR error:", error);
        showAdminToast?.("Upload failed", "error");
    }
}

async function uploadAdminPaymentLogo(id) {
    const card = document.querySelector(`.payment-method-card[data-id="${CSS.escape(id)}"]`);
    const file = card?.querySelector(".pm-logo-file")?.files?.[0];

    if (!file) {
        showAdminToast?.("Choose logo image first", "error");
        return;
    }

    const formData = new FormData();
    formData.append("logo", file);

    try {
        const data = await adminFetch("/api/admin/upload-payment-logo", {
            method: "POST",
            body: formData
        });

        if (!data || !data.success) {
            showAdminToast?.(data?.message || "Logo upload failed", "error");
            return;
        }

        const input = card.querySelector(".pm-logo-url");
        if (input) input.value = data.image;
        updateInlineCardPreview(card);

        showAdminToast?.("Logo uploaded. Save the method to publish it.", "success");

    } catch (error) {
        console.log("Upload logo error:", error);
        showAdminToast?.("Logo upload failed", "error");
    }
}

function getPaymentTypeDescription(key, type, provider) {
    if (key === "promptpay" || normalizeAdminProvider(provider) === "promptpay") {
        return "PromptPay auto payment via provider webhook.";
    }

    if (type === "deeplink") {
        return "Bank app open + account copy + slip upload.";
    }

    if (type === "wallet") {
        return "Internal AZIEL Wallet payment.";
    }

    return "Manual QR / account transfer with slip upload.";
}

function refreshPaymentEditorVisibility(card) {
    if (!card) return;
    const state = collectAdminPaymentFormState(card);
    const isPromptPay = (state.key === "promptpay" || state.paymentType === "auto") && state.qrMode !== "aziel_promptpay_dynamic";
    const isWallet = state.key === "wallet" || state.paymentType === "wallet";
    const qrMode = card.querySelector(".pm-qr-mode");

    if (isPromptPay) {
        card.querySelector(".pm-type").value = "auto";
        if (qrMode) qrMode.value = "provider_generated";
    }

    if (isWallet) {
        card.querySelector(".pm-type").value = "wallet";
        if (qrMode) qrMode.value = "none";
    }

    const accountSection = card.querySelector(".payment-account-section");
    const qrSection = card.querySelector(".payment-qr-section");
    const staticQrRows = [
        card.querySelector(".pm-qr")?.closest(".settings-row"),
        card.querySelector(".pm-file")?.closest(".settings-row"),
        card.querySelector(".upload-qr-btn"),
        card.querySelector(".payment-qr-preview"),
        card.querySelector(".pm-empty-preview")
    ].filter(Boolean);

    if (accountSection) accountSection.hidden = isPromptPay || isWallet;
    if (qrSection) qrSection.hidden = isWallet;

    const activeQrMode = card.querySelector(".pm-qr-mode")?.value || "uploaded_static";
    staticQrRows.forEach(el => {
        el.style.display = activeQrMode === "uploaded_static" ? "" : "none";
    });
    card.querySelectorAll(".pm-promptpay-dynamic-field").forEach(el => {
        el.hidden = activeQrMode !== "aziel_promptpay_dynamic";
    });

    const enableOpenApp = card.querySelector(".pm-enable-open-app")?.checked === true;
    const openAppMode = card.querySelector(".pm-open-app-mode")?.value || "disabled";
    const appLaunchMode = card.querySelector(".pm-app-launch-mode")?.value || "OFFICIAL_PAYMENT_DEEPLINK";
    card.querySelectorAll(".pm-app-launch-field").forEach(el => {
        el.hidden = !enableOpenApp || openAppMode !== "direct" || appLaunchMode !== "APP_ONLY";
    });
    card.querySelectorAll(".pm-official-deeplink-field").forEach(el => {
        el.hidden = !enableOpenApp || openAppMode !== "direct" || appLaunchMode === "APP_ONLY";
    });

    const appName = card.querySelector(".pm-app-name")?.value || "Banking App";
    const openWarning = card.querySelector(".pm-open-app-warning");
    if (openWarning) {
        const canOpen = openAppMode === "disabled" ||
            openAppMode === "bank_chooser" ||
            (appLaunchMode === "APP_ONLY"
                ? Boolean(card.querySelector(".pm-ios-app-launch")?.value || card.querySelector(".pm-android-app-launch")?.value)
                : Boolean(card.querySelector(".pm-deeplink")?.value && appName));
        openWarning.hidden = !card.querySelector(".pm-enable-open-app")?.checked || canOpen;
    }
}

function updateInlineCardPreview(card) {
    if (!card) return;
    const state = collectAdminPaymentFormState(card);
    const preview = card.querySelector(".admin-payment-card-preview");
    if (!preview) return;
    const logo = state.logoUrl || getAdminPaymentLogo(state);
    preview.querySelector("img").src = logo;
    preview.querySelector("strong").textContent = state.method || formatPaymentName(state.key);
    preview.querySelector("small").textContent = state.badgeText || getPaymentTypeLabel(state.paymentType);
    preview.querySelector("span").textContent = state.shortDescription || getPaymentTypeDescription(state.key, state.paymentType, state.provider);
}

function showAdminPaymentPreview(card) {
    if (!card) return;
    const state = collectAdminPaymentFormState(card);
    const logo = state.logoUrl || getAdminPaymentLogo(state);
    const steps = state.checklistSteps.filter(step => step.enabled !== false);
    const modal = getAdminPaymentPreviewModal();
    modal.querySelector(".admin-payment-preview-card img").src = logo;
    modal.querySelector(".admin-payment-preview-card strong").textContent = state.method || formatPaymentName(state.key);
    modal.querySelector(".admin-payment-preview-card small").textContent = state.badgeText || getPaymentTypeLabel(state.paymentType);
    modal.querySelector(".admin-payment-preview-card span").textContent = state.shortDescription || getPaymentTypeDescription(state.key, state.paymentType, state.provider);
    modal.querySelector(".admin-payment-preview-sheet h3").textContent = `${state.method || "Payment"} Checkout`;
    modal.querySelector(".admin-payment-preview-amount").textContent = "1,000 THB";
    modal.querySelector(".admin-payment-preview-details").innerHTML = state.paymentType === "wallet"
        ? `<p>Wallet balance and order amount are shown by the wallet flow.</p>`
        : `<p><b>${escapeAdminHTML(state.accountName || "Account name")}</b></p><p>${escapeAdminHTML(state.recipientLabel || "Recipient")}: ${escapeAdminHTML(state.accountNumber || "Recipient ID")}</p>`;
    modal.querySelector(".admin-payment-preview-qr").textContent = state.qrMode === "provider_generated"
        ? "Provider generated QR"
        : state.qrMode === "none"
            ? "No QR"
            : "Uploaded QR preview";
    modal.querySelector(".admin-payment-preview-actions").innerHTML = [
        state.enableSaveQr ? "<button type=\"button\">Save QR</button>" : "",
        state.enableOpenApp ? `<button type="button">Open ${escapeAdminHTML(state.appDisplayName || "Banking App")}</button>` : ""
    ].join("");
    modal.querySelector(".admin-payment-preview-checklist").innerHTML = steps.length
        ? steps.map(step => `<li>${escapeAdminHTML(step.label || step.action)}</li>`).join("")
        : "<li>No checklist steps configured</li>";
    modal.querySelector(".admin-payment-preview-receipt").textContent = state.receiptUploadEnabled && state.slipRequired
        ? "Receipt upload required"
        : "No receipt upload";
    modal.querySelector(".admin-payment-preview-mode").textContent = state.confirmationMode.replaceAll("_", " ");
    modal.hidden = false;
}

function getAdminPaymentPreviewModal() {
    let modal = document.getElementById("adminPaymentPreviewModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "adminPaymentPreviewModal";
    modal.className = "admin-payment-preview-modal";
    modal.hidden = true;
    modal.innerHTML = `
        <div class="admin-payment-preview-panel" role="dialog" aria-modal="true" aria-label="Payment method preview">
            <button type="button" class="admin-payment-preview-close" aria-label="Close preview">×</button>
            <section>
                <h3>Storefront Card</h3>
                <div class="admin-payment-card-preview admin-payment-preview-card">
                    <img src="/assets/payment/payment-neutral.svg" alt="">
                    <div><strong>Payment</strong><small>Badge</small><span>Description</span></div>
                </div>
            </section>
            <section class="admin-payment-preview-sheet">
                <h3>Checkout Preview</h3>
                <strong class="admin-payment-preview-amount">1,000 THB</strong>
                <div class="admin-payment-preview-details"></div>
                <div class="admin-payment-preview-qr"></div>
                <div class="admin-payment-preview-actions"></div>
                <ol class="admin-payment-preview-checklist"></ol>
                <p class="admin-payment-preview-receipt"></p>
                <p>Confirmation: <span class="admin-payment-preview-mode"></span></p>
            </section>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", event => {
        if (event.target === modal || event.target.closest(".admin-payment-preview-close")) {
            modal.hidden = true;
        }
    });
    return modal;
}

function escapeAdminHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getAdminPaymentUploadUrl(path) {
    return getAdminUploadedImageUrl(path, { folder: "payments" });
}

function parseAdminPaymentEvidence(value) {
    if (!value) return undefined;

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : undefined;
    } catch (error) {
        return undefined;
    }
}

function collectChecklistSteps(card) {
    return Array.from(card.querySelectorAll(".pm-checklist-step")).map((row, index) => {
        const action = row.querySelector(".pm-step-action")?.value || "upload_receipt";
        const label = row.querySelector(".pm-step-label")?.value.trim() ||
            action.replaceAll("_", " ");
        return {
            key: action,
            action,
            label,
            enabled: row.querySelector(".pm-step-enabled")?.checked !== false,
            sortOrder: Number(row.querySelector(".pm-step-order")?.value || ((index + 1) * 10))
        };
    });
}

function handleAdminPaymentImageError(img) {
    const src = img?.dataset?.src || img?.currentSrc || img?.src || "";
    markAdminUploadedImageFailed(src);

    const fallback = document.createElement("div");
    fallback.className = "pm-empty-preview";
    fallback.textContent = "QR image unavailable";
    img.closest(".payment-qr-preview")?.replaceWith(fallback);
}

function isAdminSectionActive(section) {
    const sectionEl = document.getElementById(`section-${section}`);
    return !sectionEl || sectionEl.classList.contains("active");
}
function autoPaymentConfig(card) {

    if (!card) return;

    const provider = normalizeAdminProvider(card.querySelector(".pm-provider")?.value || "");

    const type =
        card.querySelector(".pm-type");

    const accountName =
        card.querySelector(".pm-name").closest(".settings-row");

    const accountNumber =
        card.querySelector(".pm-number").closest(".settings-row");

    const qrUrl =
        card.querySelector(".pm-qr").closest(".settings-row");

    const qrUpload =
        card.querySelector(".pm-file").closest(".settings-row");

    const uploadBtn =
        card.querySelector(".upload-qr-btn");

    //----------------------

    accountName.style.display = "";
    accountNumber.style.display = "";
    qrUrl.style.display = "";
    qrUpload.style.display = "";
    uploadBtn.style.display = "";

    //----------------------

    if (provider === "promptpay" && card.dataset.key === "promptpay") {

        type.value = "auto";

        qrUrl.style.display = "none";
        qrUpload.style.display = "none";
        uploadBtn.style.display = "none";

    }

    else if (["scb", "bangkok_bank", "kplus", "krungsri"].includes(provider)) {

        if (type.value === "auto" || type.value === "wallet") {
            type.value = "deeplink";
        }

    }

    else if (provider === "wallet") {

        type.value = "wallet";

        accountName.style.display = "none";
        accountNumber.style.display = "none";

        qrUrl.style.display = "none";
        qrUpload.style.display = "none";
        uploadBtn.style.display = "none";

    }

    else if (provider === "manual") {

        if (type.value === "wallet")
            type.value = "manual";

    }

}

function updateProviderOptions(card) {
    if (!card) return;

    const region = card.querySelector(".pm-region")?.value || "MM";
    const type = card.querySelector(".pm-type")?.value || "manual";
    const providerSelect = card.querySelector(".pm-provider");
    if (!providerSelect) return;

    const current = normalizeAdminProvider(providerSelect.value);
    const keys = providerKeysFor(region, type);
    const nextProvider = keys.includes(current) ? current : keys[0] || "";

    providerSelect.innerHTML = providerOptionsHTML(region, type, nextProvider);
    providerSelect.value = nextProvider;
    providerSelect.disabled = keys.length <= 1;

    autoPaymentConfig(card);
}

window.loadAdminPaymentMethods = loadAdminPaymentMethods;
