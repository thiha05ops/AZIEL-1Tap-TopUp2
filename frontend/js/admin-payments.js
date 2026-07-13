// frontend/js/admin-payments.js
// AZIEL Admin Payment Methods Manager V2.5

let adminPaymentMethods = [];
let adminPaymentsInitialized = false;

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
        const data = await adminFetch("/api/payment-methods");

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

    if (!methods.length) {
        box.innerHTML = `<div class="admin-list-empty">No payment methods found.</div>`;
        return;
    }

    box.innerHTML = methods.map(method => {
        const qr = method.uploadedQrImage || method.qrImageUrl || method.qrImage || "";
        const qrUrl = getAdminPaymentUploadUrl(qr);
        const type = method.paymentType || "manual";
        const provider = method.provider || "manual";

        return `
            <div class="payment-method-card" data-id="${escapeAdminHTML(method._id)}">
                <div class="payment-header">
                    <div>
                        <h4>${escapeAdminHTML(method.method || "-")} <small>${escapeAdminHTML(method.region || "")}</small></h4>
                        <p>${getPaymentTypeDescription(method.key, type, provider)}</p>
                    </div>

                    <label class="switch">
                        <input class="pm-enabled" type="checkbox" ${method.enabled ? "checked" : ""}>
                        <span>Enabled</span>
                    </label>
                </div>

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
                        <small>Bank / wallet number users can copy</small>
                    </div>
                    <input class="pm-number" type="text" value="${escapeAdminHTML(method.accountNumber || "")}">
                </div>

                <div class="settings-row">
                    <div>
                        <label>QR Image URL</label>
                        <small>Manual QR fallback. PromptPay auto uses Omise QR.</small>
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

                <div class="settings-row">
                    <div>
                        <label>Maintenance Message</label>
                        <small>Show warning or delay note to users</small>
                    </div>
                    <textarea class="pm-message">${escapeAdminHTML(method.maintenanceMessage || "")}</textarea>
                </div>

                <div class="settings-row">
                    <div>
                        <label>Payment Type</label>
                        <small>PromptPay = auto, SCB = deeplink, MM wallets = manual</small>
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
                        <label>Provider</label>
                        <small>Provider used by frontend/backend payment engine</small>
                    </div>
                    <select class="pm-provider">
                        <option value="manual" ${provider === "manual" ? "selected" : ""}>Manual</option>
                        <option value="omise" ${provider === "omise" ? "selected" : ""}>Omise</option>
                        <option value="scb" ${provider === "scb" ? "selected" : ""}>SCB</option>
                        <option value="kplus" ${provider === "kplus" ? "selected" : ""}>K PLUS</option>
                        <option value="bbl" ${provider === "bbl" ? "selected" : ""}>Bangkok Bank</option>
                        <option value="ktb" ${provider === "ktb" ? "selected" : ""}>Krungthai NEXT</option>
                        <option value="krungsri" ${provider === "krungsri" ? "selected" : ""}>Krungsri</option>
                        <option value="ttb" ${provider === "ttb" ? "selected" : ""}>TTB</option>
                        <option value="wallet" ${provider === "wallet" ? "selected" : ""}>AZIEL Wallet</option>
                    </select>
                </div>

                ${method.key === "promptpay" ? `
                    <div class="payment-method-hint">
                        <strong>PromptPay Auto</strong>
                        <span>Use paymentType <b>auto</b> and provider <b>omise</b>. QR is generated by backend/Omise webhook flow.</span>
                    </div>
                ` : ""}

                ${method.key === "scb" ? `
                    <div class="payment-method-hint">
                        <strong>SCB Deeplink</strong>
                        <span>Use paymentType <b>deeplink</b> and provider <b>scb</b>. Add account name/number for copy flow.</span>
                    </div>
                ` : ""}

                <button class="save-payment-btn" type="button" data-action="save-payment-method" data-id="${escapeAdminHTML(method._id)}">
                    Save ${escapeAdminHTML(method.method || "Payment")}
                </button>
            </div>
        `;
    }).join("");

    bindAdminPaymentActions();
}

function bindAdminPaymentActions() {
    document.querySelectorAll('[data-action="save-payment-method"]').forEach(btn => {
        btn.addEventListener("click", () => saveAdminPaymentMethod(btn.dataset.id));
    });
    document.querySelectorAll(".pm-provider").forEach(select => {

        select.addEventListener("change", e => {

            autoPaymentConfig(
                e.target.closest(".payment-method-card")
            );

        });

    });

    document.querySelectorAll(".pm-type").forEach(select => {

        select.addEventListener("change", e => {

            autoPaymentConfig(
                e.target.closest(".payment-method-card")
            );

        });

    });

    document.querySelectorAll(".payment-method-card")
        .forEach(card => {

            autoPaymentConfig(card);

        });

    document.querySelectorAll('[data-action="upload-payment-qr"]').forEach(btn => {
        btn.addEventListener("click", () => uploadAdminPaymentQR(btn.dataset.id));
    });
}

async function saveAdminPaymentMethod(id) {
    const card = document.querySelector(`.payment-method-card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;

    const payload = {
        enabled: card.querySelector(".pm-enabled")?.checked || false,
        accountName: card.querySelector(".pm-name")?.value || "",
        accountNumber: card.querySelector(".pm-number")?.value || "",
        qrImageUrl: card.querySelector(".pm-qr")?.value || "",
        uploadedQrImage: card.querySelector(".pm-uploaded-qr")?.value || "",
        uploadedQrImageEvidence: parseAdminPaymentEvidence(card.querySelector(".pm-uploaded-qr-evidence")?.value),
        maintenanceMessage: card.querySelector(".pm-message")?.value || "",
        paymentType: card.querySelector(".pm-type")?.value || "manual",
        provider: card.querySelector(".pm-provider")?.value || "manual"
    };

    if (payload.provider === "omise") {
        payload.paymentType = "auto";
    }

    if (payload.provider === "scb") {
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

function getPaymentTypeDescription(key, type, provider) {
    if (key === "promptpay" || provider === "omise") {
        return "PromptPay auto payment via Omise webhook.";
    }

    if (type === "deeplink") {
        return "Bank app open + account copy + slip upload.";
    }

    if (type === "wallet") {
        return "Internal AZIEL Wallet payment.";
    }

    return "Manual QR / account transfer with slip upload.";
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

    const provider =
        card.querySelector(".pm-provider")
            .value
            .trim()
            .toLowerCase();

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

    if (provider === "omise") {

        type.value = "auto";

        qrUrl.style.display = "none";
        qrUpload.style.display = "none";
        uploadBtn.style.display = "none";

    }

    else if (provider === "scb") {

        type.value = "deeplink";

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

window.loadAdminPaymentMethods = loadAdminPaymentMethods;
