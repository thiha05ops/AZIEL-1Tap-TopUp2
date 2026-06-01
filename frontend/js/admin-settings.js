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

    box.innerHTML = data.methods.map(method => `
        <div class="payment-method-card" data-id="${method._id}">
            <div class="payment-header">
                <h4>${method.method} <small>${method.region}</small></h4>

                <label class="switch">
                    <input class="pm-enabled" type="checkbox" ${method.enabled ? "checked" : ""}>
                    <span>Enabled</span>
                </label>
            </div>

            <input class="pm-name" type="text" placeholder="Account Name" value="${method.accountName || ""}">
            <input class="pm-number" type="text" placeholder="Account Number" value="${method.accountNumber || ""}">
            <input class="pm-qr" type="text" placeholder="QR Image URL" value="${method.qrImage || ""}">
            <textarea class="pm-message" placeholder="Maintenance Message">${method.maintenanceMessage || ""}</textarea>

            <button class="save-payment-btn" onclick="savePaymentMethod('${method._id}')">
                Save ${method.method}
            </button>
        </div>
    `).join("");
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
        enabled: card.querySelector(".pm-enabled")?.checked || false,
        accountName: card.querySelector(".pm-name")?.value || "",
        accountNumber: card.querySelector(".pm-number")?.value || "",
        qrImage: card.querySelector(".pm-qr")?.value || "",
        maintenance: card.querySelector(".pm-maintenance")?.checked || false
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