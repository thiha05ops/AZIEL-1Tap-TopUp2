// frontend/js/mlbb.js

document.addEventListener("DOMContentLoaded", () => {

    const buyBtn = document.getElementById("buyBtn");
    const userIdInput = document.getElementById("userId");
    const serverIdInput = document.getElementById("serverId");

    const selectedText = document.getElementById("selectedText");
    const summaryPackage = document.getElementById("summaryPackage");
    const summaryPayment = document.getElementById("summaryPayment");
    const summaryAmount = document.getElementById("summaryAmount");

    let selectedPack = null;

    // =========================
    // PACKAGE SELECT
    // =========================

    document.addEventListener("click", (e) => {

        const pack = e.target.closest(".pack");
        if (!pack) return;

        document.querySelectorAll(".pack")
            .forEach(p => p.classList.remove("active"));

        pack.classList.add("active");

        selectedPack = {
            name:
                pack.dataset.name ||
                pack.querySelector(".pack-name")?.innerText ||
                "Package",

            amount:
                Number(pack.dataset.price || 0)
        };

        updateState();
        initSuccessModal();
    });

    // =========================
    // INPUT EVENTS
    // =========================

    userIdInput?.addEventListener("input", updateState);
    serverIdInput?.addEventListener("input", updateState);

    // =========================
    // PAYMENT SELECT
    // =========================

    document.addEventListener("click", (e) => {

        const payCard = e.target.closest(".pay-card");
        if (!payCard) return;

        document.querySelectorAll(".pay-card")
            .forEach(card => card.classList.remove("active"));

        payCard.classList.add("active");

        const paymentInput = document.getElementById("paymentMethod");

        if (paymentInput) {
            paymentInput.value =
                payCard.dataset.payment ||
                payCard.dataset.method ||
                payCard.dataset.pay ||
                "";
        }

        updateState();
    });
    // =========================
    // BUY BUTTON
    // =========================

    buyBtn?.addEventListener("click", async () => {

        if (buyBtn.disabled || !selectedPack) return;

        showOrderLoading();

        const username =
            localStorage.getItem("username") || "guest";

        const region =
            localStorage.getItem("region") || "MM";

        const currency =
            region === "TH"
                ? "THB"
                : "MMK";

        const paymentMethod =
            document.getElementById("paymentMethod")?.value || "";

        const orderId = "AZL-" + Date.now();

        const orderData = {
            orderId,
            game: "Mobile Legends",
            packageName: selectedPack.name,
            amount: selectedPack.amount,
            currency,
            region,
            paymentMethod,
            username,
            userId: userIdInput.value.trim(),
            zoneId: serverIdInput.value.trim() || "-",
            status: "pending_payment"
        };

        try {

            if (paymentMethod === "wallet") {

                await payWithWallet(orderData);

            } else {

                await createPaymentAndRedirect(orderData);
            }

        } catch (error) {

            console.log(error);

        } finally {

            setTimeout(() => {
                hideOrderLoading();
            }, 1800);
        }
    });

    // =========================
    // UPDATE STATE
    // =========================

    function updateState() {

        const userId =
            userIdInput?.value.trim();

        const serverId =
            serverIdInput?.value.trim();

        const paymentMethod =
            document.getElementById("paymentMethod")?.value || "";

        const paymentNameMap = {
            kbzpay: "KBZPay",
            wavepay: "WavePay",
            ayapay: "AYA Pay",
            promptpay: "PromptPay",
            scb: "SCB",
            wallet: "AZIEL Wallet"
        };

        if (selectedPack) {

            summaryPackage.innerText =
                selectedPack.name;

            const region =
                localStorage.getItem("region") || "MM";

            const currencySymbol =
                region === "TH"
                    ? "฿"
                    : "Ks";

            summaryAmount.innerText =
                `${selectedPack.amount.toLocaleString()} ${currencySymbol}`;

            selectedText.innerText =
                "Ready to checkout after completing all fields.";

        } else {

            summaryPackage.innerText = "Not selected";
            summaryAmount.innerText = "0 Ks";

            selectedText.innerText =
                "Please select a package.";
        }

        summaryPayment.innerText =
            paymentMethod
                ? paymentNameMap[paymentMethod] || paymentMethod
                : "Not selected";

        buyBtn.disabled =
            !(userId && serverId && selectedPack && paymentMethod);
        if (userId && serverId && selectedPack && paymentMethod) {
            scrollToBuyNowOnce();
        }

        updateMobileSelectedPackage();
    }

    // =========================
    // MOBILE PACKAGE PANEL
    // =========================

    initMobilePackagePanel();

    function initMobilePackagePanel() {

        const openBtn =
            document.getElementById("openPackagePanel");

        const closeBtn =
            document.getElementById("closePackagePanel");

        const confirmBtn =
            document.getElementById("confirmPackagePanel");

        const panel =
            document.getElementById("mobilePackagePanel");

        const list =
            document.getElementById("mobilePackageList");

        if (
            !openBtn ||
            !closeBtn ||
            !confirmBtn ||
            !panel ||
            !list
        ) return;

        let selectedPackEl = null;

        function openPanel() {

            list.innerHTML = "";

            document.querySelectorAll("#packages .pack")
                .forEach(pack => {

                    const row = pack.cloneNode(true);

                    row.classList.add("mobile-pack-row");

                    if (pack.classList.contains("active")) {

                        row.classList.add("active");

                        selectedPackEl = pack;
                    }

                    row.addEventListener("click", () => {

                        document
                            .querySelectorAll("#mobilePackageList .mobile-pack-row")
                            .forEach(item => item.classList.remove("active"));

                        row.classList.add("active");

                        selectedPackEl = pack;
                    });

                    list.appendChild(row);
                });

            panel.classList.add("show");

            document.body.classList.add("panel-open");
        }

        function closePanel() {

            panel.classList.remove("show");

            document.body.classList.remove("panel-open");
        }

        openBtn.addEventListener("click", openPanel);

        closeBtn.addEventListener("click", closePanel);

        confirmBtn.addEventListener("click", () => {

            if (selectedPackEl) {

                selectedPackEl.click();

                updateMobileSelectedPackage();
            }

            closePanel();
        });

        panel.addEventListener("click", (e) => {

            if (e.target === panel) {

                closePanel();
            }
        });
    }

    // =========================
    // MOBILE SELECTED PREVIEW
    // =========================

    function updateMobileSelectedPackage() {
        const active = document.querySelector("#packages .pack.active");
        const nameEl = document.getElementById("mobileSelectedPackageName");
        const priceEl = document.getElementById("mobileSelectedPackagePrice");

        if (!nameEl || !priceEl) return;

        if (!active) {
            nameEl.innerText = "Select Top-Up Amount";
            priceEl.innerText = "Choose your package";
            return;
        }

        nameEl.innerText =
            active.dataset.name ||
            active.querySelector(".pack-name")?.innerText ||
            "Selected Package";

        priceEl.innerText =
            active.querySelector(".pack-price")?.innerText ||
            "";
    }
    updateState();
});

