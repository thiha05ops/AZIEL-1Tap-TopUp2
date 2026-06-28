// frontend/js/region-payment.js - AZIEL V2.5 Global Region + Payment Methods

document.addEventListener("DOMContentLoaded", async () => {
    const region = getActiveRegion();

    syncRegionStorage(region);
    updateRegionUI(region);

    const regionSelect = document.getElementById("regionSelect");

    if (regionSelect) {
        regionSelect.value = region;

        regionSelect.addEventListener("change", () => {
            setActiveRegion(regionSelect.value);
        });
    }

    const localeOpenBtn = document.getElementById("localeOpenBtn");

    if (localeOpenBtn) {
        localeOpenBtn.addEventListener("click", () => {
            const nextRegion = getActiveRegion() === "TH" ? "MM" : "TH";
            setActiveRegion(nextRegion);
        });
    }

    await loadDynamicPaymentMethods(region);
});

function getActiveRegion() {
    return (
        localStorage.getItem("selectedRegion") ||
        localStorage.getItem("region") ||
        "MM"
    );
}

function syncRegionStorage(region) {
    const currency = region === "TH" ? "THB" : "MMK";

    localStorage.setItem("region", region);
    localStorage.setItem("selectedRegion", region);
    localStorage.setItem("currency", currency);
    localStorage.setItem("selectedCurrency", currency);
}

function setActiveRegion(region) {
    syncRegionStorage(region);

    window.dispatchEvent(
        new CustomEvent("regionChanged", {
            detail: { region }
        })
    );

    window.location.reload();
}

function updateRegionUI(region) {
    const currencyText = document.getElementById("currencyText");
    const localeFlag = document.getElementById("localeFlag");

    const currency = region === "TH" ? "THB" : "MMK";

    if (currencyText) {
        currencyText.innerText = currency;
    }

    if (localeFlag) {
        localeFlag.innerText = region === "TH" ? "🇹🇭" : "🇲🇲";
    }
}

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

                window.selectedPaymentData = {
                    method: name,
                    key,
                    logo,
                    qrImage: pay.qrImage || "",
                    accountName: pay.accountName || "",
                    accountNumber: pay.accountNumber || "",
                    provider: pay.provider || "manual",
                    paymentType: pay.paymentType || "manual"
                };

                updatePaymentPreview(card);

                document.dispatchEvent(new Event("paymentChanged"));
            });

            paymentGrid.appendChild(card);

            if (index === 0) {
                paymentMethod.value = key;

                window.selectedPaymentData = {
                    method: name,
                    key,
                    logo,
                    qrImage: pay.qrImage || "",
                    accountName: pay.accountName || "",
                    accountNumber: pay.accountNumber || "",
                    provider: pay.provider || "manual",
                    paymentType: pay.paymentType || "manual"
                };

                updatePaymentPreview(card);

                document.dispatchEvent(new Event("paymentChanged"));
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

    if (qrImg) {
        if (card.dataset.qr) {
            qrImg.src = card.dataset.qr;
            qrImg.style.display = "block";
        } else {
            qrImg.removeAttribute("src");
            qrImg.style.display = "none";
        }
    }

    if (accountName) {
        accountName.innerText = card.dataset.accountName || "";
    }

    if (accountNumber) {
        accountNumber.innerText = card.dataset.accountNumber || "";
    }
}