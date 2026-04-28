// frontend/js/region-payment.js

const paymentMethodsByRegion = {
    MM: [
        { id: "kbzpay", name: "KBZPay" },
        { id: "wavepay", name: "WavePay" },
        { id: "ayapay", name: "AYA Pay" }
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

document.addEventListener("DOMContentLoaded", () => {
    const regionSelect = document.getElementById("regionSelect");
    const paymentMethod = document.getElementById("paymentMethod");
    const currencyText = document.getElementById("currencyText");

    if (!regionSelect || !paymentMethod) return;

    function updatePaymentMethods() {
        const region = regionSelect.value;
        const methods = paymentMethodsByRegion[region] || [];

        paymentMethod.innerHTML = `<option value="">Select Payment Method</option>`;

        methods.forEach(method => {
            const option = document.createElement("option");
            option.value = method.id;
            option.textContent = method.name;
            paymentMethod.appendChild(option);
        });

        if (currencyText) {
            currencyText.textContent = currencyByRegion[region];
        }
    }

    regionSelect.addEventListener("change", updatePaymentMethods);

    updatePaymentMethods();
});