// frontend/js/mlbb.js

document.addEventListener("DOMContentLoaded", () => {
    const buyBtn = document.getElementById("buyBtn");
    const userIdInput = document.getElementById("userId");
    const serverIdInput = document.getElementById("serverId");
    const selectedText = document.getElementById("selectedText");

    let selectedPack = null;

    document.addEventListener("click", (e) => {
        const pack = e.target.closest(".pack");
        if (!pack) return;

        document.querySelectorAll(".pack").forEach(p => p.classList.remove("active"));
        pack.classList.add("active");

        selectedPack = {
            name: pack.dataset.name || pack.innerText,
            amount: pack.dataset.price
        };

        updateState();
    });

    userIdInput.addEventListener("input", updateState);
    serverIdInput.addEventListener("input", updateState);

    function updateState() {
        const userId = userIdInput.value.trim();
        const serverId = serverIdInput.value.trim();
        const paymentMethod = document.getElementById("paymentMethod").value;

        if (selectedPack) {
            selectedText.innerText = `${selectedPack.name} - ${Number(selectedPack.amount).toLocaleString()} Ks`;
        } else {
            selectedText.innerText = "No package selected";
        }

        buyBtn.disabled = !(userId && serverId && selectedPack && paymentMethod);
    }

    document.addEventListener("click", (e) => {
        if (e.target.closest(".pay-card")) {
            setTimeout(updateState, 50);
        }
    });

    buyBtn.addEventListener("click", () => {
        if (buyBtn.disabled) return;

        const username = localStorage.getItem("username") || "guest";
        const region = localStorage.getItem("region") || "MM";
        const currency = region === "TH" ? "THB" : "MMK";

        const paymentMethod = document.getElementById("paymentMethod").value;

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
            zoneId: serverIdInput.value.trim()
        };

        createPaymentAndRedirect(orderData);
    });

    updateState();
});