// frontend/js/mlbb.js - AZIEL V2.5 Semi-Auto Flow

document.addEventListener("DOMContentLoaded", () => {
    const buyBtn = document.getElementById("buyBtn");
    const userIdInput = document.getElementById("userId");
    const serverIdInput = document.getElementById("serverId");

    const selectedText = document.getElementById("selectedText");
    const summaryPackage = document.getElementById("summaryPackage");
    const summaryPayment = document.getElementById("summaryPayment");
    const summaryAmount = document.getElementById("summaryAmount");

    let selectedPack = null;
    let paymentCheckTimer = null;

    if (buyBtn) {
        buyBtn.innerText = "Continue To Payment";
    }

    document.addEventListener("click", (e) => {
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

        const token = localStorage.getItem("token");

        if (!token) {
            const pendingBuy = {
                game: "Mobile Legends",
                selectedPackage: selectedPack,
                userId: userIdInput?.value.trim() || "",
                zoneId: serverIdInput?.value.trim() || "",
                paymentMethod: document.getElementById("paymentMethod")?.value || "",
                returnUrl: window.location.pathname
            };

            localStorage.setItem("pendingBuy", JSON.stringify(pendingBuy));
            window.location.href = "login.html";
            return;
        }

        if (buyBtn.disabled || !selectedPack) return;

        const username = localStorage.getItem("username") || "user";
        const region =
            localStorage.getItem("region") ||
            localStorage.getItem("selectedRegion") ||
            "MM";

        const currency = region === "TH" ? "THB" : "MMK";
        const paymentMethod =
            document.getElementById("paymentMethod")?.value || "";

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
            zoneId: serverIdInput.value.trim() || "-",
            status: "pending_payment",

            paymentType: window.selectedPaymentData?.paymentType || "manual",
            provider: window.selectedPaymentData?.provider || "manual",
        };

        showOrderLoading();

        try {
            if (paymentMethod === "wallet") {
                await payWithWallet(orderData);
                return;
            }

            const paymentSession = await createPaymentSession(orderData);
            console.log("PAYMENT SESSION:", paymentSession);

            hideOrderLoading();

            showPaymentWaitingModal(orderData, paymentSession);

            startPaymentStatusPolling(orderId);

        } catch (error) {
            console.log("Payment create error:", error);
            hideOrderLoading();
            alert(error.message || "Payment failed");
        }
    });

    function updateState() {
        const userId = userIdInput?.value.trim();
        const serverId = serverIdInput?.value.trim();
        const paymentMethod =
            document.getElementById("paymentMethod")?.value || "";

        const selectedPayment = window.selectedPaymentData;

        if (selectedPack) {
            summaryPackage.innerText = selectedPack.name;

            const region =
                localStorage.getItem("region") ||
                localStorage.getItem("selectedRegion") ||
                "MM";

            const currencySymbol = region === "TH" ? "฿" : "Ks";

            summaryAmount.innerText =
                `${selectedPack.amount.toLocaleString()} ${currencySymbol}`;

            selectedText.innerText =
                "Ready to continue payment.";
        } else {
            summaryPackage.innerText = "Not selected";
            summaryAmount.innerText = "0 Ks";
            selectedText.innerText = "Please select a package.";
        }

        summaryPayment.innerText =
            selectedPayment?.method ||
            paymentMethod ||
            "Not selected";

        buyBtn.disabled =
            !(userId && serverId && selectedPack && paymentMethod);

        if (userId && serverId && selectedPack && paymentMethod) {
            scrollToBuyNowOnce();
        }

        updateMobileSelectedPackage();
    }

    initMobilePackagePanel();
    initSuccessModal();
    updateState();

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

        panel.addEventListener("click", (e) => {
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
            active.querySelector(".pack-price")?.innerText ||
            "";
    }

    async function createPaymentSession(orderData) {
        const res = await fetch("/api/payment/create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        console.log("PAYMENT CREATE DATA =", data);

        if (!res.ok || !data.success) {
            throw new Error(data.message || "Create payment failed");
        }

        return data;
    }

    function showPaymentWaitingModal(orderData, paymentSession) {
        const modal = document.getElementById("paymentConfirmModal");

        if (!modal) {
            alert("Payment modal not found");
            return;
        }

        document.getElementById("modalOrderId").innerText = orderData.orderId;
        document.getElementById("modalGame").innerText = orderData.game;
        document.getElementById("modalPackage").innerText = orderData.packageName;
        document.getElementById("modalAmount").innerText =
            `${orderData.amount.toLocaleString()} ${orderData.currency}`;
        document.getElementById("modalPayment").innerText =
            paymentSession.paymentName ||
            window.selectedPaymentData?.method ||
            orderData.paymentMethod;
        document.getElementById("modalUserId").innerText = orderData.userId;
        document.getElementById("modalZoneId").innerText = orderData.zoneId;

        const logo = document.getElementById("modalPaymentLogo");
        const qr = document.getElementById("modalQrImage");
        const accountName = document.getElementById("modalAccountName");
        const accountNumber = document.getElementById("modalAccountNumber");

        const selectedPayment = window.selectedPaymentData || {};

        const logoPath =
            paymentSession.logo ||
            selectedPayment.logo ||
            "";

        const qrPath =
            paymentSession.qrUrl ||
            paymentSession.qrImage ||
            "";

        const finalQr = qrPath
            ? qrPath.startsWith("http")
                ? qrPath
                : `${window.location.origin}${qrPath}`
            : "";

        console.log("PAYMENT SESSION =", paymentSession);
        console.log("FINAL QR =", finalQr);

        if (logo) {
            logo.src = logoPath;
            logo.style.display = logoPath ? "block" : "none";
        }

        if (qr) {
            if (finalQr) {
                qr.src = finalQr;
                qr.style.display = "block";
                qr.style.width = "220px";
                qr.style.height = "220px";
                qr.style.objectFit = "contain";
                qr.style.background = "#fff";
                qr.style.padding = "10px";

                qr.onerror = () => {
                    console.error("QR image failed:", finalQr);
                };
            } else {
                qr.removeAttribute("src");
                qr.style.display = "none";
                console.warn("QR URL not returned from backend");
            }
        }

        if (accountName) {
            accountName.innerText =
                paymentSession.accountName ||
                selectedPayment.accountName ||
                "";
        }

        if (accountNumber) {
            accountNumber.innerText =
                paymentSession.accountNumber ||
                selectedPayment.accountNumber ||
                "";
        }

        let amountBox = document.getElementById("modalAmountBig");

        if (!amountBox && qr?.parentElement) {
            amountBox = document.createElement("div");
            amountBox.id = "modalAmountBig";
            amountBox.className = "payment-amount-big";
            qr.parentElement.appendChild(amountBox);
        }

        if (amountBox) {
            amountBox.innerText =
                `${orderData.amount.toLocaleString()} ${orderData.currency}`;
        }

        let timerBox = document.getElementById("paymentTimer");

        if (!timerBox && qr?.parentElement) {
            timerBox = document.createElement("div");
            timerBox.id = "paymentTimer";
            timerBox.className = "payment-timer";
            timerBox.innerHTML =
                `Payment expires in <span id="countdown">10:00</span>`;
            qr.parentElement.appendChild(timerBox);
        }

        startPaymentCountdown(600);
        removeSlipElementsFromModal();

        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");

        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerText = "Waiting Payment...";
        }

        modal.classList.add("show");

        const closeBtn = document.getElementById("closePaymentModal");

        if (closeBtn) {
            closeBtn.onclick = () => {
                stopPaymentStatusPolling();
                modal.classList.remove("show");
            };
        }
    }

    function removeSlipElementsFromModal() {
        const slipInput = document.getElementById("modalPaymentSlip");
        if (slipInput) slipInput.remove();

        const labels = document.querySelectorAll(".payment-confirm-box label");
        labels.forEach(label => {
            if (label.innerText.toLowerCase().includes("upload")) {
                label.remove();
            }
        });
    }

    function startPaymentStatusPolling(orderId) {
        stopPaymentStatusPolling();

        paymentCheckTimer = setInterval(async () => {
            try {
                const res = await fetch(`/api/payment/status/${orderId}`);
                const data = await res.json();

                if (!data.success) return;

                if (data.status === "paid") {
                    stopPaymentStatusPolling();

                    const modal = document.getElementById("paymentConfirmModal");
                    if (modal) modal.classList.remove("show");

                    showSuccessModal(orderId);
                }

            } catch (error) {
                console.log("Payment status check error:", error);
            }
        }, 3000);
    }

    function stopPaymentStatusPolling() {
        if (paymentCheckTimer) {
            clearInterval(paymentCheckTimer);
            paymentCheckTimer = null;
        }
    }
});

