// frontend/js/pubg.js

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
            amount: Number(pack.dataset.price || 0)
        };

        updateState();
    });

    userIdInput?.addEventListener("input", updateState);

    document.addEventListener("click", (e) => {
        const payCard = e.target.closest(".pay-card");
        if (!payCard) return;
        setTimeout(updateState, 80);
    });

    buyBtn?.addEventListener("click", () => {
        if (buyBtn.disabled || !selectedPack) return;

        const username = localStorage.getItem("username") || "guest";
        const region = localStorage.getItem("region") || "MM";
        const currency = region === "TH" ? "THB" : "MMK";
        const paymentMethod = document.getElementById("paymentMethod")?.value || "";

        const orderId = "AZL-" + Date.now();

        const orderData = {
            orderId,
            game: "PUBG Mobile",
            packageName: selectedPack.name,
            amount: selectedPack.amount,
            currency,
            region,
            paymentMethod,
            username,
            userId: userIdInput.value.trim(),
            zoneId: serverIdInput.value.trim() || "-"
        };

        createPaymentAndRedirect(orderData);
    });

    function updateState() {
        const userId = userIdInput?.value.trim();
        const paymentMethod = document.getElementById("paymentMethod")?.value || "";

        const paymentNameMap = {
            kbzpay: "KBZPay",
            wavepay: "WavePay",
            ayapay: "AYA Pay",
            promptpay: "PromptPay",
            scb: "SCB"
        };

        if (selectedPack) {
            summaryPackage.innerText = selectedPack.name;
            const region = localStorage.getItem("region") || "MM";

            const currencySymbol = region === "TH"
                ? "฿"
                : "Ks";

            summaryAmount.innerText =
                `${selectedPack.amount.toLocaleString()} ${currencySymbol}`;
            selectedText.innerText = "Ready to checkout after completing all fields.";
        } else {
            summaryPackage.innerText = "Not selected";
            summaryAmount.innerText = "0 Ks";
            selectedText.innerText = "Please select a package.";
        }

        summaryPayment.innerText = paymentMethod
            ? paymentNameMap[paymentMethod] || paymentMethod
            : "Not selected";

        buyBtn.disabled = !(userId && selectedPack && paymentMethod);
    }
    document.addEventListener("paymentChanged", updateState);

    updateState();
});