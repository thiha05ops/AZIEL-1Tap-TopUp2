// frontend/js/genshin.js - AZIEL V2.5/V3 Genshin Impact Flow

document.addEventListener("DOMContentLoaded", () => {
    const buyBtn = document.getElementById("buyBtn");
    const userIdInput = document.getElementById("userId");
    const serverIdInput = document.getElementById("serverId");

    const selectedText = document.getElementById("selectedText");
    const summaryPackage = document.getElementById("summaryPackage");
    const summaryPayment = document.getElementById("summaryPayment");
    const summaryAmount = document.getElementById("summaryAmount");

    let selectedPack = null;

    document.addEventListener("click", (e) => {
        const pack = e.target.closest(".pack");
        if (!pack) return;

        document.querySelectorAll(".pack").forEach(p => p.classList.remove("active"));
        pack.classList.add("active");

        selectedPack = {
            name: pack.dataset.name || pack.querySelector(".pack-name")?.innerText || pack.innerText,
            amount: Number(pack.dataset.price || 0),
            code: pack.dataset.code || ""
        };

        updateState();
    });

    userIdInput?.addEventListener("input", updateState);
    serverIdInput?.addEventListener("change", updateState);

    document.addEventListener("click", (e) => {
        if (e.target.closest(".pay-card")) {
            setTimeout(updateState, 80);
        }
    });

    document.addEventListener("paymentChanged", updateState);
    document.addEventListener("pricesRendered", updateState);
    window.addEventListener("aziel:shopRegionChanged", updateState);

    buyBtn?.addEventListener("click", async () => {
        if (buyBtn.disabled || !selectedPack) return;

        const username = localStorage.getItem("username") || "guest";

        const region =
            window.AZIEL?.getShopRegion?.() ||
            localStorage.getItem("selectedRegion") ||
            localStorage.getItem("region") ||
            "MM";

        const currency = region === "TH" ? "THB" : "MMK";
        const paymentMethod = document.getElementById("paymentMethod")?.value || "";

        const orderData = {
            orderId: "AZL-" + Date.now(),
            game: "Genshin Impact",
            gameKey: "genshin",
            packageName: selectedPack.name,
            packageCode: selectedPack.code,
            amount: selectedPack.amount,
            currency,
            region,
            paymentMethod,
            username,
            userId: userIdInput.value.trim(),
            zoneId: serverIdInput.value || "-",
            status: "pending_payment"
        };

        if (window.AZIEL_PAYMENT?.start) {
            window.AZIEL_PAYMENT.start(orderData);
            return;
        }

        alert("Payment system not ready. Please refresh and try again.");
    });

    function updateState() {
        const userId = userIdInput?.value.trim();
        const serverId = serverIdInput?.value || "";
        const paymentMethod = document.getElementById("paymentMethod")?.value || "";

        const region =
            window.AZIEL?.getShopRegion?.() ||
            localStorage.getItem("selectedRegion") ||
            localStorage.getItem("region") ||
            "MM";

        const currencySymbol = region === "TH" ? "฿" : "Ks";

        const paymentNameMap = {
            wallet: "AZIEL Wallet",
            kbzpay: "KBZPay",
            wavepay: "WavePay",
            ayapay: "AYA Pay",
            promptpay: "PromptPay",
            scb: "SCB"
        };

        if (selectedPack) {
            summaryPackage.innerText = selectedPack.name;
            summaryAmount.innerText = `${Number(selectedPack.amount || 0).toLocaleString()} ${currencySymbol}`;
            selectedText.innerText = "Ready to checkout after completing all fields.";
        } else {
            summaryPackage.innerText = "Not selected";
            summaryAmount.innerText = `0 ${currencySymbol}`;
            selectedText.innerText = "Please select a package.";
        }

        summaryPayment.innerText = paymentMethod
            ? paymentNameMap[paymentMethod] || paymentMethod
            : "Not selected";

        buyBtn.disabled = !(userId && serverId && selectedPack && paymentMethod);
    }

    updateState();
});