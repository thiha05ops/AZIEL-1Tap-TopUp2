// frontend/js/game-flow.js
// Shared game/product order flow for AZIEL V2.5.

(function () {
    const DEFAULTS = {
        buyButtonSelector: "#buyBtn",
        packageSummarySelector: "#summaryPackage",
        amountSummarySelector: "#summaryAmount",
        paymentSummarySelector: "#summaryPayment",
        noteSelector: "#selectedText",
        paymentMethodSelector: "#paymentMethod",
        userIdSelector: "#userId",
        zoneIdSelector: "#serverId",
        zoneRequired: false,
        status: "pending_payment",
        directWallet: false,
        legacyPaymentPreferred: false,
        pendingReturnUrl: window.location.pathname
    };

    const paymentNameMap = {
        wallet: "AZIEL Wallet",
        kbzpay: "KBZPay",
        wavepay: "WavePay",
        ayapay: "AYA Pay",
        promptpay: "PromptPay",
        scb: "SCB"
    };

    function onReady(callback) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", callback);
        } else {
            callback();
        }
    }

    function init(config = {}) {
        const flow = {
            config: {
                ...DEFAULTS,
                ...config
            },
            hasAutoScrolledToBuy: false
        };

        onReady(() => setup(flow));
        return flow;
    }

    function setup(flow) {
        const buyBtn = getEl(flow.config.buyButtonSelector);
        if (buyBtn) buyBtn.innerText = buyBtn.innerText || "Continue To Payment";

        bindFieldEvents(flow);
        bindFlowEvents(flow);
        bindBuyButton(flow);
        initMobilePackagePanel(flow);
        claimSummaryElements(flow);
        restorePendingBuy(flow);
        updateSummary(flow);

        document.dispatchEvent(
            new CustomEvent("game-flow:ready", {
                detail: {
                    gameKey: flow.config.gameKey || "",
                    game: flow.config.game || ""
                }
            })
        );
    }

    function bindFieldEvents(flow) {
        getEl(flow.config.userIdSelector)?.addEventListener("input", () => {
            updateSummary(flow);
        });

        getEl(flow.config.zoneIdSelector)?.addEventListener("input", () => {
            updateSummary(flow);
        });

        getEl(flow.config.zoneIdSelector)?.addEventListener("change", () => {
            updateSummary(flow);
        });
    }

    function bindFlowEvents(flow) {
        [
            "packageSelected",
            "package:selected",
            "package:cleared",
            "pricesRendered",
            "prices:rendered",
            "paymentChanged"
        ].forEach(eventName => {
            document.addEventListener(eventName, () => updateSummary(flow));
        });

        window.addEventListener("aziel:shopRegionChanged", () => {
            updateSummary(flow);
        });
    }

    function bindBuyButton(flow) {
        const buyBtn = getEl(flow.config.buyButtonSelector);
        if (!buyBtn) return;

        buyBtn.addEventListener("click", async () => {
            await submitOrder(flow);
        });
    }

    function getSelectedPackage() {
        const selected =
            window.getSelectedPackage?.() ||
            window.selectedPackage ||
            document.querySelector("#packages .pack.active");

        if (!selected) return null;

        if (selected instanceof Element) {
            return packageFromElement(selected);
        }

        return {
            ...selected,
            name: selected.name || selected.packageName || "",
            price: Number(selected.price || selected.amount || 0),
            amount: Number(selected.amount || selected.price || 0),
            code: selected.code || selected.packageCode || "",
            icon: selected.icon || "",
            formattedPrice: selected.formattedPrice || ""
        };
    }

    function getSelectedPayment() {
        const selectedPayment = window.selectedPaymentData || null;
        const paymentInput = document.getElementById("paymentMethod");
        const activeCard = document.querySelector("#paymentGrid .pay-card.active");
        const key =
            selectedPayment?.key ||
            paymentInput?.value ||
            activeCard?.dataset.method ||
            "";

        if (!key) return null;

        return {
            key,
            method:
                selectedPayment?.method ||
                activeCard?.dataset.name ||
                activeCard?.querySelector(".pay-info span, span")?.textContent?.trim() ||
                paymentNameMap[key] ||
                key,
            paymentType:
                selectedPayment?.paymentType ||
                activeCard?.dataset.paymentType ||
                "manual",
            provider:
                selectedPayment?.provider ||
                activeCard?.dataset.provider ||
                "manual"
        };
    }

    function getRegion() {
        return (
            window.AZIEL?.getShopRegion?.() ||
            localStorage.getItem("selectedRegion") ||
            localStorage.getItem("region") ||
            "MM"
        );
    }

    function getCurrency() {
        return (
            window.AZIEL?.getShopCurrency?.() ||
            (getRegion() === "TH" ? "THB" : "MMK")
        );
    }

    function getSymbol() {
        return (
            window.AZIEL?.getShopSymbol?.() ||
            (getRegion() === "TH" ? "฿" : "Ks")
        );
    }

    function getFieldValue(selector) {
        const el = getEl(selector);
        return String(el?.value || "").trim();
    }

    function getReadiness(flow) {
        const pkg = getSelectedPackage();
        const payment = getSelectedPayment();
        const userId = getFieldValue(flow.config.userIdSelector);
        const zoneId = getFieldValue(flow.config.zoneIdSelector);
        const amount = Number(pkg?.price || 0);

        if (!pkg) {
            return {
                ready: false,
                reason: "Please select a package."
            };
        }

        if (!amount || amount <= 0) {
            return {
                ready: false,
                reason: "This package is not available yet."
            };
        }

        if (!userId) {
            return {
                ready: false,
                reason: flow.config.userIdRequiredMessage || "Please enter your account information."
            };
        }

        if (flow.config.zoneRequired && !zoneId) {
            return {
                ready: false,
                reason: flow.config.zoneRequiredMessage || "Please enter server information."
            };
        }

        if (!payment?.key) {
            return {
                ready: false,
                reason: "Please select a payment method."
            };
        }

        return {
            ready: true,
            reason: "Ready to continue payment."
        };
    }

    function updateSummary(flow) {
        const pkg = getSelectedPackage();
        const payment = getSelectedPayment();
        const readiness = getReadiness(flow);
        const symbol = getSymbol();

        setText(
            flow.config.packageSummarySelector,
            pkg?.name || "Not selected"
        );

        setText(
            flow.config.amountSummarySelector,
            pkg
                ? `${Number(pkg.price || 0).toLocaleString()} ${symbol}`
                : `0 ${symbol}`
        );

        setText(
            flow.config.paymentSummarySelector,
            payment?.method || "Not selected"
        );

        setText(flow.config.noteSelector, readiness.reason);

        const buyBtn = getEl(flow.config.buyButtonSelector);
        if (buyBtn) buyBtn.disabled = !readiness.ready;

        document.dispatchEvent(
            new CustomEvent("order-summary:changed", {
                detail: {
                    package: pkg,
                    payment,
                    ready: readiness.ready,
                    reason: readiness.reason,
                    gameKey: flow.config.gameKey || ""
                }
            })
        );

        if (readiness.ready) scrollToBuyOnce(flow);
    }

    function buildOrderData(flow) {
        const pkg = getSelectedPackage();
        const payment = getSelectedPayment();
        const region = getRegion();
        const currency = getCurrency();
        const user =
            window.AZIEL?.user ||
            readStoredUser();

        const username =
            user?.username ||
            localStorage.getItem("username") ||
            sessionStorage.getItem("username") ||
            "guest";

        return {
            orderId: "AZL-" + Date.now(),
            game: flow.config.game,
            gameKey: flow.config.gameKey,
            packageName: pkg.name,
            packageCode: pkg.code || "",
            amount: Number(pkg.price || 0),
            currency,
            region,
            paymentMethod: payment.key,
            username,
            userId: getFieldValue(flow.config.userIdSelector),
            zoneId: getFieldValue(flow.config.zoneIdSelector) || "-",
            status: flow.config.status || "pending_payment",
            paymentType: payment.paymentType || "manual",
            provider: payment.provider || "manual"
        };
    }

    async function submitOrder(flow) {
        const readiness = getReadiness(flow);

        if (!readiness.ready) {
            setText(flow.config.noteSelector, readiness.reason);
            return;
        }

        if (!hasToken()) {
            storePendingBuy(flow);
            window.location.href = "login.html";
            return;
        }

        const orderData = buildOrderData(flow);

        if (!orderData.amount || orderData.amount <= 0) {
            setText(flow.config.noteSelector, "This package is not available yet.");
            return;
        }

        if (
            flow.config.directWallet &&
            orderData.paymentMethod === "wallet"
        ) {
            await payWithWalletDirect(orderData, flow);
            return;
        }

        if (
            flow.config.legacyPaymentPreferred &&
            typeof window.createPaymentAndRedirect === "function"
        ) {
            window.createPaymentAndRedirect(orderData);
            return;
        }

        if (!window.AZIEL_PAYMENT?.start) {
            setText(flow.config.noteSelector, "Payment system not ready. Please refresh and try again.");
            window.PaymentUtils?.showToast?.("Payment system not ready");
            return;
        }

        await window.AZIEL_PAYMENT.start(orderData);
    }

    async function payWithWalletDirect(orderData, flow) {
        try {
            const res = await fetch("/api/wallet/pay", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getAuthHeader()
                },
                body: JSON.stringify(orderData)
            });

            const data = await res.json();

            if (!data.success) {
                const message = data.message || "Wallet payment failed";
                setText(flow.config.noteSelector, message);
                window.PaymentUtils?.showToast?.(message);
                return;
            }

            window.PaymentUtils?.showToast?.("Paid with wallet");
            window.location.href = `tracking.html?orderId=${orderData.orderId}`;
        } catch (error) {
            console.log("Wallet payment error:", error);
            setText(flow.config.noteSelector, "Server error");
            window.PaymentUtils?.showToast?.("Server error");
        }
    }

    function storePendingBuy(flow) {
        const pkg = getSelectedPackage();
        const payment = getSelectedPayment();

        localStorage.setItem(
            "pendingBuy",
            JSON.stringify({
                game: flow.config.game,
                gameKey: flow.config.gameKey,
                packageCode: pkg?.code || "",
                selectedPackage: pkg,
                userId: getFieldValue(flow.config.userIdSelector),
                zoneId: getFieldValue(flow.config.zoneIdSelector),
                paymentMethod: payment?.key || "",
                returnUrl: flow.config.pendingReturnUrl || window.location.pathname
            })
        );

        localStorage.setItem(
            "redirectAfterLogin",
            flow.config.pendingReturnUrl || window.location.pathname
        );
    }

    function restorePendingBuy(flow) {
        const pending = readPendingBuy();
        if (!pending) return;

        if (
            pending.gameKey &&
            flow.config.gameKey &&
            pending.gameKey !== flow.config.gameKey
        ) {
            return;
        }

        const userInput = getEl(flow.config.userIdSelector);
        const zoneInput = getEl(flow.config.zoneIdSelector);

        if (userInput && pending.userId) userInput.value = pending.userId;
        if (zoneInput && pending.zoneId) zoneInput.value = pending.zoneId;

        const selectPendingPackage = () => {
            const code =
                pending.packageCode ||
                pending.selectedPackage?.code ||
                "";

            if (!code) return;

            const pack = document.querySelector(
                `.pack[data-code="${cssEscape(code)}"]`
            );

            if (pack) window.selectPackage?.(pack);
            updateSummary(flow);
        };

        document.addEventListener("pricesRendered", selectPendingPackage, {
            once: true
        });

        selectPendingPackage();
        localStorage.removeItem("pendingBuy");
    }

    function initMobilePackagePanel(flow) {
        const openBtn =
            document.getElementById("selectedPackagePreview") ||
            document.getElementById("openPackagePanel");
        const closeBtn = document.getElementById("closePackagePanel");
        const confirmBtn = document.getElementById("confirmPackagePanel");
        const panel = document.getElementById("mobilePackagePanel");
        const list = document.getElementById("mobilePackageList");

        if (!openBtn || !closeBtn || !confirmBtn || !panel || !list) return;

        let selectedPackEl = null;

        function openPanel() {
            list.innerHTML = "";
            selectedPackEl = document.querySelector("#packages .pack.active");

            document.querySelectorAll("#packages .pack")
                .forEach(pack => {
                    const row = pack.cloneNode(true);
                    row.classList.add("mobile-pack-row");

                    if (pack === selectedPackEl) row.classList.add("active");

                    row.addEventListener("click", () => {
                        list.querySelectorAll(".mobile-pack-row")
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
        panel.addEventListener("click", e => {
            if (e.target === panel) closePanel();
        });

        confirmBtn.addEventListener("click", () => {
            if (selectedPackEl) {
                window.selectPackage?.(selectedPackEl);
                updateSummary(flow);
            }

            closePanel();
        });
    }

    function scrollToBuyOnce(flow) {
        if (flow.hasAutoScrolledToBuy) return;

        const buyBtn = getEl(flow.config.buyButtonSelector);
        if (!buyBtn) return;

        flow.hasAutoScrolledToBuy = true;

        setTimeout(() => {
            buyBtn.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }, 250);
    }

    function hasToken() {
        return Boolean(
            window.AZIEL?.getToken?.() ||
            localStorage.getItem("token") ||
            sessionStorage.getItem("token")
        );
    }

    function getAuthHeader() {
        const token =
            window.AZIEL?.getToken?.() ||
            localStorage.getItem("token") ||
            sessionStorage.getItem("token") ||
            "";

        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    function readStoredUser() {
        try {
            return JSON.parse(
                localStorage.getItem("azielUser") ||
                localStorage.getItem("user") ||
                "null"
            );
        } catch {
            return null;
        }
    }

    function readPendingBuy() {
        try {
            return JSON.parse(localStorage.getItem("pendingBuy") || "null");
        } catch {
            return null;
        }
    }

    function getEl(selector) {
        if (!selector) return null;
        return document.querySelector(selector);
    }

    function claimSummaryElements(flow) {
        [
            flow.config.packageSummarySelector,
            flow.config.amountSummarySelector,
            flow.config.paymentSummarySelector,
            flow.config.noteSelector
        ].forEach(selector => {
            const el = getEl(selector);
            if (!el) return;

            el.removeAttribute("data-i18n");
            el.removeAttribute("data-i18n-placeholder");
            el.removeAttribute("data-i18n-title");
            el.setAttribute("data-i18n-skip", "true");
            el.dataset.summaryOwner = "game-flow";
        });
    }

    function packageFromElement(packEl) {
        return {
            name: packEl.dataset.name || "",
            price: Number(packEl.dataset.price || 0),
            amount: Number(packEl.dataset.price || 0),
            code: packEl.dataset.code || "",
            icon: packEl.dataset.icon || "",
            formattedPrice: packEl.querySelector(".pack-price")?.textContent?.trim() || ""
        };
    }

    function setText(selector, text) {
        const el = getEl(selector);
        if (!el) return;

        el.textContent = text;
        el.dataset.summaryOwner = "game-flow";
    }

    function cssEscape(value = "") {
        if (window.CSS?.escape) return CSS.escape(String(value));

        return String(value)
            .replaceAll("\\", "\\\\")
            .replaceAll('"', '\\"');
    }

    window.AZIEL_GAME_FLOW = {
        init,
        buildOrderData,
        getSelectedPackage,
        getSelectedPayment,
        updateSummary
    };
})();
