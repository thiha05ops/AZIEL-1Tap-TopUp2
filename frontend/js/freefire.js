// frontend/js/freefire.js

document.addEventListener("DOMContentLoaded", () => {

    console.log("Free Fire Page Loaded ✅");

    const packs = document.querySelectorAll(".pack");
    const buyBtn = document.getElementById("buyBtn");
    const userId = document.getElementById("userId");

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
    userId.addEventListener("input", checkForm);

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

    // start disabled
    checkForm();

    // buy
    buyBtn.addEventListener("click", () => {

        alert(
            `Order Confirmed ✅

Game: Free Fire
Player UID: ${userId.value}
Package: ${selectedPack}`
        );

    });

    // logo scroll top
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