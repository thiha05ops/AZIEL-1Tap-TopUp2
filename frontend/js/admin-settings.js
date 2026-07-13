// frontend/js/admin-settings.js
// AZIEL Admin V2.5 Settings + Payment Methods

let allPaymentMethods = [];

document.addEventListener("DOMContentLoaded", () => {
    initSettingsTabs();
    initSettingsSave();
});

function initSettingsTabs() {
    document.querySelectorAll(".settings-tab[data-settings-tab]").forEach(tab => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.settingsTab;

            document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".settings-panel").forEach(p => p.classList.remove("active"));

            tab.classList.add("active");
            document.querySelector(`[data-settings-panel="${target}"]`)?.classList.add("active");
        });
    });
}

function initSettingsSave() {
    document.getElementById("saveSettingsBtn")?.addEventListener("click", saveSettings);
}

async function loadPaymentMethods() {
    const box = document.getElementById("paymentMethodsContainer");
    if (!box) return;

    box.innerHTML = `<div class="admin-list-empty">Loading payment methods...</div>`;

    const data = await adminFetch("/api/payment-methods");

    if (!data || !data.success) {
        box.innerHTML = `<div class="admin-list-empty">${escapeHTML(data?.message || "Failed to load payment methods")}</div>`;
        return;
    }

    allPaymentMethods = data.methods || [];
    renderPaymentMethods(allPaymentMethods);
}

function renderPaymentMethods(methods) {
    const box = document.getElementById("paymentMethodsContainer");
    if (!box) return;

    if (!methods.length) {
        box.innerHTML = `<div class="admin-list-empty">No payment methods found.</div>`;
        return;
    }

    box.innerHTML = `
        <div class="admin-filter-bar">
            <select id="paymentRegionFilter">
                <option value="all">All Regions</option>
                <option value="MM">Myanmar</option>
                <option value="TH">Thailand</option>
            </select>
        </div>

        <div id="paymentCards">
            ${methods.map(paymentCardHTML).join("")}
        </div>
    `;

    document.getElementById("paymentRegionFilter")?.addEventListener("change", e => {
        const region = e.target.value;
        const filtered = region === "all"
            ? allPaymentMethods
            : allPaymentMethods.filter(m => m.region === region);

        document.getElementById("paymentCards").innerHTML =
            filtered.map(paymentCardHTML).join("");

        bindPaymentActions();
    });

    bindPaymentActions();
}

function paymentCardHTML(method) {
    const qr = method.uploadedQrImage || method.qrImageUrl || method.qrImage || "";
    const qrUrl = getAdminSettingsPaymentUploadUrl(qr);

    return `
        <div class="payment-method-card" data-id="${escapeHTML(method._id)}">
            <div class="payment-header">
                <h4>
                    ${escapeHTML(method.method || "-")}
                    <small>${escapeHTML(method.region || "")}</small>
                </h4>

                <label class="switch">
                    <input class="pm-enabled" type="checkbox" ${method.enabled ? "checked" : ""}>
                    <span>${method.enabled ? "Enabled" : "Disabled"}</span>
                </label>
            </div>

            <label>Account Name</label>
            <input class="pm-name" type="text" value="${escapeHTML(method.accountName || "")}">

            <label>Account Number</label>
            <input class="pm-number" type="text" value="${escapeHTML(method.accountNumber || "")}">

            <label>QR Image URL</label>
            <input class="pm-qr" type="text" value="${escapeHTML(method.qrImageUrl || method.qrImage || "")}">

            <label>Upload QR Image</label>
            <input class="pm-file" type="file" accept="image/*">

            <button class="upload-qr-btn" type="button" data-action="upload-qr" data-id="${escapeHTML(method._id)}">
                Upload QR Photo
            </button>

            <input class="pm-uploaded-qr" type="text" value="${escapeHTML(method.uploadedQrImage || "")}" placeholder="/uploads/payments/qr.png">
            <input class="pm-uploaded-qr-evidence" type="hidden" value="${escapeHTML(JSON.stringify(method.uploadedQrImageEvidence || null))}">

            <div class="pm-preview-wrap">
                ${qrUrl && !isAdminUploadedImageFailed(qrUrl)
            ? `<img class="pm-qr-preview" src="${escapeHTML(qrUrl)}" data-src="${escapeHTML(qrUrl)}" alt="QR Preview" onerror="handleAdminSettingsImageError(this)">`
            : qrUrl
                ? `<div class="pm-empty-preview">QR image unavailable</div>`
                : `<div class="pm-empty-preview">No QR preview</div>`
        }
            </div>

            <label>Maintenance Message</label>
            <textarea class="pm-message">${escapeHTML(method.maintenanceMessage || "")}</textarea>

            <label>Payment Type</label>
            <select class="pm-type">
                <option value="manual" ${method.paymentType === "manual" ? "selected" : ""}>Manual Payment</option>
                <option value="auto" ${method.paymentType === "auto" ? "selected" : ""}>Auto Payment</option>
            </select>

            <label>Provider</label>
            <select class="pm-provider">
                <option value="manual" ${method.provider === "manual" ? "selected" : ""}>Manual</option>
                <option value="kbzpay" ${method.provider === "kbzpay" ? "selected" : ""}>KBZPay API</option>
                <option value="wavepay" ${method.provider === "wavepay" ? "selected" : ""}>WavePay API</option>
                <option value="promptpay" ${method.provider === "promptpay" ? "selected" : ""}>PromptPay</option>
                <option value="omise" ${method.provider === "omise" ? "selected" : ""}>Omise</option>
                <option value="scb" ${method.provider === "scb" ? "selected" : ""}>SCB</option>
                <option value="aya" ${method.provider === "aya" ? "selected" : ""}>AYA Pay</option>
            </select>

            <button class="save-payment-btn" type="button" data-action="save-payment" data-id="${escapeHTML(method._id)}">
                Save ${escapeHTML(method.method || "Payment")}
            </button>
        </div>
    `;
}

