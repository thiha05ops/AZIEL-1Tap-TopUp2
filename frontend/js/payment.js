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
            throw new Error(data.message || "Failed to load payment methods");
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

        const paymentMap = {
            kbzpay: {
                name: "KBZPay",
                logo: "assets/payment/kbzpay.png"
            },
            wavepay: {
                name: "WavePay",
                logo: "assets/payment/wavepay.png"
            },
            ayapay: {
                name: "AYA Pay",
                logo: "assets/payment/ayapay.png"
            },
            promptpay: {
                name: "PromptPay",
                logo: "assets/payment/promptpay.png"
            },
            scb: {
                name: "SCB",
                logo: "assets/payment/scb.png"
            }
        };

        activeMethods.forEach(method => {

            const key = (method.method || "").toLowerCase();

            const methodName =
                paymentMap[key]?.name ||
                method.name ||
                method.title ||
                "Payment";

            const methodLogo =
                paymentMap[key]?.logo ||
                method.logo ||
                method.logoUrl ||
                "assets/logo.png";

            const card = document.createElement("div");
            card.className = "pay-card";
            card.dataset.method = methodName;

            card.innerHTML = `
                <img src="${methodLogo}" class="pay-logo" alt="${methodName}">
                <span>${methodName}</span>
            `;

            card.addEventListener("click", () => {
                document
                    .querySelectorAll(".pay-card")
                    .forEach(c => c.classList.remove("active"));

                card.classList.add("active");

                // Order Summary မှာ KBZPay / WavePay ပြမယ်
                paymentInput.value = methodName;

                localStorage.setItem(
                    "selectedPaymentMethod",
                    methodName
                );

                document.dispatchEvent(
                    new CustomEvent("paymentChanged", {
                        detail: method
                    })
                );
            });

            paymentGrid.appendChild(card);
        });

        // Default selected
        if (activeMethods.length > 0) {
            const firstKey = (activeMethods[0].method || "").toLowerCase();

            paymentInput.value =
                paymentMap[firstKey]?.name ||
                activeMethods[0].name ||
                "Payment";
        }

    } catch (err) {
        console.error("Load payment methods error:", err);

        paymentGrid.innerHTML = `
            <p class="pay-error">
                Payment methods failed to load.
            </p>
        `;
    }
}