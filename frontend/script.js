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

            selectedPackage = item.dataset.value;
            selectedText.innerText = "Selected: " + selectedPackage;
        });
    });

    buyBtn?.addEventListener("click", async () => {
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
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
                body: JSON.stringify({
                    username,
                    userId,
                    serverId,
                    selectedPackage
                })
            });

            const data = await res.json();

            if (data.success) {
                errorMsg.innerText = "✅ Order sent!";
                userIdInput.value = "";
                serverIdInput.value = "";
            } else {
                errorMsg.innerText = "❌ " + data.message;
            }

        } catch (error) {
            console.error(error);
            errorMsg.innerText = "❌ Server error!";
        }
    });

    function openMenu() {
        sideMenu?.classList.add("active");
        overlay?.classList.add("active");

        if (mainContent) {
            mainContent.classList.add("blur");
            mainContent.style.transform = "translateX(250px)";
        }

        menuOpen = true;
    }

    function closeMenu() {
        sideMenu?.classList.remove("active");
        overlay?.classList.remove("active");

        if (mainContent) {
            mainContent.classList.remove("blur");
            mainContent.style.transform = "translateX(0)";
        }

        menuOpen = false;
    }

    menuIcon?.addEventListener("click", () => {
        menuOpen ? closeMenu() : openMenu();
    });

    overlay?.addEventListener("click", closeMenu);
});
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

    const paymentMethod = document.getElementById("paymentMethod");
    const paymentInfo = document.getElementById("paymentInfo");
    const paymentScreenshot = document.getElementById("paymentScreenshot");

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

            selectedPackage = item.dataset.value;
            selectedText.innerText = "Selected: " + selectedPackage;
        });
    });

    paymentMethod?.addEventListener("change", () => {
        const method = paymentMethod.value;

        if (method === "WavePay") {
            paymentInfo.innerText = "WavePay Number: 09403630868";
        } else if (method === "SCB") {
            paymentInfo.innerText = "SCB Number: 4321919025";
        } else {
            paymentInfo.innerText = "";
        }
    });

    buyBtn?.addEventListener("click", async () => {
        const userId = userIdInput.value.trim();
        const serverId = serverIdInput.value.trim();
        const username = localStorage.getItem("username") || "User";
        const method = paymentMethod.value;
        const file = paymentScreenshot.files[0];

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

        if (!method) {
            errorMsg.innerText = "❌ Please select payment method!";
            return;
        }

        if (!file) {
            errorMsg.innerText = "❌ Please upload payment screenshot!";
            return;
        }

        const formData = new FormData();
        formData.append("username", username);
        formData.append("userId", userId);
        formData.append("serverId", serverId);
        formData.append("selectedPackage", selectedPackage);
        formData.append("paymentMethod", method);
        formData.append("screenshot", file);

        try {
            const res = await fetch("/api/order", {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + token
                },
                body: formData
            });

            const data = await res.json();

            if (data.success) {
                errorMsg.innerText = "✅ Order sent!";
                userIdInput.value = "";
                serverIdInput.value = "";
                paymentMethod.value = "";
                paymentInfo.innerText = "";
                paymentScreenshot.value = "";
                selectedText.innerText = "ဝယ်ယူလိုသော ပစ္စည်းကိုရွေးပါ";
                items.forEach(i => i.classList.remove("active"));
                selectedPackage = null;
            } else {
                errorMsg.innerText = "❌ " + data.message;
            }

        } catch (error) {
            console.error(error);
            errorMsg.innerText = "❌ Server error!";
        }
    });

    function openMenu() {
        sideMenu?.classList.add("active");
        overlay?.classList.add("active");

        if (mainContent) {
            mainContent.classList.add("blur");
            mainContent.style.transform = "translateX(250px)";
        }

        menuOpen = true;
    }

    function closeMenu() {
        sideMenu?.classList.remove("active");
        overlay?.classList.remove("active");

        if (mainContent) {
            mainContent.classList.remove("blur");
            mainContent.style.transform = "translateX(0)";
        }

        menuOpen = false;
    }

    menuIcon?.addEventListener("click", () => {
        menuOpen ? closeMenu() : openMenu();
    });

    overlay?.addEventListener("click", closeMenu);
});