function bindPaymentActions() {
    document.querySelectorAll('[data-action="save-payment"]').forEach(btn => {
        btn.addEventListener("click", () => savePaymentMethod(btn.dataset.id));
    });

    document.querySelectorAll('[data-action="upload-qr"]').forEach(btn => {
        btn.addEventListener("click", () => uploadPaymentQR(btn.dataset.id));
    });

    document.querySelectorAll(".pm-enabled").forEach(input => {
        input.addEventListener("change", () => {
            const span = input.closest(".switch")?.querySelector("span");
            if (span) span.innerText = input.checked ? "Enabled" : "Disabled";
        });
    });

    document.querySelectorAll(".pm-file").forEach(input => {
        input.addEventListener("change", () => previewLocalQR(input));
    });
}

function previewLocalQR(input) {
    const file = input.files?.[0];
    if (!file) return;

    const card = input.closest(".payment-method-card");
    const wrap = card?.querySelector(".pm-preview-wrap");
    if (!wrap) return;

    const url = URL.createObjectURL(file);

    wrap.innerHTML = `<img class="pm-qr-preview" src="${url}" alt="QR Preview">`;
}

function getAdminSettingsPaymentUploadUrl(path) {
    return getAdminUploadedImageUrl(path, { folder: "payments" });
}

function handleAdminSettingsImageError(img) {
    const src = img?.dataset?.src || img?.currentSrc || img?.src || "";
    markAdminUploadedImageFailed(src);

    const fallback = document.createElement("div");
    fallback.className = "pm-empty-preview";
    fallback.textContent = "QR image unavailable";
    img.replaceWith(fallback);
}

async function savePaymentMethod(id) {
    const card = document.querySelector(`.payment-method-card[data-id="${id}"]`);
    if (!card) return;

    const payload = {
        enabled: card.querySelector(".pm-enabled")?.checked || false,
        accountName: card.querySelector(".pm-name")?.value.trim() || "",
        accountNumber: card.querySelector(".pm-number")?.value.trim() || "",
        qrImageUrl: card.querySelector(".pm-qr")?.value.trim() || "",
        uploadedQrImage: card.querySelector(".pm-uploaded-qr")?.value.trim() || "",
        uploadedQrImageEvidence: parseAdminSettingsPaymentEvidence(card.querySelector(".pm-uploaded-qr-evidence")?.value),
        maintenanceMessage: card.querySelector(".pm-message")?.value.trim() || "",
        paymentType: card.querySelector(".pm-type")?.value || "manual",
        provider: card.querySelector(".pm-provider")?.value || "manual"
    };

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
    await loadPaymentMethods();
}

async function uploadPaymentQR(id) {
    const card = document.querySelector(`.payment-method-card[data-id="${id}"]`);
    const file = card?.querySelector(".pm-file")?.files?.[0];

    if (!file) {
        showAdminToast?.("Please choose QR image", "error");
        return;
    }

    const formData = new FormData();
    formData.append("qr", file);

    const data = await adminFetch("/api/admin/upload-payment-qr", {
        method: "POST",
        body: formData
    });

    if (!data || !data.success) {
        showAdminToast?.(data?.message || "QR upload failed", "error");
        return;
    }

    const uploadedInput = card.querySelector(".pm-uploaded-qr");
    if (uploadedInput) uploadedInput.value = data.image;

    const evidenceInput = card.querySelector(".pm-uploaded-qr-evidence");
    if (evidenceInput) evidenceInput.value = JSON.stringify(data.evidence || null);

    const wrap = card.querySelector(".pm-preview-wrap");
    if (wrap) {
        wrap.innerHTML = `<img class="pm-qr-preview" src="${escapeHTML(data.image)}" alt="QR Preview" onerror="handleAdminSettingsImageError(this)">`;
    }

    showAdminToast?.("QR uploaded. Click Save payment method.", "success");
}

function parseAdminSettingsPaymentEvidence(value) {
    if (!value) return undefined;

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : undefined;
    } catch (error) {
        return undefined;
    }
}

async function saveSettings() {
    const payload = {
        siteName: document.getElementById("siteName")?.value || "",
        announcement: document.getElementById("announcement")?.value || "",
        defaultRegion: document.getElementById("defaultRegion")?.value || "MM",
        supportEmail: document.getElementById("supportEmail")?.value || "",
        telegramLink: document.getElementById("telegramLink")?.value || "",
        maintenanceMode: document.getElementById("maintenanceMode")?.checked || false,
        supportEnabled: document.getElementById("supportEnabled")?.checked || false,
        liveChatEnabled: document.getElementById("liveChatEnabled")?.checked || false,
        registrationEnabled: document.getElementById("registrationEnabled")?.checked || true
    };

    const data = await adminFetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!data || !data.success) {
        showAdminToast?.(data?.message || "Settings save failed", "error");
        return;
    }

    showAdminToast?.("Settings saved successfully", "success");
}

window.loadPaymentMethods = loadPaymentMethods;