// =========================
// WALLET PAYMENT
// =========================

async function payWithWallet(orderData) {

    try {

        const res = await fetch("/api/wallet/pay", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        if (!data.success) {

            alert(data.message || "Wallet payment failed");

            return;
        }

        alert("Paid with wallet ✅");

        window.location.href =
            `tracking.html?orderId=${orderData.orderId}`;

    } catch (error) {

        console.log(error);

        alert("Server error");
    }
}
let hasAutoScrolledToBuy = false;

function scrollToBuyNowOnce() {

    if (hasAutoScrolledToBuy) return;

    const buyBtn = document.getElementById("buyBtn");

    if (!buyBtn) return;

    hasAutoScrolledToBuy = true;

    setTimeout(() => {

        buyBtn.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

    }, 250);
}
function showOrderLoading() {

    const overlay =
        document.getElementById("orderLoadingOverlay");

    if (!overlay) return;

    overlay.classList.add("show");
}

function hideOrderLoading() {

    const overlay =
        document.getElementById("orderLoadingOverlay");

    if (!overlay) return;

    overlay.classList.remove("show");
}
let lastOrderId = "";

function showSuccessModal(orderId) {
    lastOrderId = orderId;

    const modal = document.getElementById("successModal");
    if (!modal) return;

    modal.classList.add("show");
}

function initSuccessModal() {
    const trackBtn = document.getElementById("trackOrderBtn");
    const homeBtn = document.getElementById("backHomeBtn");

    if (trackBtn) {
        trackBtn.addEventListener("click", () => {
            window.location.href = `tracking.html?orderId=${lastOrderId}`;
        });
    }

    if (homeBtn) {
        homeBtn.addEventListener("click", () => {
            window.location.href = "home.html";
        });
    }
}
document.addEventListener("click", e => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) return;

    const url = new URL(href, window.location.href);

    if (url.origin === window.location.origin) {
        e.preventDefault();
        window.location.href = url.pathname + url.search + url.hash;
    }
});