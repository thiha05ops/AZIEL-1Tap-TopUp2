// frontend/js/payment.js

const paymentMethods = [
    {
        id: "kbzpay",
        name: "KBZPay",
        logo: "assets/payment/kbzpay.png"
    },
    {
        id: "wavepay",
        name: "WavePay",
        logo: "assets/payment/wavepay.png"
    },
    {
        id: "ayapay",
        name: "AYA Pay",
        logo: "assets/payment/ayapay.png"
    }
];

document.addEventListener("DOMContentLoaded", () => {
    const paymentGrid = document.getElementById("paymentGrid");
    const paymentMethod = document.getElementById("paymentMethod");

    if (!paymentGrid || !paymentMethod) return;

    paymentGrid.innerHTML = "";

    paymentMethods.forEach(method => {
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
            paymentMethod.value = method.id;
        });

        paymentGrid.appendChild(card);
    });
});