// =========================
// WALLET PAYMENT
// =========================

async function payWithWallet(orderData) {
    try {
        const res = await fetch("/api/wallet/pay", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Wallet payment failed");
            return;
        }

        alert("Paid with wallet ✅");

        window.location.href =
            `tracking.html?orderId=${orderData.orderId}`;

    } catch (error) {
        console.log(error);
        alert("Server error");
    }
}

let hasAutoScrolledToBuy = false;

function scrollToBuyNowOnce() {
    if (hasAutoScrolledToBuy) return;

    const buyBtn = document.getElementById("buyBtn");
    if (!buyBtn) return;

    hasAutoScrolledToBuy = true;

    setTimeout(() => {
        buyBtn.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }, 250);
}

function showOrderLoading() {
    const overlay = document.getElementById("orderLoadingOverlay");
    if (!overlay) return;

    overlay.classList.add("show");
}

function hideOrderLoading() {
    const overlay = document.getElementById("orderLoadingOverlay");
    if (!overlay) return;

    overlay.classList.remove("show");
}

let lastOrderId = "";

function showSuccessModal(orderId) {
    lastOrderId = orderId;

    const modal = document.getElementById("successModal");
    if (!modal) return;

    const title = modal.querySelector("h2");
    const text = modal.querySelector("p");

    if (title) title.innerText = "Payment Success";
    if (text) text.innerText = "Your payment has been detected. Admin will process your top-up soon.";

    modal.classList.add("show");
}

function initSuccessModal() {
    const trackBtn = document.getElementById("trackOrderBtn");
    const homeBtn = document.getElementById("backHomeBtn");

    if (trackBtn) {
        trackBtn.addEventListener("click", () => {
            window.location.href = `tracking.html?orderId=${lastOrderId}`;
        });
    }

    if (homeBtn) {
        homeBtn.addEventListener("click", () => {
            window.location.href = "home.html";
        });
    }
}
let paymentCountdownTimer = null;

function startPaymentCountdown(seconds) {
    const countdown = document.getElementById("countdown");
    if (!countdown) return;

    if (paymentCountdownTimer) {
        clearInterval(paymentCountdownTimer);
    }

    function updateTimer() {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;

        countdown.innerText =
            `${m}:${String(s).padStart(2, "0")}`;

        if (seconds <= 0) {
            clearInterval(paymentCountdownTimer);
            paymentCountdownTimer = null;

            const btn = document.getElementById("confirmPaymentOrderBtn");
            if (btn) {
                btn.innerText = "Payment Expired";
                btn.disabled = true;
            }

            return;
        }

        seconds--;
    }

    updateTimer();
    paymentCountdownTimer = setInterval(updateTimer, 1000);
}