// frontend/js/mlbb.js

document.addEventListener("DOMContentLoaded", () => {

    console.log("MLBB Page Loaded ✅");

    const packs = document.querySelectorAll(".pack");
    const buyBtn = document.getElementById("buyBtn");
    const userId = document.getElementById("userId");
    const serverId = document.getElementById("serverId");

    let selectedPack = "";

    // package select
    packs.forEach(pack => {

        pack.addEventListener("click", () => {

            packs.forEach(p => p.classList.remove("active"));

            pack.classList.add("active");

            selectedPack = pack.innerText;

            checkForm();
        });

    });

    // input check
    buyBtn.addEventListener("click", async () => {
        const username = localStorage.getItem("username") || "guest";
        const region = localStorage.getItem("region") || "MM";
        const paymentMethod = document.getElementById("paymentMethod").value;

        if (!paymentMethod) {
            alert("Please select payment method");
            return;
        }

        const activePack = document.querySelector(".pack.active");

        if (!activePack) {
            alert("Please select package");
            return;
        }

        const amount = activePack.dataset.price;

        const orderId = "AZL-" + Date.now();

        createPaymentAndRedirect({
            orderId,
            game: "Mobile Legends",
            packageName: selectedPack,
            amount,
            currency: region === "TH" ? "THB" : "MMK",
            region,
            paymentMethod,
            username,
            userId: userId.value.trim(),
            zoneId: serverId.value.trim()
        });
    });

    // logo top
    const logo = document.querySelector(".logo");

    if (logo) {
        logo.addEventListener("click", () => {
            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });
        });
    }

});