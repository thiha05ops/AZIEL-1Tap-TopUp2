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
    if (!card) return;

    const token = localStorage.getItem("adminToken");

    const payload = {
        enabled: card.querySelector(".pm-enabled").checked,
        accountName: card.querySelector(".pm-name").value,
        accountNumber: card.querySelector(".pm-number").value,
        qrImage: card.querySelector(".pm-qr").value,
        maintenanceMessage: card.querySelector(".pm-message").value
    };

    const res = await fetch(`/api/admin/payment-methods/${id}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.success) {
        alert("Payment method saved");
    } else {
        alert(data.message || "Save failed");
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