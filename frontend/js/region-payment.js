const paymentMethodsByRegion = {
    MM: [
        { id: "kbzpay", name: "KBZPay" },
        { id: "wavepay", name: "WavePay" }
    ],
    TH: [
        { id: "promptpay", name: "PromptPay" },
        { id: "truemoney", name: "TrueMoney Wallet" },
        { id: "thaibank", name: "Thai Bank Transfer" }
    ],
    GLOBAL: [
        { id: "visa", name: "Visa / Mastercard" },
        { id: "paypal", name: "PayPal" }
    ]
};

const currencyByRegion = {
    MM: "MMK",
    TH: "THB",
    GLOBAL: "USD"
};

// frontend/js/region-payment.js

document.addEventListener("DOMContentLoaded", () => {

    const region = localStorage.getItem("region") || "MM";

    const box = document.getElementById("packages");
    const paymentMethod = document.getElementById("paymentMethod");
    const currencyText = document.getElementById("currencyText");

    const paymentByRegion = {
        MM: [
            { id: "kbzpay", name: "KBZPay" },
            { id: "wavepay", name: "WavePay" },
            { id: "ayapay", name: "AYA Pay" }
        ],

        TH: [
            { id: "promptpay", name: "PromptPay" },
            { id: "truemoney", name: "TrueMoney Wallet" },
            { id: "thaibank", name: "Thai Bank Transfer" }
        ]
    };

    /* Currency text */
    if (currencyText) {
        currencyText.innerText = region === "TH" ? "THB" : "MMK";
    }

    /* Payment Methods */
    if (paymentMethod) {

        paymentMethod.innerHTML =
            `<option value="">Select Payment Method</option>`;

        paymentByRegion[region].forEach(pay => {

            paymentMethod.innerHTML += `
                <option value="${pay.id}">
                    ${pay.name}
                </option>
            `;
        });
    }

    /* Package Prices */
    if (box) {

        const game = box.dataset.game;
        const items = GAME_PRICES[game] || [];

        box.innerHTML = "";

        items.forEach(item => {

            let priceText = "";

            if (region === "TH") {
                priceText = `${item.thb} ฿`;
            } else {
                priceText = `${item.mmk.toLocaleString()} Ks`;
            }

            box.innerHTML += `
                <div class="pack"
                     data-name="${item.name}"
                     data-price="${region === "TH" ? item.thb : item.mmk}">
                    ${item.name} - ${priceText}
                </div>
            `;
        });

    }

});