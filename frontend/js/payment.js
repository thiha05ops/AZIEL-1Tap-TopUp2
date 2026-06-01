// frontend/js/payment.js

document.addEventListener("DOMContentLoaded", () => {
    loadPaymentMethods();
});

async function loadPaymentMethods() {
    const paymentGrid = document.getElementById("paymentGrid");
    const paymentInput = document.getElementById("paymentMethod");

    if (!paymentGrid || !paymentInput) return;

    const region = localStorage.getItem("region") || "MM";

    paymentGrid.innerHTML = `<p class="pay-loading">Loading payment methods...</p>`;
    paymentInput.value = "";

    try {
        const res = await fetch(`/api/payment-methods?region=${region}`);
        const data = await res.json();
        const methods = data.methods || [];

        if (!res.ok) {
            throw new Error(methods.message || "Failed to load payment methods");
        }

        paymentGrid.innerHTML = "";

        const activeMethods = methods.filter(method =>
            method.enabled === true &&
            method.maintenance !== true
        );

        if (activeMethods.length === 0) {
            paymentGrid.innerHTML = `<p class="pay-empty">No payment methods available.</p>`;
            return;
        }

        activeMethods.forEach(method => {
            const methodId = method.methodKey || method.id || method._id;
            const methodName = method.name || method.title || "Payment";
            const methodLogo = method.logo || method.logoUrl || method.qrImage || "assets/logo.png";

            const card = document.createElement("div");
            card.className = "pay-card";
            card.dataset.method = methodId;

            card.innerHTML = `
                <img src="${methodLogo}" class="pay-logo" alt="${methodName}">
                <span>${methodName}</span>
                ${method.maintenance ? `<small>Maintenance</small>` : ""}
            `;

            card.addEventListener("click", () => {
                document
                    .querySelectorAll(".pay-card")
                    .forEach(c => c.classList.remove("active"));

                card.classList.add("active");
                paymentInput.value = methodId;

                localStorage.setItem("selectedPaymentMethod", methodId);

                document.dispatchEvent(new CustomEvent("paymentChanged", {
                    detail: method
                }));
            });

            paymentGrid.appendChild(card);
        });

    } catch (err) {
        console.error("Load payment methods error:", err);
        paymentGrid.innerHTML = `
            <p class="pay-error">Payment methods failed to load.</p>
        `;
    }
}