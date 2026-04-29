// frontend/js/region-payment.js

document.addEventListener("DOMContentLoaded", () => {

    const region = localStorage.getItem("region") || "MM";

    const regionSelect = document.getElementById("regionSelect");
    const currencyText = document.getElementById("currencyText");
    const packagesBox = document.getElementById("packages");
    const paymentGrid = document.getElementById("paymentGrid");
    const paymentMethod = document.getElementById("paymentMethod");

    const regionData = {
        MM: {
            currency: "MMK",
            priceKey: "mmk",
            payments: [
                { id: "kbzpay", name: "KBZPay", logo: "assets/payments/kbzpay.png" },
                { id: "wavepay", name: "WavePay", logo: "assets/payments/wavepay.png" },
                { id: "ayapay", name: "AYA Pay", logo: "assets/payments/ayapay.png" }
            ]
        },
        TH: {
            currency: "THB",
            priceKey: "thb",
            payments: [
                { id: "promptpay", name: "PromptPay", logo: "assets/payments/promptpay.png" },
                { id: "scb", name: "SCB", logo: "assets/payments/scb.png" }
            ]
        }
    };

    const config = regionData[region] || regionData.MM;

    // Region / Currency show
    if (regionSelect) {
        regionSelect.value = region;
    }

    if (currencyText) {
        currencyText.innerText = config.currency;
    }

    // Package prices auto generate
    if (packagesBox) {
        const game = packagesBox.dataset.game;
        const items = GAME_PRICES[game] || [];

        packagesBox.innerHTML = "";

        items.forEach(item => {
            const price = item[config.priceKey];

            const priceText =
                config.currency === "THB"
                    ? `${price} ฿`
                    : `${price.toLocaleString()} Ks`;

            packagesBox.innerHTML += `
                <div class="pack"
                     data-name="${item.name}"
                     data-price="${price}"
                     data-currency="${config.currency}">
                    ${item.name} - ${priceText}
                </div>
            `;
        });
    }

    // Payment logo cards auto generate by region
    if (paymentGrid && paymentMethod) {
        paymentGrid.innerHTML = "";

        config.payments.forEach((pay, index) => {
            paymentGrid.innerHTML += `
                <div class="pay-card ${index === 0 ? "active" : ""}"
                     data-method="${pay.id}">
                    <img src="${pay.logo}" alt="${pay.name}">
                    <span>${pay.name}</span>
                </div>
            `;
        });

        paymentMethod.value = config.payments[0].id;

        document.querySelectorAll(".pay-card").forEach(card => {
            card.addEventListener("click", () => {
                document.querySelectorAll(".pay-card").forEach(c => {
                    c.classList.remove("active");
                });

                card.classList.add("active");
                paymentMethod.value = card.dataset.method;
            });
        });
    }

});