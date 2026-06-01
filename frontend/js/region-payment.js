// frontend/js/region-payment.js

document.addEventListener("DOMContentLoaded", async () => {
    const region = localStorage.getItem("region") || "MM";

    const regionSelect = document.getElementById("regionSelect");
    const currencyText = document.getElementById("currencyText");
    const packagesBox = document.getElementById("packages");

    const regionData = {
        MM: { currency: "MMK", priceKey: "mmk" },
        TH: { currency: "THB", priceKey: "thb" }
    };

    const config = regionData[region] || regionData.MM;

    if (regionSelect) {
        regionSelect.value = region;
    }

    if (currencyText) {
        currencyText.innerText = config.currency;
    }

    if (packagesBox) {
        const game = packagesBox.dataset.game;
        const items = window.GAME_PRICES?.[game] || GAME_PRICES?.[game] || [];

        packagesBox.innerHTML = "";

        items.forEach(item => {
            const price = item[config.priceKey] || 0;

            const priceText =
                config.currency === "THB"
                    ? `${price} ฿`
                    : `${Number(price).toLocaleString()} Ks`;

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

    await loadDynamicPaymentMethods(region);
});

async function loadDynamicPaymentMethods(region) {
    const paymentGrid = document.getElementById("paymentGrid");
    const paymentMethod = document.getElementById("paymentMethod");

    if (!paymentGrid || !paymentMethod) return;

    paymentGrid.innerHTML = `<p>Loading payment methods...</p>`;
    paymentMethod.value = "";

    try {
        const res = await fetch(`/api/payment-methods?region=${region}`);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || "Failed to load payment methods");
        }

        const methods = Array.isArray(data) ? data : [];

        const activeMethods = methods.filter(pay =>
            pay.enabled === true &&
            pay.maintenance !== true
        );

        paymentGrid.innerHTML = "";

        if (activeMethods.length === 0) {
            paymentGrid.innerHTML = `<p>No payment methods available.</p>`;
            return;
        }

        activeMethods.forEach((pay, index) => {
            const id = pay.methodKey || pay.id || pay._id;
            const name = pay.name || pay.title || pay.methodName || "Payment";
            const logo = pay.logo || pay.logoUrl || pay.qrImage || "assets/logo.png";

            const card = document.createElement("div");
            card.className = `pay-card ${index === 0 ? "active" : ""}`;
            card.dataset.method = id;

            card.innerHTML = `
                <img src="${logo}" alt="${name}">
                <span>${name}</span>
            `;

            card.addEventListener("click", () => {
                document.querySelectorAll(".pay-card").forEach(c => {
                    c.classList.remove("active");
                });

                card.classList.add("active");
                paymentMethod.value = id;

                document.dispatchEvent(new CustomEvent("paymentChanged", {
                    detail: pay
                }));
            });

            paymentGrid.appendChild(card);

            if (index === 0) {
                paymentMethod.value = id;
            }
        });

    } catch (err) {
        console.error("Payment methods load error:", err);
        paymentGrid.innerHTML = `<p>Payment methods failed to load.</p>`;
    }
}