// frontend/js/admin-payments.js
// AZIEL Admin Payment Methods Manager V2.5

let adminPaymentMethods = [];
let adminPaymentInfrastructure = null;
let adminPaymentInfrastructureActiveRegion = "TH";
let adminPaymentInfrastructureActiveTab = "overview";
let adminPaymentsInitialized = false;
let paymentInfrastructureActionsBound = false;

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

const ADMIN_DEEPLINK_TEST_PRESETS = Object.freeze([
    { label: "SCB EASY", candidates: ["scbeasy://"] },
    { label: "K PLUS", candidates: ["kplus://", "kbank://", "kplusmobile://", "kmobilebanking://", "kasikorn://"] },
    { label: "Bangkok Bank Mobile", candidates: ["bangkokbank://", "bangkokbankmobile://", "bualuang://", "bbl://", "bblmobile://"] },
    { label: "Krungsri", candidates: ["krungsri://", "krungsriapp://", "kma://", "krungsrimobile://"] },
    { label: "Krungthai NEXT", candidates: ["ktbnext://", "ktb://", "krungthai://"] },
    { label: "TTB", candidates: ["ttb://", "ttbtouch://", "ttbtouchmobile://"] },
    { label: "UOB", candidates: ["uob://", "uobthai://", "uobtmr://"] },
    { label: "CIMB Thai", candidates: ["cimb://", "cimbthai://", "cimbclicks://"] },
    { label: "GSB MyMo", candidates: ["mymo://", "gsb://", "gsbmymo://"] },
    { label: "BAAC", candidates: ["baac://", "baacmobile://"] }
]);

