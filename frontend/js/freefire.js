// frontend/js/freefire.js

document.addEventListener("DOMContentLoaded", () => {

    console.log("Free Fire Page Loaded ✅");

    const buyBtn = document.getElementById("buyBtn");
    const userId = document.getElementById("userId");

    let selectedPack = "";

    function getPacks() {
        return document.querySelectorAll(".pack");
    }

    function checkForm() {
        if (
            userId.value.trim() !== "" &&
            selectedPack !== ""
        ) {
            buyBtn.disabled = false;
            buyBtn.style.opacity = "1";
        } else {
            buyBtn.disabled = true;
            buyBtn.style.opacity = ".6";
        }
    }

    function setupPackageClick() {
        const packs = getPacks();

        packs.forEach(pack => {
            pack.addEventListener("click", () => {

                packs.forEach(p => p.classList.remove("active"));
                pack.classList.add("active");

                selectedPack = pack.innerText.trim();

                checkForm();
            });
        });
    }

    userId.addEventListener("input", checkForm);

    setupPackageClick();
    checkForm();

    buyBtn.addEventListener("click", async () => {

        const username = localStorage.getItem("username") || "guest";
        const region = localStorage.getItem("region") || "MM";
        const paymentMethod = document.getElementById("paymentMethod")?.value;

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
            game: "Free Fire",
            packageName: selectedPack,
            amount,
            currency: region === "TH" ? "THB" : "MMK",
            region,
            paymentMethod,
            username,
            userId: userId.value.trim(),
            zoneId: ""
        });

    });

});