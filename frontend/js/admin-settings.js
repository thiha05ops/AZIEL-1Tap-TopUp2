document.addEventListener("DOMContentLoaded", () => {
    loadPaymentMethods();
});

async function loadPaymentMethods() {
    const box = document.getElementById("paymentMethodsContainer");
    if (!box) return;

    const res = await fetch("/api/payment-methods");
    const data = await res.json();

    if (!data.success) {
        box.innerHTML = "<p>Failed to load payment methods.</p>";
        return;
    }

    box.innerHTML = data.methods.map(method => {
        const qr =
            method.uploadedQrImage ||
            method.qrImageUrl ||
            method.qrImage ||
            "";

        return `
            <div class="payment-method-card" data-id="${method._id}">
                <div class="payment-header">
                    <h4>${method.method} <small>${method.region}</small></h4>

                    <label class="switch">
                        <input class="pm-enabled" type="checkbox" ${method.enabled ? "checked" : ""}>
                        <span>Enabled</span>
                    </label>
                </div>

                <label>Account Name</label>
                <input class="pm-name" type="text" placeholder="Account Name" value="${method.accountName || ""}">

                <label>Account Number</label>
                <input class="pm-number" type="text" placeholder="Account Number" value="${method.accountNumber || ""}">

                <label>QR Image URL</label>
                <input class="pm-qr" type="text" placeholder="https://example.com/qr.png" value="${method.qrImageUrl || method.qrImage || ""}">

                <label>Uploaded QR Image Path</label>
                <input class="pm-file" type="file" accept="image/*">

<button
    class="upload-qr-btn"
    type="button"
    onclick="uploadPaymentQR('${method._id}')">
    Upload QR Photo
</button>


                <input class="pm-uploaded-qr" type="text" placeholder="/uploads/payments/kbz.png" value="${method.uploadedQrImage || ""}">

                ${qr
                ? `<img class="pm-qr-preview" src="${qr}" alt="QR Preview">`
                : `<div class="pm-empty-preview">No QR preview</div>`
            }

                <label>Maintenance Message</label>
                <textarea class="pm-message" placeholder="Maintenance Message">${method.maintenanceMessage || ""}</textarea>

                <label>Payment Type</label>
                <select class="pm-type">
                    <option value="manual" ${method.paymentType === "manual" ? "selected" : ""}>Manual Payment</option>
                    <option value="auto" ${method.paymentType === "auto" ? "selected" : ""}>Auto Payment Future</option>
                </select>

                <label>Provider</label>
                <select class="pm-provider">
                    <option value="manual" ${method.provider === "manual" ? "selected" : ""}>Manual</option>
                    <option value="kbzpay" ${method.provider === "kbzpay" ? "selected" : ""}>KBZPay API</option>
                    <option value="wavepay" ${method.provider === "wavepay" ? "selected" : ""}>WavePay API</option>
                    <option value="promptpay" ${method.provider === "promptpay" ? "selected" : ""}>PromptPay</option>
                    <option value="omise" ${method.provider === "omise" ? "selected" : ""}>Omise</option>
                </select>

                <button class="save-payment-btn" onclick="savePaymentMethod('${method._id}')">
                    Save ${method.method}
                </button>
            </div>
        `;
    }).join("");
}

async function savePaymentMethod(id) {
    const card = document.querySelector(`.payment-method-card[data-id="${id}"]`);
    if (!card) {
        alert("Payment method card not found");
        return;
    }

    const token = localStorage.getItem("adminToken");
    if (!token) {
        alert("Admin token missing. Please login again.");
        return;
    }

    const payload = {
        enabled:
            card.querySelector(".pm-enabled")?.checked || false,

        accountName:
            card.querySelector(".pm-name")?.value || "",

        accountNumber:
            card.querySelector(".pm-number")?.value || "",

        qrImageUrl:
            card.querySelector(".pm-qr")?.value || "",

        uploadedQrImage:
            card.querySelector(".pm-uploaded-qr")?.value || "",

        maintenanceMessage:
            card.querySelector(".pm-message")?.value || "",

        paymentType:
            card.querySelector(".pm-type")?.value || "manual",

        provider:
            card.querySelector(".pm-provider")?.value || "manual"
    };

    try {
        const res = await fetch(`/api/admin/payment-methods/${id}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) {
            console.error("Save payment method error:", data);
            alert(data.message || "Save failed");
            return;
        }

        alert("Payment method saved successfully ✅");
    } catch (err) {
        console.error("Save payment method failed:", err);
        alert("Server connection error");
    }
}
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".settings-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            const name = tab.dataset.settingsTab;

            document.querySelectorAll(".settings-tab")
                .forEach(t => t.classList.remove("active"));

            document.querySelectorAll(".settings-panel")
                .forEach(p => p.classList.remove("active"));

            tab.classList.add("active");

            document
                .querySelector(`[data-settings-panel="${name}"]`)
                ?.classList.add("active");

            if (name === "payments") {
                loadPaymentMethods();
            }
        });
    });
});
document.addEventListener("DOMContentLoaded", () => {

    const tabs =
        document.querySelectorAll(".settings-tab[data-settings-tab]");

    const panels =
        document.querySelectorAll(".settings-panel");

    tabs.forEach(tab => {

        tab.addEventListener("click", () => {

            const target =
                tab.dataset.settingsTab;

            tabs.forEach(t =>
                t.classList.remove("active")
            );

            panels.forEach(p =>
                p.classList.remove("active")
            );

            tab.classList.add("active");

            document
                .querySelector(
                    `[data-settings-panel="${target}"]`
                )
                ?.classList.add("active");

        });

    });

});
document.addEventListener("DOMContentLoaded", () => {
    document
        .getElementById("saveSettingsBtn")
        ?.addEventListener("click", saveSettings);
});

async function saveSettings() {
    const token = localStorage.getItem("adminToken");

    const payload = {
        siteName: document.getElementById("siteName")?.value || "",
        announcement: document.getElementById("announcement")?.value || "",
        defaultRegion: document.getElementById("defaultRegion")?.value || "MM",
        maintenanceMode: document.getElementById("maintenanceMode")?.checked || false,
        supportEnabled: document.getElementById("supportEnabled")?.checked || false,
        liveChatEnabled: document.getElementById("liveChatEnabled")?.checked || false
    };

    const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.success) {
        alert("Settings saved successfully");
    } else {
        alert(data.message || "Settings save failed");
    }
}
async function uploadPaymentQR(id) {
    const card = document.querySelector(`.payment-method-card[data-id="${id}"]`);
    const file = card.querySelector(".pm-file")?.files?.[0];

    if (!file) {
        alert("Please choose QR image");
        return;
    }

    const formData = new FormData();
    formData.append("qr", file);

    const res = await fetch("/api/admin/upload-payment-qr", {
        method: "POST",
        body: formData
    });

    const data = await res.json();

    if (!data.success) {
        alert(data.message || "QR upload failed");
        return;
    }

    card.querySelector(".pm-uploaded-qr").value = data.image;

    alert("QR uploaded successfully");
}