const ADMIN_DEEPLINK_TEST_TARGETS = Object.freeze({
    official: {
        label: "Official Payment Deeplink URL",
        selector: ".pm-deeplink"
    },
    ios: {
        label: "iOS App Launch URL",
        selector: ".pm-ios-app-launch"
    },
    android: {
        label: "Android App Launch URL",
        selector: ".pm-android-app-launch"
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

    box.innerHTML = `<div class="admin-list-empty">Loading payment infrastructure...</div>`;

    try {
        const [data, infrastructure] = await Promise.all([
            adminFetch("/api/admin/payment-methods"),
            adminFetch("/api/admin/payment-infrastructure")
        ]);

        if (!data || !data.success) {
            box.innerHTML = `<div class="admin-list-empty">${data?.message || "Failed to load payment methods"}</div>`;
            return;
        }

        adminPaymentMethods = Array.isArray(data.methods) ? data.methods : [];
        adminPaymentInfrastructure = infrastructure?.success ? infrastructure : null;
        renderAdminPaymentMethods(adminPaymentMethods);

    } catch (error) {
        console.log("Load admin payments error:", error);
        box.innerHTML = `<div class="admin-list-empty">Server error while loading payment infrastructure</div>`;
    }
}

function renderAdminPaymentMethods(methods) {
    const box = document.getElementById("paymentMethodsContainer");
    if (!box) return;
    const activeRegion = getPaymentInfrastructureActiveRegion(methods);
    const regionMethods = getPaymentMethodsForInfrastructureRegion(methods, activeRegion);

    const toolbar = `
        <div class="admin-payment-toolbar">
            <button class="admin-secondary-btn" type="button" data-action="add-payment-method">
                Add Payment Method
            </button>
        </div>
    `;

    if (!methods.length) {
        box.innerHTML = renderPaymentInfrastructureWorkspace(methods, `${toolbar}<div class="admin-list-empty">No payment methods found.</div>`, activeRegion);
        bindAdminPaymentActions();
        bindPaymentInfrastructureActions();
        return;
    }

    const editorMarkup = toolbar + (regionMethods.length ? regionMethods.map(method => {
        const qr = method.uploadedQrImage || method.qrImageUrl || method.qrImage || "";
        const qrUrl = getAdminPaymentUploadUrl(qr);
        const type = method.paymentType || "manual";
        const provider = normalizeAdminProvider(method.provider || method.key || "");
        const displayName = formatPaymentName(method.method || method.key || "Payment");
        const logoUrl = method.logoUrl || getAdminPaymentLogo(method);
        const readiness = getAdminPaymentReadiness(method);
        const legacyThaiBank = isLegacyThailandBankAdminMethod(method);
        const status = legacyThaiBank
            ? getLegacyThailandBankStatus(method)
            : getAdminPaymentStatus(method, readiness);
        const legacyNotice = legacyThaiBank ? legacyThailandBankNotice(method) : "";
        const readinessLine = legacyThaiBank
            ? "Customer storefront visibility is controlled by PromptPay child launcher settings."
            : readinessSummary(readiness);
        const editorActionLabel = legacyThaiBank ? "View" : "Edit";
        const saveButton = legacyThaiBank
            ? `<button class="save-payment-btn" type="button" disabled title="Manage this bank under PromptPay Supported Banking Apps">Managed under PromptPay</button>`
            : `<button class="save-payment-btn" type="button" data-action="save-payment-method" data-id="${escapeAdminHTML(method._id)}">
                        Save ${escapeAdminHTML(displayName)}
                    </button>`;

        return `
            <div class="payment-method-card ${legacyThaiBank ? "is-legacy-thai-bank" : ""}" data-id="${escapeAdminHTML(method._id)}" data-key="${escapeAdminHTML(method.key || "")}" data-region="${escapeAdminHTML(method.region || "")}" data-configuration-kind="${escapeAdminHTML(method.configurationKind || "MANUAL_QR")}" data-legacy-thai-bank="${legacyThaiBank ? "true" : "false"}">
                <div class="payment-header">
                    <div class="payment-method-summary-main">
                        <img class="payment-method-summary-logo" src="${escapeAdminHTML(logoUrl)}" alt="${escapeAdminHTML(displayName)} logo" onerror="this.src='/assets/payment/payment-neutral.svg'">
                        <div>
                            <h4>${escapeAdminHTML(displayName)} <small>${escapeAdminHTML(getRegionLabel(method.region))} · ${escapeAdminHTML(getPaymentTypeLabel(type))}</small></h4>
                            <p>${escapeAdminHTML(method.shortDescription || getPaymentTypeDescription(method.key, type, provider))}</p>
                            ${legacyNotice}
                            <p class="payment-readiness-meter">${escapeAdminHTML(readinessLine)}</p>
                            <div class="payment-summary-capabilities">
                                ${capabilityChip("QR", hasPaymentQr(method))}
                                ${capabilityChip("App", method.enableOpenApp === true && Boolean(method.deepLinkUrl || method.iosAppLaunchUrl || method.androidAppLaunchUrl || method.androidPackageName))}
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
                        <button class="admin-small-btn" type="button" data-action="edit-payment-method" data-id="${escapeAdminHTML(method._id)}">${editorActionLabel}</button>
                    </div>

                    <label class="switch">
                        <input class="pm-enabled" type="checkbox" ${method.enabled ? "checked" : ""} ${legacyThaiBank ? "disabled" : ""}>
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
                        <small>${escapeAdminHTML(readinessLine)}</small>
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

                <section class="payment-config-section payment-account-section" ${method.applicableSections?.includes("account") ? "" : "hidden"}>
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

                <section class="payment-config-section payment-qr-section" ${method.applicableSections?.some(section => ["staticQr", "promptPay"].includes(section)) ? "" : "hidden"}>
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

                <div class="payment-capability-details payment-bank-app-section" ${method.applicableSections?.includes("bankApp") ? "" : "hidden"}>
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

	                    <div class="settings-row pm-app-launch-field">
	                        <div>
	                            <label>Android Package Name</label>
	                            <small>Used to build Android Chrome intent links with Play Store fallback</small>
	                        </div>
	                        <input class="pm-android-package-name" type="text" value="${escapeAdminHTML(method.androidPackageName || "")}" placeholder="com.kasikorn.retail.mbanking.wap">
	                    </div>

	                    <div class="settings-row pm-app-launch-field">
	                        <div>
	                            <label>Generated Android Intent Preview</label>
	                            <small>Read-only preview; package-only intents are best-effort and device/browser dependent</small>
	                        </div>
	                        <textarea class="pm-android-intent-preview" readonly>${escapeAdminHTML(buildAdminAndroidIntentPreview(method))}</textarea>
	                    </div>

                    ${renderOwnerDeepLinkTester(method)}

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

                ${method.key === "promptpay" ? renderPromptPayBankLauncherEditor(method) : ""}

                <div class="payment-capability-details payment-customer-actions-section" ${method.applicableSections?.includes("checklist") ? "" : "hidden"}>
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

                <div class="payment-capability-details payment-verification-section" ${method.applicableSections?.includes("manualVerification") ? "" : "hidden"}>
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

                <div class="payment-capability-details payment-checklist-section" ${method.applicableSections?.includes("checklist") ? "" : "hidden"}>
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
                    ${saveButton}
                </div>
                </details>
            </div>
        `;
    }).join("") : `<div class="admin-list-empty">No payment methods configured for ${escapeAdminHTML(activeRegion === "MM" ? "Myanmar" : activeRegion === "TH" ? "Thailand" : "Future Regions")}.</div>`);

    box.innerHTML = renderPaymentInfrastructureWorkspace(methods, editorMarkup, activeRegion);

    bindAdminPaymentActions();
    bindPaymentInfrastructureActions();
}

function renderPromptPayBankLauncherEditor(method = {}) {
    const launchers = Array.isArray(method.bankLaunchers) && method.bankLaunchers.length
        ? method.bankLaunchers
        : defaultPromptPayBankLaunchers();

    return `
        <section class="payment-config-section pm-bank-launcher-section">
            <h5>Supported Banking Apps</h5>
            <p class="payment-section-help">PromptPay remains the payment method. These banks are app launchers for QR gallery scanning only.</p>
            <div class="pm-bank-launcher-list">
                ${launchers.map(renderBankLauncherRow).join("")}
            </div>
            <div class="pm-bank-launcher-preview">
                <strong>Customer bank chooser</strong>
                <span>Only enabled verified banking apps appear. K PLUS remains hidden.</span>
            </div>
        </section>
    `;
}

function getPaymentInfrastructureActiveRegion(methods = []) {
    const infraRegions = Array.isArray(adminPaymentInfrastructure?.regions)
        ? adminPaymentInfrastructure.regions.map(region => region.region).filter(Boolean)
        : [];
    if (infraRegions.includes(adminPaymentInfrastructureActiveRegion)) {
        return adminPaymentInfrastructureActiveRegion;
    }
    if (infraRegions.includes("TH")) return "TH";
    if (infraRegions.includes("MM")) return "MM";
    if (methods.some(method => String(method.region || "").toUpperCase() === "TH")) return "TH";
    if (methods.some(method => String(method.region || "").toUpperCase() === "MM")) return "MM";
    return "TH";
}

function getPaymentMethodsForInfrastructureRegion(methods = [], region = "TH") {
    if (region === "FUTURE") return [];
    return methods.filter(method => {
        const methodRegion = String(method.region || "").toUpperCase();
        const methodKey = String(method.key || "").toLowerCase();
        return methodRegion === region || methodKey === "wallet";
    });
}

function renderPaymentInfrastructureWorkspace(methods = [], configurationMarkup = "", selectedRegion = "") {
    const infra = adminPaymentInfrastructure || buildFallbackPaymentInfrastructure(methods);
    const regions = Array.isArray(infra.regions) ? infra.regions : [];
    const activeRegion = selectedRegion || getPaymentInfrastructureActiveRegion(methods);
    const active = regions.find(region => region.region === activeRegion) || regions[0] || {};
    const activeTab = Object.prototype.hasOwnProperty.call({
        overview: true,
        configuration: true,
        display: true,
        accounts: true,
        providers: true,
        routing: true,
        cards: true,
        webhooks: true,
        diagnostics: true
    }, adminPaymentInfrastructureActiveTab) ? adminPaymentInfrastructureActiveTab : "overview";
    const panels = {
        overview: renderPaymentInfrastructureOverview(active, infra),
        configuration: configurationMarkup,
        display: renderPaymentInfrastructureCustomerDisplay(active),
        accounts: renderPaymentInfrastructureAccounts(active),
        providers: renderPaymentInfrastructureProviders(infra),
        routing: renderPaymentInfrastructureRouting(infra),
        cards: renderPaymentInfrastructureCards(active),
        webhooks: renderPaymentInfrastructureWebhooks(infra),
        diagnostics: renderPaymentInfrastructureDiagnostics(active, infra)
    };

    return `
        <div class="payment-infrastructure-workspace" data-payment-infra-region="${escapeAdminHTML(activeRegion)}">
            <aside class="payment-infra-nav" aria-label="Payment infrastructure regions">
                <h4>Regions</h4>
                ${regions.map(region => `
                    <button class="payment-infra-region ${region.region === activeRegion ? "active" : ""}" type="button" data-payment-infra-region="${escapeAdminHTML(region.region)}">
                        <strong>${escapeAdminHTML(region.label || region.region)}</strong>
                        <small>${escapeAdminHTML((region.manualRails || []).length)} manual · ${escapeAdminHTML((region.automaticRails || []).length)} auto</small>
                    </button>
                `).join("")}
                <div class="payment-infra-nav-group">
                    <span>Manual Rails</span>
                    ${(active.manualRails || []).map(rail => `<em>${escapeAdminHTML(rail.label)}</em>`).join("") || "<em>None configured</em>"}
                </div>
                <div class="payment-infra-nav-group">
                    <span>Automatic Rails</span>
                    ${(active.automaticRails || []).map(rail => `<em>${escapeAdminHTML(rail.label)} · ${escapeAdminHTML(rail.status)}</em>`).join("") || "<em>Disabled placeholders</em>"}
                </div>
                <div class="payment-infra-nav-group">
                    <span>Wallet</span>
                    ${(active.wallet || []).map(rail => `<em>${escapeAdminHTML(rail.label)}</em>`).join("") || "<em>Global wallet rail</em>"}
                </div>
                <div class="payment-infra-nav-group">
                    <span>Providers</span>
                    ${(active.providers || []).map(provider => `<em>${escapeAdminHTML(provider.displayName)} · ${escapeAdminHTML(provider.healthState)}</em>`).join("") || "<em>No configured provider</em>"}
                </div>
            </aside>

            <section class="payment-infra-main">
                <div class="payment-infra-tabs" role="tablist" aria-label="Payment infrastructure workspace">
                    ${Object.keys(panels).map(key => `
                        <button class="${key === activeTab ? "active" : ""}" type="button" data-payment-infra-tab="${key}">
                            ${escapeAdminHTML(paymentInfrastructureTabLabel(key))}
                        </button>
                    `).join("")}
                </div>
                ${Object.entries(panels).map(([key, markup]) => `
                    <div class="payment-infra-panel ${key === activeTab ? "active" : ""}" data-payment-infra-panel="${key}">
                        ${markup}
                    </div>
                `).join("")}
            </section>
        </div>
    `;
}

function buildFallbackPaymentInfrastructure(methods = []) {
    const regionGroups = ["MM", "TH", "FUTURE"].map(region => ({
        region,
        label: region === "MM" ? "Myanmar" : region === "TH" ? "Thailand" : "Future Regions",
        manualRails: methods.filter(method => (method.region || "") === region && method.paymentType !== "auto" && method.paymentType !== "wallet").map(method => ({
            label: method.method || method.key,
            railType: method.railType || "MANUAL_QR",
            status: method.enabled === true && method.publicReady === true
                ? "READY"
                : method.enabled === true ? "DEGRADED" : "DISABLED",
            enabled: method.enabled === true,
            customerVisible: method.enabled === true && method.publicReady === true,
            capabilities: {
                saveQr: method.enableSaveQr === true,
                openApp: method.enableOpenApp === true,
                receiptUpload: method.receiptUploadEnabled !== false,
                adminVerification: method.confirmationMode === "manual_admin",
                bankLaunchers: Array.isArray(method.bankLaunchers) ? method.bankLaunchers.length : 0
            },
            diagnostics: []
        })),
        automaticRails: [],
        wallet: methods.filter(method => method.paymentType === "wallet").map(method => ({ label: method.method || "AZIEL Wallet", status: "READY" })),
        providers: []
    }));
    return {
        regions: regionGroups,
        providers: [],
        adapters: [],
        routing: {
            MM: { mode: "MANUAL_ONLY", primaryRail: "MANUAL_QR", fallbackRail: "" },
            TH: { mode: "MANUAL_ONLY", primaryRail: "MANUAL_QR", fallbackRail: "" }
        },
        security: { rawSecretsReturned: false }
    };
}

function paymentInfrastructureTabLabel(key) {
    return {
        overview: "Overview",
        configuration: "Configuration",
        display: "Customer Display",
        accounts: "Accounts / QR",
        providers: "Providers",
        routing: "Routing",
        cards: "Cards",
        webhooks: "Webhooks",
        diagnostics: "Diagnostics"
    }[key] || key;
}

function renderPaymentInfrastructureOverview(region = {}, infra = {}) {
    const manual = region.manualRails || [];
    const automatic = region.automaticRails || [];
    return `
        <div class="payment-infra-grid">
            ${paymentInfraMetric("Region", region.label || region.region || "-")}
            ${paymentInfraMetric("Manual Rails", manual.length)}
            ${paymentInfraMetric("Automatic Rails", automatic.length)}
            ${paymentInfraMetric("Routing Mode", infra.routing?.[region.region]?.mode || "MANUAL_ONLY")}
        </div>
        <div class="payment-rail-columns">
            ${renderRailGroup("Manual Rails", manual)}
            ${renderRailGroup("Automatic Rails", automatic)}
            ${renderRailGroup("Wallet", region.wallet || [])}
        </div>
    `;
}

function renderRailGroup(title, rails = []) {
    return `
        <section class="payment-rail-group">
            <h4>${escapeAdminHTML(title)}</h4>
            ${rails.length ? rails.map(renderPaymentRailRow).join("") : `<div class="payment-infra-empty">No rails configured.</div>`}
        </section>
    `;
}

function renderPaymentRailRow(rail = {}) {
    const status = rail.status || (rail.enabled ? "READY" : "DISABLED");
    return `
        <article class="payment-rail-row">
            <div>
                <strong>${escapeAdminHTML(rail.label || rail.displayName || rail.key || "Rail")}</strong>
                <small>${escapeAdminHTML(rail.railType || "Rail")} · ${escapeAdminHTML(rail.availabilityMode || "DISABLED")}</small>
            </div>
            <span class="payment-infra-status ${escapeAdminHTML(status.toLowerCase())}">Rail ${escapeAdminHTML(status)}</span>
            <p>${escapeAdminHTML(rail.customerVisible ? "Storefront: Visible" : "Storefront: Hidden")}</p>
        </article>
    `;
}

function renderPaymentInfrastructureCustomerDisplay(region = {}) {
    const visibleRails = (region.manualRails || []).filter(rail => rail.customerVisible === true);
    return `
        <div class="payment-preview-grid">
            ${visibleRails.map(rail => `
                <article class="payment-preview-card">
                    <strong>${escapeAdminHTML(rail.label)}</strong>
                    <span>${escapeAdminHTML(rail.railType)}</span>
                    <p>${escapeAdminHTML(rail.capabilities?.receiptUpload ? "Receipt upload and manual admin verification remain active." : "Customer display only.")}</p>
                    <div class="payment-summary-capabilities">
                        ${capabilityChip("QR", rail.capabilities?.dynamicQr || rail.capabilities?.saveQr)}
                        ${capabilityChip("Save QR", rail.capabilities?.saveQr)}
                        ${capabilityChip("Open App", rail.capabilities?.openApp)}
                        ${capabilityChip("Receipt", rail.capabilities?.receiptUpload)}
                    </div>
                </article>
            `).join("") || `<div class="payment-infra-empty">No customer-visible payment rails are available for this region.</div>`}
        </div>
    `;
}

function renderPaymentInfrastructureAccounts(region = {}) {
    return `
        <div class="payment-rail-columns">
            ${renderRailGroup("Accounts / QR", (region.manualRails || []).filter(rail => ["MANUAL_QR", "MANUAL_BANK_TRANSFER", "MANUAL_BANK_APP"].includes(rail.railType)))}
        </div>
        <p class="payment-section-help">Manual receiving account, QR, launcher, checklist, and receipt settings remain editable in Configuration.</p>
    `;
}

function renderPaymentInfrastructureProviders(infra = {}) {
    const providers = infra.providers || [];
    return `
        <div class="payment-provider-grid">
            ${providers.map(provider => `
                <article class="payment-provider-card">
                    <strong>${escapeAdminHTML(provider.displayName)}</strong>
                    <small>${escapeAdminHTML(provider.providerCode)} · adapter: ${escapeAdminHTML(provider.adapterName || "missing")}</small>
                    <span class="payment-infra-status ${escapeAdminHTML(String(provider.healthState || "not_configured").toLowerCase())}">${escapeAdminHTML(provider.healthState || "NOT_CONFIGURED")}</span>
                    <dl>
                        <div><dt>Currencies</dt><dd>${escapeAdminHTML((provider.supportedCurrencies || []).join(", ") || "-")}</dd></div>
                        <div><dt>Rails</dt><dd>${escapeAdminHTML((provider.supportedRails || []).join(", ") || "-")}</dd></div>
                        <div><dt>Refunds</dt><dd>${provider.refundCapability ? "Supported" : "Not ready"}</dd></div>
                    </dl>
                    ${renderProviderCredentialStates(provider)}
                </article>
            `).join("") || `<div class="payment-infra-empty">No provider configuration exists yet.</div>`}
        </div>
    `;
}

function renderProviderCredentialStates(provider = {}) {
    return `
        <div class="payment-credential-grid">
            ${(provider.environments || []).map(env => `
                <div>
                    <strong>${escapeAdminHTML(env.environment)}</strong>
                    <span>Public key: ${escapeAdminHTML(env.publicKeyStatus)}</span>
                    <span>Secret key: ${escapeAdminHTML(env.secretKeyStatus)}</span>
                    <span>Webhook secret: ${escapeAdminHTML(env.webhookSecretStatus)}</span>
                    <span>Merchant: ${escapeAdminHTML(env.merchantIdentifierStatus)}</span>
                </div>
            `).join("")}
        </div>
    `;
}

function renderPaymentInfrastructureRouting(infra = {}) {
    const routing = infra.routing || {};
    return `
        <div class="payment-infra-grid">
            ${Object.entries(routing).map(([region, config]) => paymentInfraMetric(region, `${config.mode} · primary ${config.primaryRail || "-"}`)).join("")}
        </div>
        <div class="payment-method-hint">
            <strong>Controlled migration rule</strong>
            <span>Automatic rails cannot become primary until provider, credentials, webhook, health, and rail readiness pass. Manual rails are not disabled automatically.</span>
        </div>
    `;
}

function renderPaymentInfrastructureCards(region = {}) {
    const cardRails = (region.automaticRails || []).filter(rail => rail.railType === "AUTO_CARD");
    return `
        ${cardRails.map(rail => `
            <article class="payment-provider-card">
                <strong>${escapeAdminHTML(rail.label)}</strong>
                <span class="payment-infra-status not_configured">${escapeAdminHTML(rail.status || "NOT_CONFIGURED")}</span>
                <p>Future card rail metadata only. AZIEL does not store card numbers.</p>
                <dl>
                    <div><dt>Networks</dt><dd>${escapeAdminHTML((rail.card?.networks || []).join(", ") || "-")}</dd></div>
                    <div><dt>Checkout Modes</dt><dd>${escapeAdminHTML((rail.card?.checkoutModes || []).join(", ") || "-")}</dd></div>
                    <div><dt>3DS</dt><dd>${escapeAdminHTML(rail.card?.threeDS || "Provider dependent")}</dd></div>
                </dl>
            </article>
        `).join("") || `<div class="payment-infra-empty">Card rail is disabled until a verified provider is configured.</div>`}
    `;
}

function renderPaymentInfrastructureWebhooks(infra = {}) {
    return `
        <div class="payment-provider-grid">
            ${(infra.providers || []).map(provider => (provider.environments || []).map(env => `
                <article class="payment-provider-card">
                    <strong>${escapeAdminHTML(provider.displayName)} · ${escapeAdminHTML(env.environment)}</strong>
                    <span class="payment-infra-status ${env.webhook?.secretConfigured ? "ready" : "not_configured"}">${env.webhook?.secretConfigured ? "SECRET CONFIGURED" : "NOT_CONFIGURED"}</span>
                    <dl>
                        <div><dt>Endpoint</dt><dd>Provider-specific, signature verified</dd></div>
                        <div><dt>Last received</dt><dd>${escapeAdminHTML(formatAdminDate(env.webhook?.lastReceivedAt))}</dd></div>
                        <div><dt>Last verified</dt><dd>${escapeAdminHTML(formatAdminDate(env.webhook?.lastVerifiedAt))}</dd></div>
                        <div><dt>Replay protection</dt><dd>${env.webhook?.replayProtectionReady ? "Ready" : "Not configured"}</dd></div>
                    </dl>
                </article>
            `).join("")).join("") || `<div class="payment-infra-empty">No webhook diagnostics yet.</div>`}
        </div>
    `;
}

function renderPaymentInfrastructureDiagnostics(region = {}, infra = {}) {
    const rails = [...(region.manualRails || []), ...(region.automaticRails || [])];
    return `
        <div class="payment-diagnostics-list">
            ${rails.map(rail => `
                <article>
                    <h4>${escapeAdminHTML(rail.label)}</h4>
                    ${(rail.diagnostics || []).map(item => `
                        <p><span>${escapeAdminHTML(item.label)}</span><b class="payment-infra-status ${escapeAdminHTML(String(item.status || "not_configured").toLowerCase())}">${escapeAdminHTML(item.status || "NOT_CONFIGURED")}</b></p>
                    `).join("") || "<p><span>No diagnostics</span><b>LEGACY</b></p>"}
                </article>
            `).join("")}
        </div>
    `;
}

function paymentInfraMetric(label, value) {
    return `<div class="payment-infra-metric"><span>${escapeAdminHTML(label)}</span><strong>${escapeAdminHTML(value)}</strong></div>`;
}

function bindPaymentInfrastructureActions() {
    const container = document.getElementById("paymentMethodsContainer");
    if (!container || paymentInfrastructureActionsBound) return;
    paymentInfrastructureActionsBound = true;
    container.addEventListener("click", event => {
        const tabButton = event.target.closest("[data-payment-infra-tab]");
        if (tabButton && container.contains(tabButton)) {
            const tab = tabButton.dataset.paymentInfraTab || "overview";
            adminPaymentInfrastructureActiveTab = tab;
            const root = tabButton.closest(".payment-infrastructure-workspace");
            root?.querySelectorAll("[data-payment-infra-tab]").forEach(item => item.classList.toggle("active", item === tabButton));
            root?.querySelectorAll("[data-payment-infra-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.paymentInfraPanel === tab));
            return;
        }

        const regionButton = event.target.closest(".payment-infra-region[data-payment-infra-region]");
        if (!regionButton || !container.contains(regionButton)) return;
        selectPaymentInfrastructureRegion(regionButton.dataset.paymentInfraRegion || "TH");
    });
    container.addEventListener("change", event => {
        const enabledInput = event.target.closest(".payment-method-card .pm-enabled");
        if (!enabledInput || !container.contains(enabledInput)) return;
        const card = enabledInput.closest(".payment-method-card");
        const status = card?.querySelector(".payment-config-status");
        if (!status) return;
        status.className = `payment-config-status ${enabledInput.checked ? "is-draft" : "is-ready"}`;
        status.textContent = enabledInput.checked ? "Unsaved · Pending Save" : "Unsaved · Disabled";
    });
}

function selectPaymentInfrastructureRegion(region, options = {}) {
    const normalized = String(region || "").trim().toUpperCase();
    const availableRegions = Array.isArray(adminPaymentInfrastructure?.regions)
        ? adminPaymentInfrastructure.regions.map(item => String(item.region || "").toUpperCase())
        : ["MM", "TH", "FUTURE"];
    if (!availableRegions.includes(normalized)) return false;
    if (normalized === adminPaymentInfrastructureActiveRegion) return false;

    adminPaymentInfrastructureActiveRegion = normalized;
    renderAdminPaymentMethods(adminPaymentMethods);
    if (options.notify !== false) {
        showAdminToast?.(`${normalized === "MM" ? "Myanmar" : normalized === "TH" ? "Thailand" : "Future Regions"} payment rails selected.`, "info");
    }
    return true;
}

function formatAdminDate(value) {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function defaultPromptPayBankLaunchers() {
    return [
        {
            key: "scb",
            displayName: "SCB EASY",
            logoUrl: "/assets/payment/scb.png",
            enabled: true,
            sortOrder: 10,
            androidPackageName: "com.scb.phone",
            androidAppLaunchUrl: "intent://#Intent;scheme=scbeasy;package=com.scb.phone;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.scb.phone;end",
            playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.scb.phone",
            iosAppLaunchUrl: "scbeasy://",
            appStoreFallbackUrl: "",
            verificationStatus: "verified",
            operatorNotes: ""
        },
        {
            key: "bangkok_bank",
            displayName: "Bangkok Bank Mobile Banking",
            logoUrl: "/assets/payment/bank-neutral.svg",
            enabled: true,
            sortOrder: 20,
            androidPackageName: "com.bbl.mobilebanking",
            androidAppLaunchUrl: "intent://#Intent;scheme=bualuangmbanking;package=com.bbl.mobilebanking;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.bbl.mobilebanking;end",
            playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.bbl.mobilebanking",
            iosAppLaunchUrl: "bualuangmbanking://",
            appStoreFallbackUrl: "",
            verificationStatus: "verified",
            operatorNotes: ""
        },
        {
            key: "krungsri",
            displayName: "Krungsri",
            logoUrl: "/assets/payment/bank-neutral.svg",
            enabled: true,
            sortOrder: 30,
            androidPackageName: "com.krungsri.kma",
            androidAppLaunchUrl: "intent://openpage-landing#Intent;scheme=krungsri-kma;package=com.krungsri.kma;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.krungsri.kma;end",
            playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.krungsri.kma",
            iosAppLaunchUrl: "krungsri-kma://openpage-landing",
            appStoreFallbackUrl: "",
            verificationStatus: "verified",
            operatorNotes: ""
        },
        {
            key: "krungthai",
            displayName: "Krungthai NEXT",
            logoUrl: "/assets/payment/bank-neutral.svg",
            enabled: true,
            sortOrder: 40,
            androidPackageName: "ktbcs.netbank",
            androidAppLaunchUrl: "intent://#Intent;scheme=ktb-next;package=ktbcs.netbank;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dktbcs.netbank;end",
            playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=ktbcs.netbank",
            iosAppLaunchUrl: "ktbnext://",
            appStoreFallbackUrl: "",
            verificationStatus: "verified",
            operatorNotes: ""
        }
    ];
}

function renderBankLauncherRow(launcher = {}) {
    return `
        <div class="pm-bank-launcher-row" data-bank-launcher="${escapeAdminHTML(launcher.key || "")}">
            <div class="settings-row capability-grid">
                ${capabilityToggle("pm-bank-launcher-enabled", `${escapeAdminHTML(launcher.displayName || launcher.key || "Bank")} Enabled`, launcher.enabled !== false)}
            </div>
            <div class="settings-row">
                <div><label>Display Name</label><small>Customer-facing app name</small></div>
                <input class="pm-bank-launcher-name" type="text" value="${escapeAdminHTML(launcher.displayName || "")}">
            </div>
            <div class="settings-row">
                <div><label>Logo URL</label><small>Small bank logo shown in chooser</small></div>
                <input class="pm-bank-launcher-logo" type="text" value="${escapeAdminHTML(launcher.logoUrl || "")}">
            </div>
            <div class="settings-row">
                <div><label>Sort Order</label><small>Lower numbers appear first</small></div>
                <input class="pm-bank-launcher-sort" type="number" step="1" value="${escapeAdminHTML(launcher.sortOrder || 0)}">
            </div>
            <div class="settings-row">
                <div><label>Android Package</label><small>Package identity for generated intents</small></div>
                <input class="pm-bank-launcher-android-package" type="text" value="${escapeAdminHTML(launcher.androidPackageName || "")}">
            </div>
            <div class="settings-row">
                <div><label>Android Launch URL</label><small>Explicit Android intent or app URL</small></div>
                <input class="pm-bank-launcher-android-url" type="text" value="${escapeAdminHTML(launcher.androidAppLaunchUrl || "")}">
            </div>
            <div class="settings-row">
                <div><label>Play Store Fallback</label><small>HTTPS fallback when app is unavailable</small></div>
                <input class="pm-bank-launcher-play-store" type="text" value="${escapeAdminHTML(launcher.playStoreFallbackUrl || "")}">
            </div>
            <div class="settings-row">
                <div><label>iOS Launch URL</label><small>Verified iOS app launcher URL</small></div>
                <input class="pm-bank-launcher-ios-url" type="text" value="${escapeAdminHTML(launcher.iosAppLaunchUrl || "")}">
            </div>
            <div class="settings-row">
                <div><label>App Store Fallback</label><small>Optional iOS store fallback</small></div>
                <input class="pm-bank-launcher-app-store" type="text" value="${escapeAdminHTML(launcher.appStoreFallbackUrl || "")}">
            </div>
            <div class="settings-row">
                <div><label>Verification Status</label><small>Only verified/enabled apps appear publicly</small></div>
                <select class="pm-bank-launcher-status">
                    <option value="verified" ${launcher.verificationStatus !== "unverified" && launcher.verificationStatus !== "failed" ? "selected" : ""}>Verified</option>
                    <option value="unverified" ${launcher.verificationStatus === "unverified" ? "selected" : ""}>Unverified</option>
                    <option value="failed" ${launcher.verificationStatus === "failed" ? "selected" : ""}>Failed</option>
                </select>
            </div>
            <div class="settings-row">
                <div><label>Operator Notes</label><small>Internal launcher notes</small></div>
                <textarea class="pm-bank-launcher-notes">${escapeAdminHTML(launcher.operatorNotes || "")}</textarea>
            </div>
        </div>
    `;
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
        } else {
            const hasIosLaunchOrStore = Boolean(String(method.iosAppLaunchUrl || method.appStoreFallbackUrl || method.appStoreUrl || "").trim());
            if (!String(method.deepLinkUrl || "").trim() && !hasIosLaunchOrStore && !hasAdminAndroidLaunchCapability(method)) {
                missing.push("app launch URL");
            }
        }
    }
    return { ready: missing.length === 0, missing };
}

function getAdminPaymentStatus(method = {}, readiness = { ready: false }) {
    if (!readiness.ready) return { label: "Draft", className: "is-draft" };
    if (method.customerVisible === true) return { label: "Customer Visible", className: "is-enabled" };
    if (method.enabled) return { label: "Unavailable", className: "is-draft" };
    return { label: "Configured · Disabled", className: "is-ready" };
}

function isLegacyThailandBankAdminMethod(method = {}) {
    return String(method.region || "").toUpperCase() === "TH" &&
        ["scb", "bangkok_bank", "kplus", "krungsri", "krungthai"].includes(
            normalizeAdminProvider(method.key || method.provider || method.method || "")
        );
}

function getLegacyThailandBankStatus(method = {}) {
    if (normalizeAdminProvider(method.key || method.provider || method.method || "") === "kplus") {
        return { label: "Unsupported / Broken", className: "is-draft" };
    }
    return { label: "Legacy / Hidden from storefront", className: "is-ready" };
}

function legacyThailandBankNotice(method = {}) {
    const key = normalizeAdminProvider(method.key || method.provider || method.method || "");
    if (key === "kplus") {
        return `
            <p class="payment-legacy-notice">
                Status: Unsupported / Broken · Customer visibility: Forced off · Reason: Error 116.
            </p>
        `;
    }
    return `
        <p class="payment-legacy-notice">
            Legacy / Hidden from storefront. Manage customer logo, display name, enabled state, and sort order under PromptPay → Supported Banking Apps.
        </p>
    `;
}

function lockLegacyThailandBankEditor(card) {
    if (!card || card.dataset.legacyThaiBank !== "true") return;
    card.querySelectorAll("input, select, textarea, button").forEach(control => {
        if (control.closest(".payment-summary-actions") || control.closest("summary")) return;
        if (control.getAttribute("data-action") === "preview-payment-method") return;
        control.disabled = true;
    });
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

function isAdminOwner() {
    const role = String(
        window.AZIEL_ADMIN_AUTH?.state?.admin?.role ||
        localStorage.getItem("adminRole") ||
        ""
    ).toUpperCase();
    return role === "OWNER";
}

function deepLinkPresetOptionsHTML() {
    return `
        <option value="">Choose candidate preset...</option>
        ${ADMIN_DEEPLINK_TEST_PRESETS.map(group => `
            <optgroup label="${escapeAdminHTML(group.label)}">
                ${group.candidates.map(candidate => `
                    <option value="${escapeAdminHTML(candidate)}">${escapeAdminHTML(candidate)}</option>
                `).join("")}
            </optgroup>
        `).join("")}
    `;
}

function renderOwnerDeepLinkTester(method = {}) {
    if (!isAdminOwner()) return "";

    return `
        <details class="payment-capability-details pm-deeplink-tester" data-owner-only="true">
            <summary>Developer Tools · Deep Link Tester</summary>
            <div class="pm-deeplink-tester-grid">
                <div class="pm-deeplink-context">
                    <strong>Current Payment Method</strong>
                    <dl>
                        <div><dt>Method</dt><dd>${escapeAdminHTML(method.method || method.key || "Payment method")}</dd></div>
                        <div><dt>App display name</dt><dd>${escapeAdminHTML(method.appDisplayName || "Not set")}</dd></div>
                        <div><dt>Official deeplink</dt><dd>${escapeAdminHTML(method.deepLinkUrl || "Not set")}</dd></div>
                        <div><dt>iOS launch URL</dt><dd>${escapeAdminHTML(method.iosAppLaunchUrl || "Not set")}</dd></div>
                        <div><dt>Android launch URL</dt><dd>${escapeAdminHTML(method.androidAppLaunchUrl || "Not set")}</dd></div>
                        <div><dt>Android package</dt><dd>${escapeAdminHTML(method.androidPackageName || "Not set")}</dd></div>
                    </dl>
                </div>
                <div class="pm-deeplink-controls">
                    <label>
                        Candidate preset
                        <select class="pm-deeplink-test-preset">
                            ${deepLinkPresetOptionsHTML()}
                        </select>
                    </label>
                    <label>
                        Candidate Scheme
                        <input class="pm-deeplink-test-candidate" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="scbeasy://">
                    </label>
                    <label>
                        Save target
                        <select class="pm-deeplink-test-target">
                            <option value="official">Official Payment Deeplink URL</option>
                            <option value="ios">iOS App Launch URL</option>
                            <option value="android">Android App Launch URL</option>
                            <option value="all">All applicable launch fields</option>
                        </select>
                    </label>
                    <p class="pm-deeplink-device-note">Desktop testing is inconclusive. Use a real iPhone or Android device before confirming.</p>
                    <div class="pm-deeplink-actions">
                        <button type="button" class="admin-small-btn" data-action="test-deeplink-launch">Test Launch</button>
                        <button type="button" class="admin-small-btn" data-action="confirm-deeplink-opened" disabled>Confirm App Opened</button>
                        <button type="button" class="admin-small-btn" data-action="reject-deeplink-opened" disabled>No, it did not open</button>
                        <button type="button" class="admin-small-btn" data-action="wrong-deeplink-opened" disabled>A different app opened</button>
                        <button type="button" class="admin-small-btn" data-action="save-deeplink-to-editor" disabled>Save to Current Payment Method</button>
                        <button type="button" class="admin-small-btn" data-action="clear-deeplink-test">Clear</button>
                    </div>
                    <div class="pm-deeplink-status" role="status" aria-live="polite">
                        <strong>Not tested</strong>
                        <ul>
                            <li>Candidate value: Not set</li>
                            <li>Device/platform: ${escapeAdminHTML(getDeepLinkDeviceLabel())}</li>
                            <li>Last test time: Not tested</li>
                            <li>Launch attempted: No</li>
                            <li>Possible handoff detected: No</li>
                            <li>Owner confirmed: No</li>
                            <li>Saved: Not saved</li>
                            <li>Browser note: Custom scheme success cannot be detected reliably.</li>
                        </ul>
                    </div>
                </div>
            </div>
        </details>
    `;
}

function buildAdminAndroidIntentPreview(source = {}) {
    const helper = window.AZIEL_ANDROID_APP_LAUNCH;
    if (!helper?.buildAndroidIntentUrl) return "";
    return helper.buildAndroidIntentUrl({
        androidPackageName: source.androidPackageName || "",
        androidAppLaunchUrl: source.androidAppLaunchUrl || "",
        playStoreFallbackUrl: source.playStoreFallbackUrl || source.playStoreUrl || ""
    });
}

function hasAdminAndroidLaunchCapability(source = {}) {
    const helper = window.AZIEL_ANDROID_APP_LAUNCH;
    return helper?.hasAndroidLaunchCapability?.({
        androidPackageName: source.androidPackageName || "",
        androidAppLaunchUrl: source.androidAppLaunchUrl || "",
        playStoreFallbackUrl: source.playStoreFallbackUrl || source.playStoreUrl || ""
    }) === true;
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
            lockLegacyThailandBankEditor(card);

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
    bindDeepLinkTesterActions();
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

function bindDeepLinkTesterActions() {
    document.querySelectorAll(".pm-deeplink-tester").forEach(tester => {
        const card = tester.closest(".payment-method-card");
        if (!card || !isAdminOwner()) {
            tester.remove();
            return;
        }

        initializeDeepLinkTesterState(card);

        tester.querySelector(".pm-deeplink-test-preset")?.addEventListener("change", event => {
            const candidateInput = tester.querySelector(".pm-deeplink-test-candidate");
            if (candidateInput && event.target.value) candidateInput.value = event.target.value;
            resetDeepLinkConfirmation(card, { keepCandidate: true });
            renderDeepLinkTesterStatus(card);
        });

        tester.querySelector(".pm-deeplink-test-candidate")?.addEventListener("input", () => {
            resetDeepLinkConfirmation(card, { keepCandidate: true });
            renderDeepLinkTesterStatus(card);
        });

        tester.querySelector('[data-action="test-deeplink-launch"]')?.addEventListener("click", () => testDeepLinkLaunch(card));
        tester.querySelector('[data-action="confirm-deeplink-opened"]')?.addEventListener("click", () => confirmDeepLinkResult(card, "confirmed"));
        tester.querySelector('[data-action="reject-deeplink-opened"]')?.addEventListener("click", () => confirmDeepLinkResult(card, "rejected"));
        tester.querySelector('[data-action="wrong-deeplink-opened"]')?.addEventListener("click", () => confirmDeepLinkResult(card, "wrong_app"));
        tester.querySelector('[data-action="save-deeplink-to-editor"]')?.addEventListener("click", () => saveTestedDeepLinkToEditor(card));
        tester.querySelector('[data-action="clear-deeplink-test"]')?.addEventListener("click", () => clearDeepLinkTester(card));
    });
}

function initializeDeepLinkTesterState(card) {
    if (!card.__deepLinkTesterState) {
        card.__deepLinkTesterState = {
            candidate: "",
            status: "Not tested",
            lastTestAt: "",
            launchAttempted: false,
            possibleHandoff: false,
            ownerConfirmed: false,
            saved: false,
            browserNote: "Custom scheme success cannot be detected reliably.",
            cleanup: null
        };
    }
    renderDeepLinkTesterStatus(card);
}

function resetDeepLinkConfirmation(card, options = {}) {
    const state = initializeAndGetDeepLinkTesterState(card);
    if (typeof state.cleanup === "function") state.cleanup();
    const candidate = options.keepCandidate
        ? card?.querySelector(".pm-deeplink-test-candidate")?.value || ""
        : "";
    Object.assign(state, {
        candidate,
        status: "Not tested",
        lastTestAt: "",
        launchAttempted: false,
        possibleHandoff: false,
        ownerConfirmed: false,
        saved: false,
        browserNote: "Custom scheme success cannot be detected reliably.",
        cleanup: null
    });
}

function initializeAndGetDeepLinkTesterState(card) {
    initializeDeepLinkTesterState(card);
    return card.__deepLinkTesterState;
}

function clearDeepLinkTester(card) {
    if (!isAdminOwner()) return;
    const tester = card?.querySelector(".pm-deeplink-tester");
    const preset = tester?.querySelector(".pm-deeplink-test-preset");
    const candidate = tester?.querySelector(".pm-deeplink-test-candidate");
    if (preset) preset.value = "";
    if (candidate) candidate.value = "";
    resetDeepLinkConfirmation(card);
    renderDeepLinkTesterStatus(card);
}

function validateDeepLinkCandidate(value) {
    const raw = String(value || "");
    const trimmed = raw.trim();
    if (!trimmed) return { ok: false, message: "Enter a candidate launch URL." };
    if (raw !== trimmed || /\s/.test(trimmed) || /[\u0000-\u001f\u007f]/.test(trimmed)) {
        return { ok: false, message: "Candidate must not contain whitespace or control characters." };
    }

    const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (!schemeMatch) return { ok: false, message: "Use a custom scheme:// or HTTPS URL." };

    const scheme = schemeMatch[1].toLowerCase();
    if (["javascript", "data", "file", "blob"].includes(scheme)) {
        return { ok: false, message: `${scheme}: URLs are not allowed.` };
    }

    if (scheme === "http") {
        return { ok: false, message: "Use HTTPS for universal links." };
    }

    if (scheme === "https") {
        try {
            const url = new URL(trimmed);
            if (!url.hostname) return { ok: false, message: "HTTPS URL must include a host." };
        } catch (error) {
            return { ok: false, message: "Malformed HTTPS URL." };
        }
    }

    return { ok: true, value: trimmed, scheme };
}

function getDeepLinkDeviceLabel() {
    const nav = window.navigator || {};
    const ua = nav.userAgent || "";
    const platform = nav.platform || "Unknown platform";
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && nav.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const browser = /Safari/i.test(ua) && !/Chrome|CriOS|Edg/i.test(ua)
        ? "Safari"
        : /Chrome|CriOS/i.test(ua)
            ? "Chrome"
            : "Browser";
    const device = isIOS ? "iOS" : isAndroid ? "Android" : "Desktop";
    return `${device} · ${browser} · ${platform}`;
}

function getDeepLinkCandidate(card) {
    return card?.querySelector(".pm-deeplink-test-candidate")?.value || "";
}

function updateDeepLinkTesterButtons(card) {
    const tester = card?.querySelector(".pm-deeplink-tester");
    const state = card?.__deepLinkTesterState || {};
    const hasAttempt = state.launchAttempted === true;
    const confirmed = state.ownerConfirmed === true;
    const setDisabled = (selector, disabled) => {
        const button = tester?.querySelector(selector);
        if (button) button.disabled = disabled;
    };
    setDisabled('[data-action="confirm-deeplink-opened"]', !hasAttempt);
    setDisabled('[data-action="reject-deeplink-opened"]', !hasAttempt);
    setDisabled('[data-action="wrong-deeplink-opened"]', !hasAttempt);
    setDisabled('[data-action="save-deeplink-to-editor"]', !confirmed);
}

function renderDeepLinkTesterStatus(card) {
    const tester = card?.querySelector(".pm-deeplink-tester");
    const panel = tester?.querySelector(".pm-deeplink-status");
    if (!panel) return;

    const state = card.__deepLinkTesterState || {};
    const candidate = state.candidate || getDeepLinkCandidate(card);
    panel.innerHTML = `
        <strong>${escapeAdminHTML(state.status || "Not tested")}</strong>
        <ul>
            <li>Candidate value: ${escapeAdminHTML(candidate || "Not set")}</li>
            <li>Device/platform: ${escapeAdminHTML(getDeepLinkDeviceLabel())}</li>
            <li>Last test time: ${escapeAdminHTML(state.lastTestAt || "Not tested")}</li>
            <li>Launch attempted: ${state.launchAttempted ? "Yes" : "No"}</li>
            <li>Possible handoff detected: ${state.possibleHandoff ? "Yes" : "No"}</li>
            <li>Owner confirmed: ${state.ownerConfirmed ? "Yes" : "No"}</li>
            <li>Saved: ${state.saved ? "Saved to editor fields; normal Payment Method Save is still required." : "Not saved"}</li>
            <li>Browser note: ${escapeAdminHTML(state.browserNote || "Custom scheme success cannot be detected reliably.")}</li>
        </ul>
    `;
    updateDeepLinkTesterButtons(card);
}

function testDeepLinkLaunch(card) {
    if (!isAdminOwner()) {
        showAdminToast?.("Deep Link Tester is OWNER-only.", "error");
        return;
    }

    const state = initializeAndGetDeepLinkTesterState(card);
    const validation = validateDeepLinkCandidate(getDeepLinkCandidate(card));
    if (!validation.ok) {
        Object.assign(state, {
            candidate: getDeepLinkCandidate(card),
            status: "Unsupported or inconclusive on this device",
            launchAttempted: false,
            possibleHandoff: false,
            ownerConfirmed: false,
            saved: false,
            browserNote: validation.message
        });
        renderDeepLinkTesterStatus(card);
        showAdminToast?.(validation.message, "error");
        return;
    }

    if (typeof state.cleanup === "function") state.cleanup();

    const now = new Date();
    Object.assign(state, {
        candidate: validation.value,
        status: "Launch attempted",
        lastTestAt: now.toLocaleString(),
        launchAttempted: true,
        possibleHandoff: false,
        ownerConfirmed: false,
        saved: false,
        browserNote: validation.scheme === "https"
            ? "HTTPS universal links are opened in a new tab when possible to preserve this editor."
            : "Custom scheme handoff signals are hints only; owner confirmation is required."
    });

    let completed = false;
    const markPossibleHandoff = reason => {
        if (completed) return;
        state.possibleHandoff = true;
        state.status = "Possible app handoff detected";
        state.browserNote = `${reason}; this is not proof that the correct banking app opened.`;
        renderDeepLinkTesterStatus(card);
    };
    const cleanup = () => {
        completed = true;
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("pagehide", onPageHide);
        document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    const onBlur = () => markPossibleHandoff("Browser lost focus");
    const onPageHide = () => markPossibleHandoff("Page hide was observed");
    const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") markPossibleHandoff("Page visibility changed");
    };

    state.cleanup = cleanup;
    window.addEventListener("blur", onBlur, { once: true });
    window.addEventListener("pagehide", onPageHide, { once: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    renderDeepLinkTesterStatus(card);

    window.setTimeout(() => {
        if (state.possibleHandoff || !state.launchAttempted) return;
        state.status = "No handoff detected";
        state.browserNote = "No browser handoff signal was observed. This result is inconclusive, especially on desktop.";
        renderDeepLinkTesterStatus(card);
    }, 1800);

    try {
        if (validation.scheme === "https") {
            const opened = window.open(validation.value, "_blank", "noopener,noreferrer");
            if (!opened) {
                state.status = "Unsupported or inconclusive on this device";
                state.browserNote = "Popup was blocked. Try a direct user gesture on a real device.";
                renderDeepLinkTesterStatus(card);
            }
        } else {
            window.location.href = validation.value;
        }
    } catch (error) {
        state.status = "Unsupported or inconclusive on this device";
        state.browserNote = error?.message || "Browser blocked the launch attempt.";
        renderDeepLinkTesterStatus(card);
    }
}

function confirmDeepLinkResult(card, result) {
    if (!isAdminOwner()) return;
    const state = initializeAndGetDeepLinkTesterState(card);
    if (!state.launchAttempted) {
        showAdminToast?.("Test the candidate before confirming.", "error");
        return;
    }

    if (result === "confirmed") {
        state.ownerConfirmed = true;
        state.status = "Owner confirmed";
        state.browserNote = "Owner confirmed that the correct banking app opened. Save only populates editor fields.";
    } else {
        state.ownerConfirmed = false;
        state.saved = false;
        state.status = result === "wrong_app" ? "Unsupported or inconclusive on this device" : "No handoff detected";
        state.browserNote = result === "wrong_app"
            ? "A different app opened. Run a new test before saving."
            : "Owner reported that the banking app did not open. Run a new test before saving.";
    }
    renderDeepLinkTesterStatus(card);
}

function selectedDeepLinkTargets(card) {
    const value = card?.querySelector(".pm-deeplink-test-target")?.value || "official";
    if (value === "all") return Object.values(ADMIN_DEEPLINK_TEST_TARGETS);
    return [ADMIN_DEEPLINK_TEST_TARGETS[value] || ADMIN_DEEPLINK_TEST_TARGETS.official];
}

async function confirmDeepLinkOverwrite(changes) {
    if (!changes.length) return true;
    const message = `Overwrite existing launch URL fields?\n\n${changes.map(change =>
        `${change.label}\nOld: ${change.oldValue || "(empty)"}\nNew: ${change.newValue}`
    ).join("\n\n")}`;

    if (window.AZIEL_ADMIN_UI?.confirm) {
        return window.AZIEL_ADMIN_UI.confirm({
            title: "Overwrite launch URL?",
            message,
            confirmText: "Overwrite",
            cancelText: "Cancel",
            tone: "warning"
        });
    }

    return window.confirm(message);
}

async function saveTestedDeepLinkToEditor(card) {
    if (!isAdminOwner()) {
        showAdminToast?.("Deep Link Tester is OWNER-only.", "error");
        return;
    }

    const state = initializeAndGetDeepLinkTesterState(card);
    if (!state.ownerConfirmed) {
        showAdminToast?.("Confirm the correct app opened before saving to editor fields.", "error");
        return;
    }

    const validation = validateDeepLinkCandidate(state.candidate || getDeepLinkCandidate(card));
    if (!validation.ok) {
        showAdminToast?.(validation.message, "error");
        return;
    }

    const targets = selectedDeepLinkTargets(card);
    const changes = targets.map(target => {
        const input = card?.querySelector(target.selector);
        return {
            ...target,
            input,
            oldValue: input?.value || "",
            newValue: validation.value
        };
    }).filter(change => change.input);

    const overwrites = changes.filter(change => change.oldValue && change.oldValue !== change.newValue);
    if (!(await confirmDeepLinkOverwrite(overwrites))) return;

    changes.forEach(change => {
        change.input.value = change.newValue;
        change.input.dispatchEvent(new Event("input", { bubbles: true }));
        change.input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    state.saved = true;
    state.status = "Saved to payment method";
    state.browserNote = "Saved to editor fields only. Use the normal Payment Method Save button to write to the database.";
    renderDeepLinkTesterStatus(card);
    refreshPaymentEditorVisibility(card);
    updateInlineCardPreview(card);
    updateChecklistPreview(card);
    showAdminToast?.("Launch URL copied to editor fields. Save the payment method to publish it.", "success");
}

function updateChecklistPreview(card) {
    const preview = card?.querySelector(".pm-checklist-preview ol");
    if (!preview) return;
    preview.innerHTML = renderChecklistPreview(collectChecklistSteps(card), collectAdminPaymentFormState(card));
}

function bindPaymentPreviewInputs() {
    document.querySelectorAll(".payment-method-card input, .payment-method-card select, .payment-method-card textarea").forEach(input => {
        input.addEventListener("input", () => {
            if (input.closest(".pm-deeplink-tester")) return;
            const card = input.closest(".payment-method-card");
            refreshPaymentEditorVisibility(card);
            updateInlineCardPreview(card);
            updateChecklistPreview(card);
        });
        input.addEventListener("change", () => {
            if (input.closest(".pm-deeplink-tester")) return;
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
    if (card.dataset.legacyThaiBank === "true") {
        showAdminToast?.("Legacy bank records are hidden from storefront. Manage this bank under PromptPay Supported Banking Apps.", "info");
        return;
    }

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
	        androidPackageName: card.querySelector(".pm-android-package-name")?.value || "",
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
        bankLaunchers: collectBankLaunchers(card),
        sortOrder: Number(card.querySelector(".pm-sort-order")?.value || 0)
    };

    if (card.dataset.key === "promptpay" && payload.provider === "promptpay" && payload.region === "TH") {
        payload.method = payload.method || "PromptPay QR";
        payload.paymentType = "manual";
        payload.qrMode = "aziel_promptpay_dynamic";
        payload.openAppMode = "bank_chooser";
        payload.appLaunchMode = "APP_ONLY";
        payload.confirmationMode = "manual_admin";
        payload.receiptUploadEnabled = true;
        payload.slipRequired = true;
        payload.enableSaveQr = true;
        payload.enableOpenApp = true;
        payload.enableChecklist = true;
        payload.dynamicQrSupported = true;
        payload.amountPrefillSupported = true;
        payload.referenceSupported = true;
        payload.galleryScanSupported = true;
        payload.autoVerificationSupported = false;
        payload.webhookSupported = false;
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
        configurationKind: card?.dataset.configurationKind || "MANUAL_QR",
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
	        androidPackageName: card?.querySelector(".pm-android-package-name")?.value || "",
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
        bankLaunchers: collectBankLaunchers(card),
        checklistSteps: collectChecklistSteps(card)
    };
}

function collectBankLaunchers(card) {
    return Array.from(card?.querySelectorAll(".pm-bank-launcher-row") || [])
        .map(row => ({
            key: row.getAttribute("data-bank-launcher") || "",
            displayName: row.querySelector(".pm-bank-launcher-name")?.value || "",
            logoUrl: row.querySelector(".pm-bank-launcher-logo")?.value || "",
            enabled: row.querySelector(".pm-bank-launcher-enabled")?.checked || false,
            sortOrder: Number(row.querySelector(".pm-bank-launcher-sort")?.value || 0),
            androidPackageName: row.querySelector(".pm-bank-launcher-android-package")?.value || "",
            androidAppLaunchUrl: row.querySelector(".pm-bank-launcher-android-url")?.value || "",
            playStoreFallbackUrl: row.querySelector(".pm-bank-launcher-play-store")?.value || "",
            iosAppLaunchUrl: row.querySelector(".pm-bank-launcher-ios-url")?.value || "",
            appStoreFallbackUrl: row.querySelector(".pm-bank-launcher-app-store")?.value || "",
            verificationStatus: row.querySelector(".pm-bank-launcher-status")?.value || "verified",
            operatorNotes: row.querySelector(".pm-bank-launcher-notes")?.value || ""
        }))
        .filter(item => item.key && item.key !== "kplus");
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
            { key: "promptpay", label: "PromptPay QR", paymentType: "manual" },
            { key: "scb", label: "SCB", paymentType: "deeplink" },
            { key: "bangkok_bank", label: "Bangkok Bank", paymentType: "deeplink" },
            { key: "kplus", label: "K PLUS", paymentType: "deeplink" },
            { key: "krungsri", label: "Krungsri", paymentType: "deeplink" },
            { key: "krungthai", label: "Krungthai NEXT", paymentType: "deeplink" },
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
    if (card?.dataset.legacyThaiBank === "true") {
        showAdminToast?.("Launcher logos are managed under PromptPay Supported Banking Apps.", "info");
        return;
    }
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
        return "PromptPay QR with manual receipt upload and bank app chooser.";
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
    const kind = state.configurationKind || "MANUAL_QR";
    const isPromptPay = kind === "AUTOMATIC_PROVIDER";
    const isPromptPayDynamic = kind === "PROMPTPAY_DYNAMIC";
    const isWallet = kind === "AZIEL_WALLET";
    const isBankApp = kind === "MANUAL_BANK_APP";
    const isManualQr = kind === "MANUAL_QR";
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

    if (accountSection) accountSection.hidden = !(isManualQr || isBankApp);
    if (qrSection) qrSection.hidden = !(isManualQr || isPromptPayDynamic);
    const bankAppSection = card.querySelector(".payment-bank-app-section");
    if (bankAppSection) bankAppSection.hidden = !isBankApp;

    const activeQrMode = card.querySelector(".pm-qr-mode")?.value || "uploaded_static";
    staticQrRows.forEach(el => {
        el.style.display = activeQrMode === "uploaded_static" ? "" : "none";
    });
    card.querySelectorAll(".pm-promptpay-dynamic-field").forEach(el => {
        el.hidden = !isPromptPayDynamic;
    });

    const enableOpenApp = card.querySelector(".pm-enable-open-app")?.checked === true;
    const openAppMode = card.querySelector(".pm-open-app-mode")?.value || "disabled";
    const appLaunchMode = card.querySelector(".pm-app-launch-mode")?.value || "OFFICIAL_PAYMENT_DEEPLINK";
    const intentPreview = card.querySelector(".pm-android-intent-preview");
    if (intentPreview) {
        intentPreview.value = buildAdminAndroidIntentPreview(collectAdminPaymentFormState(card));
    }
    card.querySelectorAll(".pm-app-launch-field").forEach(el => {
        el.hidden = !enableOpenApp || openAppMode !== "direct" || appLaunchMode !== "APP_ONLY";
    });
    card.querySelectorAll(".pm-official-deeplink-field").forEach(el => {
        el.hidden = !enableOpenApp || openAppMode !== "direct" || appLaunchMode === "APP_ONLY";
    });

    const appName = card.querySelector(".pm-app-name")?.value || "Banking App";
    const formState = collectAdminPaymentFormState(card);
    const openWarning = card.querySelector(".pm-open-app-warning");
    if (openWarning) {
        const canOpen = openAppMode === "disabled" ||
            openAppMode === "bank_chooser" ||
            (Boolean(card.querySelector(".pm-deeplink")?.value || card.querySelector(".pm-ios-app-launch")?.value || card.querySelector(".pm-app-store")?.value || hasAdminAndroidLaunchCapability(formState)) && appName);
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
