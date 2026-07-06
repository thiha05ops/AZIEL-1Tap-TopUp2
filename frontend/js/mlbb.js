// frontend/js/mlbb.js
// AZIEL V2.5 MLBB Controller
// Payment handled by /js/payment/* modules

document.addEventListener("DOMContentLoaded", () => {
    const buyBtn = document.getElementById("buyBtn");
    const userIdInput = document.getElementById("userId");
    const serverIdInput = document.getElementById("serverId");

    const selectedText = document.getElementById("selectedText");
    const summaryPackage = document.getElementById("summaryPackage");
    const summaryPayment = document.getElementById("summaryPayment");
    const summaryAmount = document.getElementById("summaryAmount");

    let selectedPack = null;
    let hasAutoScrolledToBuy = false;

    if (buyBtn) {
        buyBtn.innerText = "Continue To Payment";
    }

    document.addEventListener("click", e => {
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
            amount: Number(pack.dataset.price || 0)
        };

        const selectedIcon =
            pack.querySelector(".pack-icon img")?.src ||
            "assets/mlbb/icons/small.webp";

        const mobilePreviewIcon =
            document.querySelector(".mobile-pack-icon img");

        if (mobilePreviewIcon) {
            mobilePreviewIcon.src = selectedIcon;
        }

        updateState();
    });

    userIdInput?.addEventListener("input", updateState);
    serverIdInput?.addEventListener("input", updateState);
    document.addEventListener("paymentChanged", updateState);

    buyBtn?.addEventListener("click", async () => {
        const token =
            window.AZIEL?.getToken?.() ||
            localStorage.getItem("token") ||
            sessionStorage.getItem("token");

        if (!token) {
            const pendingBuy = {
                game: "Mobile Legends",
                selectedPackage: selectedPack,
                userId: userIdInput?.value.trim() || "",
                zoneId: serverIdInput?.value.trim() || "",
                paymentMethod: window.selectedPaymentData?.key || "",
                returnUrl: window.location.pathname
            };

            localStorage.setItem("pendingBuy", JSON.stringify(pendingBuy));
            window.location.href = "login.html";
            return;
        }

        if (buyBtn.disabled || !selectedPack) return;

        if (!window.AZIEL_PAYMENT?.start) {
            alert("Payment engine not loaded.");
            return;
        }

        const username =
            window.AZIEL?.user?.username ||
            localStorage.getItem("username") ||
            localStorage.getItem("email") ||
            "user";

        const region =
            window.AZIEL?.getShopRegion?.() ||
            localStorage.getItem("region") ||
            localStorage.getItem("selectedRegion") ||
            "MM";

        const currency =
            window.AZIEL?.getShopCurrency?.() ||
            (region === "TH" ? "THB" : "MMK");

        const selectedPayment = window.selectedPaymentData || {};

        const orderData = {
            orderId: "AZL-" + Date.now(),
            game: "Mobile Legends",
            packageName: selectedPack.name,
            amount: selectedPack.amount,
            currency,
            region,
            paymentMethod: selectedPayment.key || "",
            username,
            userId: userIdInput.value.trim(),
            zoneId: serverIdInput.value.trim() || "-",
            status: "pending_payment",
            paymentType: selectedPayment.paymentType || "manual",
            provider: selectedPayment.provider || "manual"
        };

        await window.AZIEL_PAYMENT.start(orderData);
    });

    function updateState() {
        const userId = userIdInput?.value.trim();
        const serverId = serverIdInput?.value.trim();
        const selectedPayment = window.selectedPaymentData || null;
        const paymentMethod = selectedPayment?.key || "";

        if (selectedPack) {
            const activePack = document.querySelector(".pack.active");

            if (activePack) {
                selectedPack.amount = Number(activePack.dataset.price || 0);
            }

            if (summaryPackage) {
                summaryPackage.innerText = selectedPack.name;
            }

            const region =
                window.AZIEL?.getShopRegion?.() ||
                localStorage.getItem("region") ||
                localStorage.getItem("selectedRegion") ||
                "MM";

            const symbol =
                window.AZIEL?.getShopSymbol?.() ||
                (region === "TH" ? "฿" : "Ks");

            if (summaryAmount) {
                summaryAmount.innerText =
                    `${selectedPack.amount.toLocaleString()} ${symbol}`;
            }

            if (selectedText) {
                selectedText.innerText = "Ready to continue payment.";
            }
        } else {
            if (summaryPackage) summaryPackage.innerText = "Not selected";
            if (summaryAmount) summaryAmount.innerText = "0";
            if (selectedText) selectedText.innerText = "Please select a package.";
        }

        if (summaryPayment) {
            summaryPayment.innerText =
                selectedPayment?.method || "Not selected";
        }

        if (buyBtn) {
            buyBtn.disabled =
                !(userId && serverId && selectedPack && paymentMethod);
        }

        if (userId && serverId && selectedPack && paymentMethod) {
            scrollToBuyNowOnce();
        }

        updateMobileSelectedPackage();
    }

    function initMobilePackagePanel() {
        const openBtn = document.getElementById("openPackagePanel");
        const closeBtn = document.getElementById("closePackagePanel");
        const confirmBtn = document.getElementById("confirmPackagePanel");
        const panel = document.getElementById("mobilePackagePanel");
        const list = document.getElementById("mobilePackageList");

        if (!openBtn || !closeBtn || !confirmBtn || !panel || !list) return;

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

        panel.addEventListener("click", e => {
            if (e.target === panel) closePanel();
        });
    }

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
            active.querySelector(".pack-price")?.innerText || "";
    }

    function scrollToBuyNowOnce() {
        if (hasAutoScrolledToBuy) return;

        if (!buyBtn) return;

        hasAutoScrolledToBuy = true;

        setTimeout(() => {
            buyBtn.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }, 250);
    }

    initMobilePackagePanel();
    updateState();

    window.addEventListener("aziel:shopRegionChanged", () => {
        const activePack = document.querySelector(".pack.active");
        const activeCode = activePack?.dataset.code;

        if (window.renderGamePrices) {
            window.renderGamePrices();
        }

        if (activeCode) {
            const newPack = document.querySelector(`.pack[data-code="${activeCode}"]`);

            if (newPack) {
                newPack.click();
            } else {
                selectedPack = null;
            }
        } else {
            selectedPack = null;
        }

        updateState();
    });

    window.addEventListener("aziel:ready", () => {
        if (window.renderGamePrices) {
            window.renderGamePrices();
        }

        updateState();
    });
});