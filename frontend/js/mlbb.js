// frontend/js/mlbb.js
// AZIEL V2.5 Payment Engine
// Wallet / PromptPay Auto / Deeplink Bank / Manual QR + Slip

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
        const paymentMethod = selectedPayment.key || "";

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
            paymentType: selectedPayment.paymentType || "manual",
            provider: selectedPayment.provider || "manual"
        };

        showOrderLoading();

        try {
            if (selectedPayment.key === "wallet") {
                await payWithWallet(orderData);
                return;
            }

            const paymentSession = await createPaymentSession(orderData);
            console.log("PAYMENT SESSION:", paymentSession);

            hideOrderLoading();
            showPaymentFlow(orderData, paymentSession);

        } catch (error) {
            console.log("Payment create error:", error);
            hideOrderLoading();
            alert(error.message || "Payment failed");
        }
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

            const symbol =
                window.AZIEL?.getShopSymbol?.() ||
                ((window.AZIEL?.getShopRegion?.() || "MM") === "TH" ? "฿" : "Ks");

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

    async function createPaymentSession(orderData) {
        const res = await fetch(apiUrl("/api/payment/create"), {
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

    function showPaymentFlow(orderData, paymentSession) {
        const selectedPayment = window.selectedPaymentData || {};
        const type =
            selectedPayment.paymentType ||
            paymentSession.paymentType ||
            "manual";

        if (type === "auto") {
            showPromptPayModal(orderData, paymentSession);
            startPaymentStatusPolling(orderData.orderId);
            return;
        }

        if (type === "deeplink") {
            showDeepLinkModal(orderData, paymentSession);
            return;
        }

        showManualPaymentModal(orderData, paymentSession);
    }

    function showPromptPayModal(orderData, paymentSession) {
        const modal = prepareBasePaymentModal(orderData, paymentSession);

        if (!modal) return;

        setModalModeTitle("Scan & Pay");
        showQrSection(paymentSession);
        hideAccountSection();
        removeManualSlipArea();

        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");

        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerText = "Waiting Payment...";
        }

        startPaymentCountdown(600);
        openPaymentModal();
    }

    function showDeepLinkModal(orderData, paymentSession) {
        const modal = prepareBasePaymentModal(orderData, paymentSession);

        if (!modal) return;

        const selectedPayment = window.selectedPaymentData || {};
        const provider = selectedPayment.provider || selectedPayment.key || orderData.paymentMethod;

        setModalModeTitle(`${selectedPayment.method || orderData.paymentMethod} Transfer`);
        hideQrSection();
        showAccountSection(paymentSession, selectedPayment);
        showOpenBankButton(provider, selectedPayment.method || orderData.paymentMethod);
        showManualSlipArea(orderData);

        startPaymentCountdown(600);
        openPaymentModal();
    }

    function showManualPaymentModal(orderData, paymentSession) {
        const modal = prepareBasePaymentModal(orderData, paymentSession);

        if (!modal) return;

        const selectedPayment = window.selectedPaymentData || {};

        setModalModeTitle("Scan & Upload Slip");
        showQrSection(paymentSession);
        showAccountSection(paymentSession, selectedPayment);
        removeOpenBankButton();
        showManualSlipArea(orderData);

        startPaymentCountdown(600);
        openPaymentModal();
    }

    function prepareBasePaymentModal(orderData, paymentSession) {
        const modal = document.getElementById("paymentConfirmModal");

        if (!modal) {
            alert("Payment modal not found");
            return null;
        }

        setText("modalOrderId", orderData.orderId);
        setText("modalGame", orderData.game);
        setText("modalPackage", orderData.packageName);
        setText("modalAmount", `${orderData.amount.toLocaleString()} ${orderData.currency}`);
        setText(
            "modalPayment",
            paymentSession.paymentName ||
            window.selectedPaymentData?.method ||
            orderData.paymentMethod
        );
        setText("modalUserId", orderData.userId);
        setText("modalZoneId", orderData.zoneId);

        const logo = document.getElementById("modalPaymentLogo");
        const selectedPayment = window.selectedPaymentData || {};
        const logoPath = paymentSession.logo || selectedPayment.logo || "";

        if (logo) {
            logo.src = normalizeUrl(logoPath);
            logo.style.display = logoPath ? "block" : "none";
        }

        let amountBox = document.getElementById("modalAmountBig");

        const host =
            document.querySelector(".payment-confirm-box") ||
            document.querySelector(".payment-modal-box") ||
            modal.querySelector("div");

        if (!amountBox && host) {
            amountBox = document.createElement("div");
            amountBox.id = "modalAmountBig";
            amountBox.className = "payment-amount-big";
            host.appendChild(amountBox);
        }

        if (amountBox) {
            amountBox.innerText =
                `${orderData.amount.toLocaleString()} ${orderData.currency}`;
        }

        let timerBox = document.getElementById("paymentTimer");

        if (!timerBox && host) {
            timerBox = document.createElement("div");
            timerBox.id = "paymentTimer";
            timerBox.className = "payment-timer";
            timerBox.innerHTML = `Payment expires in <span id="countdown">10:00</span>`;
            host.appendChild(timerBox);
        }

        const closeBtn = document.getElementById("closePaymentModal");

        if (closeBtn) {
            closeBtn.onclick = () => {
                stopPaymentStatusPolling();
                stopPaymentCountdown();
                modal.classList.remove("show");
            };
        }

        return modal;
    }

    function setModalModeTitle(title) {
        const box =
            document.querySelector(".payment-confirm-box") ||
            document.querySelector(".payment-modal-box");

        const heading =
            box?.querySelector("h2") ||
            box?.querySelector("h3");

        if (heading) {
            heading.innerText = title;
        }
    }

    function showQrSection(paymentSession) {
        const qr = document.getElementById("modalQrImage");
        const selectedPayment = window.selectedPaymentData || {};

        const qrPath =
            paymentSession.qrUrl ||
            paymentSession.qrImage ||
            selectedPayment.qrImage ||
            "";

        const finalQr = normalizeUrl(qrPath);

        if (!qr) return;

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
                qr.style.display = "none";
            };
        } else {
            qr.removeAttribute("src");
            qr.style.display = "none";
        }
    }

    function hideQrSection() {
        const qr = document.getElementById("modalQrImage");

        if (qr) {
            qr.removeAttribute("src");
            qr.style.display = "none";
        }
    }

    function showAccountSection(paymentSession, selectedPayment) {
        const accountName = document.getElementById("modalAccountName");
        const accountNumber = document.getElementById("modalAccountNumber");

        const name =
            paymentSession.accountName ||
            selectedPayment.accountName ||
            "";

        const number =
            paymentSession.accountNumber ||
            selectedPayment.accountNumber ||
            "";

        if (accountName) {
            accountName.innerText = name;
            accountName.parentElement.style.display = name ? "" : "none";
        }

        if (accountNumber) {
            accountNumber.innerText = number;
            accountNumber.parentElement.style.display = number ? "" : "none";
        }
    }

    function hideAccountSection() {
        const accountName = document.getElementById("modalAccountName");
        const accountNumber = document.getElementById("modalAccountNumber");

        if (accountName?.parentElement) accountName.parentElement.style.display = "none";
        if (accountNumber?.parentElement) accountNumber.parentElement.style.display = "none";
    }

    function showOpenBankButton(provider, label) {
        removeOpenBankButton();

        const host =
            document.querySelector(".payment-confirm-box") ||
            document.querySelector(".payment-modal-box");

        if (!host) return;

        const btn = document.createElement("button");
        btn.id = "openBankAppBtn";
        btn.type = "button";
        btn.className = "open-bank-app-btn";
        btn.innerText = `Open ${label} App`;

        btn.onclick = () => {
            const link = getBankDeepLink(provider);

            if (!link) {
                alert("Bank app link is not available yet.");
                return;
            }

            window.location.href = link;

            setTimeout(() => {
                const msg = document.getElementById("manualPaymentMsg");
                if (msg) {
                    msg.innerHTML = `
                        <p class="success-msg">
                            After transfer, return here and upload your payment slip.
                        </p>
                    `;
                }
            }, 900);
        };

        host.appendChild(btn);
    }

    function removeOpenBankButton() {
        document.getElementById("openBankAppBtn")?.remove();
    }

    function showManualSlipArea(orderData) {
        removeManualSlipArea();

        const host =
            document.querySelector(".payment-confirm-box") ||
            document.querySelector(".payment-modal-box");

        if (!host) return;

        const wrap = document.createElement("div");
        wrap.id = "manualSlipArea";
        wrap.className = "manual-slip-area";

        wrap.innerHTML = `
            <div class="manual-payment-note">
                <strong>Already paid?</strong>
                <span>Upload payment slip and wait for admin verification.</span>
            </div>

            <label class="manual-slip-upload">
                <span>Upload Payment Slip</span>
                <input type="file" id="manualPaymentSlip" accept="image/*">
            </label>

            <div id="manualSlipPreviewBox" class="manual-slip-preview" style="display:none;">
                <img id="manualSlipPreviewImage" src="" alt="Payment Slip">
                <button type="button" id="removeManualSlipBtn">Remove</button>
            </div>

            <div id="manualPaymentMsg"></div>
        `;

        host.appendChild(wrap);

        const fileInput = document.getElementById("manualPaymentSlip");
        const previewBox = document.getElementById("manualSlipPreviewBox");
        const previewImg = document.getElementById("manualSlipPreviewImage");
        const removeBtn = document.getElementById("removeManualSlipBtn");

        fileInput?.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            if (!file) return;

            const reader = new FileReader();

            reader.onload = e => {
                if (previewImg) previewImg.src = e.target.result;
                if (previewBox) previewBox.style.display = "block";
            };

            reader.readAsDataURL(file);
        });

        removeBtn?.addEventListener("click", () => {
            fileInput.value = "";
            if (previewImg) previewImg.src = "";
            if (previewBox) previewBox.style.display = "none";
        });

        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");

        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerText = "Submit Payment Slip";

            confirmBtn.onclick = async () => {
                await submitManualSlip(orderData);
            };
        }
    }

    function removeManualSlipArea() {
        document.getElementById("manualSlipArea")?.remove();

        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");

        if (confirmBtn) {
            confirmBtn.onclick = null;
        }
    }

    async function submitManualSlip(orderData) {
        const fileInput = document.getElementById("manualPaymentSlip");
        const msg = document.getElementById("manualPaymentMsg");
        const confirmBtn = document.getElementById("confirmPaymentOrderBtn");

        const slip = fileInput?.files?.[0];

        if (!slip) {
            setMsg(msg, "Please upload payment slip.", "error");
            return;
        }

        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerText = "Submitting...";
        }

        const formData = new FormData();
        formData.append("orderId", orderData.orderId);
        formData.append("slip", slip);

        try {
            const res = await fetch(apiUrl("/api/payment/submit"), {
                method: "POST",
                body: formData
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                setMsg(msg, data.message || "Slip submit failed.", "error");

                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.innerText = "Submit Payment Slip";
                }

                return;
            }

            stopPaymentCountdown();

            const modal = document.getElementById("paymentConfirmModal");
            if (modal) modal.classList.remove("show");

            showSuccessModal(orderData.orderId);

        } catch (error) {
            console.log("Slip submit error:", error);
            setMsg(msg, "Server error", "error");

            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerText = "Submit Payment Slip";
            }
        }
    }

    function openPaymentModal() {
        const modal = document.getElementById("paymentConfirmModal");
        if (modal) modal.classList.add("show");
    }

    function startPaymentStatusPolling(orderId) {
        stopPaymentStatusPolling();

        paymentCheckTimer = setInterval(async () => {
            try {
                const res = await fetch(apiUrl(`/api/payment/status/${orderId}`));
                const data = await res.json();

                if (!data.success) return;

                if (data.status === "paid") {
                    stopPaymentStatusPolling();
                    stopPaymentCountdown();

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

    initMobilePackagePanel();
    initSuccessModal();
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

// WALLET PAYMENT
async function payWithWallet(orderData) {
    try {
        const res = await fetch(apiUrl("/api/wallet/pay"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(orderData)
        });

        const data = await res.json();

        hideOrderLoading();

        if (!data.success) {
            alert(data.message || "Wallet payment failed");
            return;
        }

        alert("Paid with wallet ✅");

        window.location.href =
            `tracking.html?orderId=${orderData.orderId}`;

    } catch (error) {
        console.log(error);
        hideOrderLoading();
        alert("Server error");
    }
}

function getBankDeepLink(provider) {
    const p = String(provider || "").toLowerCase();

    const iosLinks = {
        scb: "scbeasy://",
        kplus: "kplus://",
        kbANK: "kplus://",
        ktb: "krungthainext://",
        bangkok: "bualuangmbanking://",
        bbl: "bualuangmbanking://",
        krungsri: "kma://",
        ttb: "ttbtouch://"
    };

    const androidLinks = {
        scb: "intent://#Intent;scheme=scbeasy;package=com.scb.phone;end;",
        kplus: "intent://#Intent;scheme=kplus;package=com.kasikorn.retail.mbanking.wap;end;",
        ktb: "intent://#Intent;scheme=krungthainext;package=ktbcs.netbank;end;",
        bangkok: "intent://#Intent;scheme=bualuangmbanking;package=com.bbl.mobilebanking;end;",
        bbl: "intent://#Intent;scheme=bualuangmbanking;package=com.bbl.mobilebanking;end;",
        krungsri: "intent://#Intent;scheme=kma;package=com.krungsri.kma;end;",
        ttb: "intent://#Intent;scheme=ttbtouch;package=com.TMBTOUCH.PRODUCTION;end;"
    };

    const isAndroid = /android/i.test(navigator.userAgent);

    return isAndroid
        ? androidLinks[p] || iosLinks[p] || ""
        : iosLinks[p] || "";
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

    if (title) title.innerText = "Payment Submitted";
    if (text) {
        text.innerText =
            "Your payment is submitted. Admin will process your top-up soon.";
    }

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

    stopPaymentCountdown();

    function updateTimer() {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;

        countdown.innerText =
            `${m}:${String(s).padStart(2, "0")}`;

        if (seconds <= 0) {
            stopPaymentCountdown();

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

function stopPaymentCountdown() {
    if (paymentCountdownTimer) {
        clearInterval(paymentCountdownTimer);
        paymentCountdownTimer = null;
    }
}

function apiUrl(path) {
    if (window.AZIEL?.apiUrl) {
        return window.AZIEL.apiUrl(path);
    }

    const base =
        location.port === "5500"
            ? "http://localhost:3000"
            : "";

    return `${base}${path}`;
}

function normalizeUrl(path) {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    if (path.startsWith("data:")) return path;

    path = path.replace(/^\/+/, "");
    path = path.replace(/^frontend\//, "");

    if (location.port === "5500") {
        return path;
    }

    return path.startsWith("assets/")
        ? path
        : `/${path}`;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value || "";
}

function setMsg(el, message, type = "success") {
    if (!el) return;

    el.innerHTML = `
        <p class="${type === "error" ? "error-msg" : "success-msg"}">
            ${escapeHTML(message)}
        </p>
    `;
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}