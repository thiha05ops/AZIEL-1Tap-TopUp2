// frontend/js/payment.js

document.addEventListener("DOMContentLoaded", () => {
    const paymentGrid = document.getElementById("paymentGrid");
    const paymentInput = document.getElementById("paymentMethod");

    if (!paymentGrid || !paymentInput) return;

    const region = localStorage.getItem("region") || "MM";

    const paymentsByRegion = {
        MM: [
            { id: "wallet", name: "AZIEL Wallet", logo: "assets/logo.png" },
            { id: "kbzpay", name: "KBZPay", logo: "assets/payment/kbzpay.png" },
            { id: "wavepay", name: "WavePay", logo: "assets/payment/wavepay.png" },
            { id: "ayapay", name: "AYA Pay", logo: "assets/payment/ayapay.png" }
        ],
        TH: [
            { id: "wallet", name: "AZIEL Wallet", logo: "assets/logo.png" },
            { id: "promptpay", name: "PromptPay", logo: "assets/payment/promptpay.png" },
            { id: "scb", name: "SCB", logo: "assets/payment/scb.png" }
        ]
    };

    const methods = paymentsByRegion[region] || paymentsByRegion.MM;

    paymentGrid.innerHTML = "";
    paymentInput.value = "";

    methods.forEach(method => {
        const card = document.createElement("div");
        card.className = "pay-card";
        card.dataset.method = method.id;

        card.innerHTML = `
            <img src="${method.logo}" class="pay-logo" alt="${method.name}">
            <span>${method.name}</span>
        `;

        card.addEventListener("click", () => {
            document.querySelectorAll(".pay-card").forEach(c => c.classList.remove("active"));
            card.classList.add("active");
            paymentInput.value = method.id;
            document.dispatchEvent(new Event("paymentChanged"));
        });

        paymentGrid.appendChild(card);
    });
});
