/* =========================
   REGION SYSTEM
========================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        initRegionSystem();

    }
);

function initRegionSystem() {

    loadRegionPayments();

    syncRegionText();

}

/* =========================
   LOAD PAYMENT LOGOS
========================= */

function loadRegionPayments() {

    const paymentLogos =
        document.getElementById(
            "paymentLogos"
        );

    const paymentRegionText =
        document.getElementById(
            "paymentRegionText"
        );

    if (!paymentLogos) return;

    const rawRegion =
        localStorage.getItem(
            "selectedRegion"
        )
        || localStorage.getItem(
            "region"
        )
        || "myanmar";

    const region =
        rawRegion.toLowerCase();

    const isThailand =
        region.includes("thai")
        || region.includes("thailand")
        || region === "th";

    const logos =
        isThailand
            ? [
                "promptpay.png",
                "scb.png"
            ]
            : [
                "kbzpay.png",
                "wavepay.png",
                "ayapay.png"
            ];

    paymentLogos.innerHTML =
        logos.map(logo => `
            <img
                src="assets/payments/${logo}"
                alt="${logo}"
            >
        `).join("");

    if (paymentRegionText) {

        paymentRegionText.innerText =
            isThailand
                ? "Thailand"
                : "Myanmar";

    }

}

/* =========================
   SYNC REGION LABELS
========================= */

function syncRegionText() {

    const regionLabels =
        document.querySelectorAll(
            ".region-text"
        );

    if (!regionLabels.length) return;

    const region =
        localStorage.getItem(
            "selectedRegion"
        )
        || "Myanmar";

    regionLabels.forEach(label => {

        label.innerText = region;

    });

}