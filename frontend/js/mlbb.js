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
    userId.addEventListener("input", checkForm);
    serverId.addEventListener("input", checkForm);

    function checkForm() {

        if (
            userId.value.trim() !== "" &&
            serverId.value.trim() !== "" &&
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

    // buy now
    buyBtn.addEventListener("click", async () => {
        const username = localStorage.getItem("username") || "guest";

        try {
            const res = await fetch("/api/order", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    game: "Mobile Legends",
                    userId: userId.value.trim(),
                    zoneId: serverId.value.trim(),
                    packageName: selectedPack,
                    username: username
                })
            });

            const data = await res.json();

            if (data.success) {
                alert("Order sent successfully ✅");
            } else {
                alert(data.message || "Order failed");
            }

        } catch (error) {
            alert("Server error. Please try again.");
            console.log(error);
        }
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