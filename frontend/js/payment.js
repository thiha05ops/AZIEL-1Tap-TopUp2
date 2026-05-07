// frontend/js/payment.js

document.addEventListener("DOMContentLoaded", () => {

    const paymentGrid = document.getElementById("paymentGrid");
    const paymentInput = document.getElementById("paymentMethod");

    if (!paymentGrid || !paymentInput) {
        console.log("paymentGrid or paymentMethod not found");
        return;
    }

    const methods = [
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

    paymentGrid.innerHTML = "";

    methods.forEach(method => {

        const card = document.createElement("div");
        card.className = "pay-card";

        card.innerHTML = `
            <img src="${method.logo}" alt="${method.name}">
            <span>${method.name}</span>
        `;

        card.addEventListener("click", () => {

            document.querySelectorAll(".pay-card")
                .forEach(c => c.classList.remove("active"));

            card.classList.add("active");

            paymentInput.value = method.id;

            console.log("Selected payment:", method.id);

        });

        paymentGrid.appendChild(card);

    });

});