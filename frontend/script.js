document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const items = document.querySelectorAll(".item");
    const buyBtn = document.getElementById("buyBtn");
    const userIdInput = document.getElementById("userId");
    const serverIdInput = document.getElementById("serverId");
    const errorMsg = document.getElementById("errorMsg");
    const selectedText = document.getElementById("selectedText");

    const menuIcon = document.getElementById("menuIcon");
    const sideMenu = document.getElementById("sideMenu");
    const overlay = document.getElementById("overlay");
    const mainContent = document.getElementById("mainContent");

    let selectedPackage = null;
    let menuOpen = false;

    items.forEach(item => {
        item.addEventListener("click", () => {
            items.forEach(i => i.classList.remove("active"));
            item.classList.add("active");
            selectedPackage = item.getAttribute("data-value");
            selectedText.innerText = "Selected: " + selectedPackage;
        });
    });

    buyBtn.addEventListener("click", async () => {
        const userId = userIdInput.value.trim();
        const serverId = serverIdInput.value.trim();
        const username = localStorage.getItem("username") || "User";

        errorMsg.innerText = "";

        if (!selectedPackage) {
            errorMsg.innerText = "❌ Please select a package!";
            return;
        }

        if (!userId) {
            errorMsg.innerText = "❌ Please enter User ID!";
            return;
        }

        if (!serverId) {
            errorMsg.innerText = "❌ Please enter Server Code!";
            return;
        }

        try {
            const res = await fetch("/api/order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, userId, serverId, selectedPackage })
            });

            const data = await res.json();
            errorMsg.innerText = data.success ? "✅ Order sent!" : "❌ " + data.message;
        } catch (err) {
            errorMsg.innerText = "❌ Server error!";
            console.log(err);
        }
    });

    function openMenu() {
        sideMenu.classList.add("active");
        overlay.classList.add("active");
        mainContent.classList.add("blur");
        mainContent.style.transform = "translateX(250px)";
        menuOpen = true;
    }

    function closeMenu() {
        sideMenu.classList.remove("active");
        overlay.classList.remove("active");
        mainContent.classList.remove("blur");
        mainContent.style.transform = "translateX(0)";
        menuOpen = false;
    }

    menuIcon.addEventListener("click", () => {
        menuOpen ? closeMenu() : openMenu();
    });

    overlay.addEventListener("click", closeMenu);
});