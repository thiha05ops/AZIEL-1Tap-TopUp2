// frontend/js/region-payment.js

document.addEventListener("DOMContentLoaded", async () => {
    const region = localStorage.getItem("region") || "MM";

    const regionSelect = document.getElementById("regionSelect");
    const currencyText = document.getElementById("currencyText");

    const regionData = {
        MM: { currency: "MMK", priceKey: "mmk" },
        TH: { currency: "THB", priceKey: "thb" }
    };

    const config = regionData[region] || regionData.MM;

    if (regionSelect) regionSelect.value = region;
    if (currencyText) currencyText.innerText = config.currency;

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

        const methods = Array.isArray(data.methods)
            ? data.methods.filter(method => method.enabled)
            : [];

        paymentGrid.innerHTML = "";

        if (methods.length === 0) {
            paymentGrid.innerHTML = `<p>No payment methods available.</p>`;
            return;
        }

        methods.forEach((pay, index) => {
            const name = pay.method || "Payment";
            const key = pay.key || name.toLowerCase();
            const logo = pay.qrImage || getPaymentLogo(key);

            const card = document.createElement("div");
            card.className = `pay-card ${index === 0 ? "active" : ""}`;
            card.dataset.method = key;
            card.dataset.name = name;
            card.dataset.qr = pay.qrImage || "";
            card.dataset.accountName = pay.accountName || "";
            card.dataset.accountNumber = pay.accountNumber || "";

            card.innerHTML = `
                <img src="${logo}" alt="${name}">
                <span>${name}</span>
                ${pay.maintenanceMessage
                    ? `<small>${pay.maintenanceMessage}</small>`
                    : ""
                }
            `;

            card.addEventListener("click", () => {
                document
                    .querySelectorAll(".pay-card")
                    .forEach(c => c.classList.remove("active"));

                card.classList.add("active");
                paymentMethod.value = key;

                updatePaymentPreview(card);
            });

            paymentGrid.appendChild(card);

            if (index === 0) {
                paymentMethod.value = key;
                updatePaymentPreview(card);
            }
        });

    } catch (err) {
        console.error("Payment methods load error:", err);
        paymentGrid.innerHTML = `<p>Payment methods failed to load.</p>`;
    }
}

function getPaymentLogo(key) {
    const logos = {
        kbzpay: "assets/payment/kbzpay.png",
        wavepay: "assets/payment/wavepay.png",
        ayapay: "assets/payment/ayapay.png",
        promptpay: "assets/payment/promptpay.png",
        scb: "assets/payment/scb.png"
    };

    return logos[key] || "assets/logo.png";
}

function updatePaymentPreview(card) {
    const qrImg =
        document.getElementById("paymentQrImage") ||
        document.getElementById("qrImage");

    const accountName =
        document.getElementById("paymentAccountName");

    const accountNumber =
        document.getElementById("paymentAccountNumber");

    if (qrImg && card.dataset.qr) {
        qrImg.src = card.dataset.qr;
        qrImg.style.display = "block";
    }

    if (accountName) {
        accountName.innerText = card.dataset.accountName || "";
    }

    if (accountNumber) {
        accountNumber.innerText = card.dataset.accountNumber || "";
    }
}