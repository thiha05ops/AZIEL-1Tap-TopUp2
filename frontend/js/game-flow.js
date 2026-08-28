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
        paymentSelectionStage: "checkout",
        checkoutUrl: "checkout.html",
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
        initPromoControls(flow);
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
        getAccountFieldDefinitions(flow).forEach(field => {
            const input = getEl(field.selector);
            if (!input) return;
            if (field.required) input.setAttribute("aria-required", "true");
            ["input", "change"].forEach(eventName => input.addEventListener(eventName, () => {
                renderAccountFieldError(field, input);
                updateSummary(flow);
            }));
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
            document.addEventListener(eventName, () => {
                if (eventName !== "paymentChanged") invalidatePromoIfSelectionChanged(flow);
                updateSummary(flow);
            });
        });

        window.addEventListener("aziel:shopRegionChanged", () => {
            clearPromoQuote(flow, false);
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
            productCode: selected.productCode || "",
            packageCode: selected.packageCode || selected.code || "",
            currency: selected.currency || "",
            region: selected.region || "",
            name: selected.name || selected.packageName || "",
            price: Number(selected.price || selected.amount || 0),
            amount: Number(selected.amount || selected.price || 0),
            code: selected.code || selected.packageCode || "",
            icon: selected.icon || "",
            referencePrice: Number(selected.referencePrice || 0),
            saveAmount: Number(selected.saveAmount || 0),
            discountPercent: Number(selected.discountPercent || 0),
            showDiscount: selected.showDiscount === true,
            showOriginalPrice: selected.showOriginalPrice === true,
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

    function t(key, fallback) {
        return window.AZIEL_I18N?.t?.(key) || window.i18n?.t?.(key) || fallback;
    }

    function getFieldValue(selector) {
        const el = getEl(selector);
        return String(el?.value || "").trim();
    }

    function getAccountFieldDefinitions(flow) {
        if (Array.isArray(flow.config.accountFields) && flow.config.accountFields.length) {
            return flow.config.accountFields;
        }

        return [
            {
                key: "userId",
                selector: flow.config.userIdSelector,
                required: true,
                requiredMessage: flow.config.userIdRequiredMessage || "Please enter your account information."
            },
            {
                key: "zoneId",
                selector: flow.config.zoneIdSelector,
                required: flow.config.zoneRequired === true,
                requiredMessage: flow.config.zoneRequiredMessage || "Please enter server information."
            }
        ].filter(field => field.selector);
    }

    function validateAccountField(field) {
        const input = getEl(field.selector);
        const value = String(input?.value || "").trim();

        if (field.required && !value) {
            return { valid: false, reason: field.requiredMessage || `Please enter ${field.label || "this field"}.` };
        }

        if (value && input && typeof input.checkValidity === "function" && !input.checkValidity()) {
            return { valid: false, reason: field.invalidMessage || input.validationMessage || `Please enter a valid ${field.label || "value"}.` };
        }

        if (value && typeof field.validate === "function" && !field.validate(value, input)) {
            return { valid: false, reason: field.invalidMessage || `Please enter a valid ${field.label || "value"}.` };
        }

        return { valid: true, reason: "" };
    }

    function renderAccountFieldError(field, input) {
        const result = validateAccountField(field);
        const errorId = `${input.id || field.key || "accountField"}Error`;
        let error = document.getElementById(errorId);

        if (!result.valid && String(input.value || "").trim()) {
            if (!error) {
                error = document.createElement("small");
                error.id = errorId;
                error.className = "account-field-error";
                error.setAttribute("role", "alert");
                input.insertAdjacentElement("afterend", error);
            }
            error.textContent = result.reason;
            input.setAttribute("aria-invalid", "true");
            input.setAttribute("aria-describedby", errorId);
            return;
        }

        error?.remove();
        input.removeAttribute("aria-invalid");
        if (input.getAttribute("aria-describedby") === errorId) input.removeAttribute("aria-describedby");
    }

    function getReadiness(flow) {
        const pkg = getSelectedPackage();
        const payment = getSelectedPayment();
        const amount = Number(pkg?.price || 0);
        const promo = getActivePromoQuote(flow, pkg);
        const payableAmount = promo?.finalAmount ?? amount;

        if (!pkg) {
            return {
                ready: false,
                reason: t("product.selectPackagePrompt", "Please select a package.")
            };
        }

        if (!amount || amount <= 0) {
            return {
                ready: false,
                reason: t("product.packageUnavailable", "This package is not available yet.")
            };
        }

        for (const field of getAccountFieldDefinitions(flow)) {
            const validation = validateAccountField(field);
            if (!validation.valid) return { ready: false, reason: validation.reason };
        }

        if (flow.config.paymentSelectionStage !== "checkout" && !payment?.key) {
            return {
                ready: false,
                reason: t("product.selectPaymentPrompt", "Please select a payment method.")
            };
        }

        if (flow.isSubmitting) {
            return { ready: false, reason: t("product.continuingCheckout", "Continuing to checkout…") };
        }

        return {
            ready: true,
            reason: flow.config.paymentSelectionStage === "checkout"
                ? (payableAmount < amount
                    ? t("product.readyCheckoutPromo", "Promo applied. Ready to continue to checkout.")
                    : t("product.readyCheckout", "Ready to continue to checkout."))
                : (payableAmount < amount
                    ? t("product.readyPaymentPromo", "Promo applied. Ready to continue payment.")
                    : t("product.readyPayment", "Ready to continue payment."))
        };
    }

    function updateSummary(flow) {
        const pkg = getSelectedPackage();
        const payment = getSelectedPayment();
        const readiness = getReadiness(flow);
        const symbol = getSymbol();
        const promo = getActivePromoQuote(flow, pkg);
        const displayAmount = promo?.finalAmount ?? Number(pkg?.price || 0);
        const wasReady = Boolean(flow.lastReadinessReady);

        setMotionText(
            flow.config.packageSummarySelector,
            pkg?.name || t("product.notSelected", "Not selected")
        );

        setMotionText(
            flow.config.amountSummarySelector,
            pkg
                ? `${Number(displayAmount || 0).toLocaleString()} ${symbol}`
                : `0 ${symbol}`
        );

        const subtotal = document.getElementById("summaryPrice");
        const promoRow = document.getElementById("summaryDiscountRow");
        const promoLabel = document.getElementById("summaryPromoLabel");
        const promoDiscount = document.getElementById("summaryDiscount");
        const promoSaved = document.getElementById("summaryPromoSaved");
        const baseAmount = Number(pkg?.price || 0);
        const discountAmount = Number(promo?.discountAmount || 0);
        if (subtotal) subtotal.textContent = pkg ? `${baseAmount.toLocaleString()} ${symbol}` : `0 ${symbol}`;
        if (promoRow) promoRow.hidden = !promo;
        if (promoLabel) promoLabel.textContent = promo
            ? `${t("product.promoDiscount", "Promo")} ${promo.promoCode || ""}`.trim()
            : t("product.promoDiscount", "Promo discount");
        if (promoDiscount) promoDiscount.textContent = promo ? `−${discountAmount.toLocaleString()} ${symbol}` : `0 ${symbol}`;
        if (promoSaved) {
            promoSaved.hidden = !promo;
            promoSaved.textContent = promo
                ? t("product.youSaved", "You saved {amount}").replace("{amount}", `${discountAmount.toLocaleString()} ${symbol}`)
                : "";
        }

        renderPromoState(flow, promo);

        setMotionText(
            flow.config.paymentSummarySelector,
            payment?.method || t("product.notSelected", "Not selected")
        );

        setMotionText(flow.config.noteSelector, readiness.reason);

        const buyBtn = getEl(flow.config.buyButtonSelector);
        if (buyBtn) {
            buyBtn.disabled = !readiness.ready;
            if (readiness.ready && !wasReady) {
                window.AZIEL_MOTION?.emphasize(buyBtn, "ready");
            }
        }

        flow.lastReadinessReady = readiness.ready;

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

        const accountFields = getAccountFieldDefinitions(flow).map(field => ({
            key: String(field.key || "").trim(),
            label: String(field.label || field.key || "Account field").trim(),
            value: getFieldValue(field.selector)
        })).filter(field => field.key && field.value);

        return {
            orderId: "AZL-" + Date.now(),
            game: flow.config.game,
            gameKey: flow.config.gameKey,
            productCode: flow.config.productCode || flow.config.gameKey,
            packageName: pkg.name,
            packageCode: pkg.packageCode || pkg.code || "",
            amount: Number(pkg.price || 0),
            currency: pkg.currency || currency,
            region: pkg.region || region,
            promoCode: getActivePromoQuote(flow, pkg)?.promoCode || "",
            paymentMethod: payment?.key || "",
            username,
            userId: getFieldValue(flow.config.userIdSelector),
            zoneId: getFieldValue(flow.config.zoneIdSelector) || "-",
            accountFields,
            status: flow.config.status || "pending_payment",
            paymentType: payment?.paymentType || "",
            provider: payment?.provider || ""
        };
    }

    function validateCheckoutDraftIdentity(orderData) {
        if (!String(orderData?.productCode || orderData?.gameKey || "").trim()) {
            return t("checkout.productUnavailable", "This product is not available yet.");
        }
        if (!String(orderData?.packageCode || "").trim()) {
            return t("checkout.packageUnavailable", "Please select an available package.");
        }
        if (!String(orderData?.region || "").trim()) {
            return t("checkout.regionRequired", "Please select a region.");
        }
        return "";
    }

    async function submitOrder(flow) {
        if (flow.isSubmitting) return;

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

        let orderData = buildOrderData(flow);
        const checkoutIdentityError = validateCheckoutDraftIdentity(orderData);
        if (checkoutIdentityError) {
            setText(flow.config.noteSelector, checkoutIdentityError);
            return;
        }
        const buyBtn = getEl(flow.config.buyButtonSelector);
        const transition = window.AZIEL_PURCHASE_TRANSITION?.acquire("PREPARING_CHECKOUT", {
            controls: [
                buyBtn,
                document.querySelector(".order-left"),
                document.getElementById("packages"),
                document.getElementById("azielPromoBox")
            ],
            statusNode: getEl(flow.config.noteSelector),
            message: t("checkout.preparing", "Preparing checkout...")
        });
        if (!transition) return;

        flow.isSubmitting = true;
        flow.purchaseNavigationCommitted = false;
        if (buyBtn) buyBtn.disabled = true;

        try {
            // Checkout-stage products hand off their safe local snapshot immediately.
            // Canonical catalog, region, promotion, quote, and total validation belongs
            // to the destination review and never trusts this draft's amount.
            if (flow.config.paymentSelectionStage === "checkout") {
                stageCheckoutHandoff(orderData, flow);
                return;
            }

            if (window.AZIEL_CATALOG) {
                try {
                    const refreshed = await refreshPackageForCheckout(flow, orderData);
                    if (refreshed.unavailable) {
                        window.clearSelectedPackage?.("package_unavailable");
                        const message = refreshed.message || t("catalogPackageUnavailable", "This package is no longer available. Please select another package.");
                        setText(flow.config.noteSelector, message);
                        window.PaymentUtils?.showToast?.(message);
                        return;
                    }
                    if (!refreshed.ready) {
                        const message = t("catalogPricesUnavailable", "Prices are temporarily unavailable. Please try again shortly.");
                        setText(flow.config.noteSelector, message);
                        window.PaymentUtils?.showToast?.(message);
                        return;
                    }
                    orderData = buildOrderData(flow);

                    if (refreshed.priceChanged) {
                        const message = t("catalogPriceUpdated", "Price updated to the latest catalog price. Please review the new total.");
                        setText(flow.config.noteSelector, message);
                        window.PaymentUtils?.showToast?.(message);
                        return;
                    }
                } catch (error) {
                    const message = window.AZIEL_CATALOG?.availabilityMessage?.("CATALOG_UNAVAILABLE") || "Catalog is temporarily unavailable. Please try again shortly.";
                    setText(flow.config.noteSelector, message);
                    window.PaymentUtils?.showToast?.(message);
                    return;
                }
            }

            if (!orderData.amount || orderData.amount <= 0) {
                setText(flow.config.noteSelector, "This package is not available yet.");
                return;
            }

            if (orderData.promoCode) {
                const promoFresh = await refreshPromoBeforeSubmit(flow, orderData);
                if (!promoFresh) return;
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
        } finally {
            if (!flow.purchaseNavigationCommitted) {
                transition.release();
                flow.isSubmitting = false;
                updateSummary(flow);
            }
        }
    }

    async function refreshPackageForCheckout(flow, staleOrderData) {
        await window.AZIEL_CATALOG.ensureFreshForPurchase();
        const productCode = staleOrderData.productCode || flow.config.productCode || flow.config.gameKey || "";
        const packageCode = staleOrderData.packageCode || "";
        const refreshedCatalogPackage = window.AZIEL_CATALOG.getPackage(productCode, packageCode, staleOrderData.region);

        if (!refreshedCatalogPackage) {
            await window.renderGamePrices?.();
            const availability = window.AZIEL_CATALOG.getAvailability?.(productCode, staleOrderData.region) || {};
            const availabilityCode = availability.code === "AVAILABLE" ? "PACKAGE_UNAVAILABLE" : (availability.code || "PACKAGE_UNAVAILABLE");
            return {
                ready: false,
                unavailable: true,
                availabilityCode,
                message: availabilityCode === availability.code
                    ? availability.message
                    : window.AZIEL_CATALOG.availabilityMessage?.(availabilityCode),
                priceChanged: false,
                selectedPackage: null
            };
        }

        const refreshResult = await window.renderGamePrices?.({
            reselectCode: packageCode,
            reason: "purchase_review"
        });
        const refreshedSelection = refreshResult?.selectedPackage || getSelectedPackage();
        const sameIdentity = Boolean(
            refreshedSelection &&
            String(refreshedSelection.productCode || "").toLowerCase() === String(productCode).toLowerCase() &&
            String(refreshedSelection.packageCode || refreshedSelection.code || "").toUpperCase() === String(packageCode).toUpperCase()
        );

        if (!refreshResult?.ready || !sameIdentity) {
            return {
                ready: false,
                unavailable: refreshResult?.unavailable === true,
                priceChanged: false,
                selectedPackage: refreshedSelection || null
            };
        }

        const latestAmount = Number(refreshedSelection.amount || refreshedSelection.price || 0);
        return {
            ready: true,
            unavailable: false,
            priceChanged: Math.abs(latestAmount - Number(staleOrderData.amount)) > 0.000001,
            selectedPackage: refreshedSelection
        };
    }

    function stageCheckoutHandoff(orderData, flow) {
        const checkoutDraft = {
            version: 2,
            createdAt: new Date().toISOString(),
            returnUrl: flow.config.pendingReturnUrl || window.location.href,
            authoritativeStatus: "pending",
            order: {
                ...orderData,
                paymentMethod: "",
                paymentType: "",
                provider: ""
            }
        };

        sessionStorage.setItem("azielProductCheckoutDraft", JSON.stringify(checkoutDraft));
        flow.purchaseNavigationCommitted = true;
        window.location.href = flow.config.checkoutUrl || "checkout.html";
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
            window.location.href = `tracking.html?orderId=${data.order?.orderId || orderData.orderId}`;
        } catch (error) {
            console.log("Wallet payment error:", error);
            setText(flow.config.noteSelector, "Server error");
            window.PaymentUtils?.showToast?.("Server error");
        }
    }

    function initPromoControls(flow) {
        const summaryAmount = getEl(flow.config.amountSummarySelector);
        const summaryContainer =
            summaryAmount?.closest(".summary-row, .summary-item, li, p, div")?.parentElement ||
            summaryAmount?.parentElement;
        if (!summaryContainer || document.getElementById("azielPromoBox")) return;

        flow.promo = {
            code: "",
            quote: null,
            loading: false
        };

        const box = document.createElement("div");
        box.id = "azielPromoBox";
        box.className = "aziel-promo-box";
        box.innerHTML = `
            <label class="aziel-promo-label" for="promoCodeInput" data-i18n="product.promoCode">${t("product.promoCode", "Promo Code")}</label>
            <div class="aziel-promo-row">
                <input id="promoCodeInput" type="text" autocomplete="off" maxlength="32" placeholder="${t("product.enterPromo", "Enter promo code")}" data-i18n-placeholder="product.enterPromo">
                <button id="promoApplyBtn" type="button" data-i18n="product.applyPromo">${t("product.applyPromo", "Apply")}</button>
                <button id="promoRemoveBtn" type="button" data-i18n="product.removePromo" hidden>${t("product.removePromo", "Remove")}</button>
            </div>
            <p id="promoFeedback" class="aziel-promo-feedback" aria-live="polite"></p>
        `;

        summaryContainer.appendChild(box);
        document.dispatchEvent(new CustomEvent("aziel:promo-controls-ready", { detail: { box } }));

        box.querySelector("#promoApplyBtn")?.addEventListener("click", () => applyPromoCode(flow));
        box.querySelector("#promoRemoveBtn")?.addEventListener("click", () => {
            clearPromoQuote(flow, true);
            updateSummary(flow);
        });
        box.querySelector("#promoCodeInput")?.addEventListener("input", () => {
            if (flow.promo?.quote) clearPromoQuote(flow, false);
            updateSummary(flow);
        });
    }

    async function applyPromoCode(flow) {
        const input = document.getElementById("promoCodeInput");
        const code = String(input?.value || "").trim().toUpperCase();
        const pkg = getSelectedPackage();

        if (!pkg) {
            setPromoFeedback(t("product.promoSelectPackage", "Select a package before applying a promo code."), "error");
            return;
        }

        if (!code) {
            setPromoFeedback(t("product.promoEnterCode", "Enter a promo code."), "error");
            return;
        }

        flow.promo = {
            ...(flow.promo || {}),
            loading: true
        };
        renderPromoState(flow, null);

        try {
            const res = await fetch("/api/promos/quote", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getAuthHeader()
                },
                body: JSON.stringify({
                    promoCode: code,
                    productCode: flow.config.productCode || flow.config.gameKey || pkg.productCode,
                    gameKey: flow.config.gameKey,
                    game: flow.config.game,
                    packageCode: pkg.packageCode || pkg.code || "",
                    packageName: pkg.name,
                    region: pkg.region || getRegion()
                })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                clearPromoQuote(flow, false);
                const message = promoErrorMessage(data);
                setPromoFeedback(message, "error");
                window.AZIEL_UI?.toast?.error(message);
                return;
            }

            flow.promo = {
                code,
                loading: false,
                quote: {
                    ...data.quote,
                    productCode: data.quote.productCode || flow.config.productCode || flow.config.gameKey,
                    packageCode: data.quote.packageCode || pkg.packageCode || pkg.code || "",
                    region: data.quote.region || pkg.region || getRegion(),
                    promoCode: data.quote.promoCode || code
                }
            };
            setPromoFeedback(t("product.promoApplied", "Promo applied."), "success");
            window.AZIEL_UI?.toast?.success(t("product.promoApplied", "Promo applied."));
        } catch (error) {
            console.log("Promo quote error:", error);
            clearPromoQuote(flow, false);
            setPromoFeedback(t("product.promoUnavailable", "Promo service is unavailable. Please try again."), "error");
        } finally {
            if (flow.promo) flow.promo.loading = false;
            updateSummary(flow);
        }
    }

    async function refreshPromoBeforeSubmit(flow, orderData) {
        const previous = getActivePromoQuote(flow);
        if (!previous) return true;

        try {
            const res = await fetch("/api/promos/quote", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getAuthHeader()
                },
                body: JSON.stringify({
                    promoCode: orderData.promoCode,
                    productCode: orderData.productCode,
                    gameKey: orderData.gameKey,
                    game: orderData.game,
                    packageCode: orderData.packageCode,
                    packageName: orderData.packageName,
                    region: orderData.region
                })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                clearPromoQuote(flow, false);
                const message = data.message || "Promo code changed. Please review your total and continue again.";
                setText(flow.config.noteSelector, message);
                window.AZIEL_UI?.toast?.warning?.(message) || window.PaymentUtils?.showToast?.(message);
                updateSummary(flow);
                return false;
            }

            const quote = {
                ...data.quote,
                promoCode: data.quote.promoCode || orderData.promoCode
            };

            if (
                Number(quote.finalAmount) !== Number(previous.finalAmount) ||
                Number(quote.discountAmount) !== Number(previous.discountAmount)
            ) {
                flow.promo.quote = quote;
                const message = "Promo total updated. Please review the new total and continue again.";
                setText(flow.config.noteSelector, message);
                window.AZIEL_UI?.toast?.warning?.(message) || window.PaymentUtils?.showToast?.(message);
                updateSummary(flow);
                return false;
            }

            flow.promo.quote = quote;
            return true;
        } catch (error) {
            console.log("Promo refresh error:", error);
            setText(flow.config.noteSelector, "Promo service is temporarily unavailable. Please try again.");
            return false;
        }
    }

    function getActivePromoQuote(flow, pkg = getSelectedPackage()) {
        const quote = flow.promo?.quote;
        if (!quote || !pkg) return null;

        const packageCode = pkg.packageCode || pkg.code || "";
        const region = pkg.region || getRegion();
        if (quote.packageCode !== packageCode || quote.region !== region) return null;

        return quote;
    }

    function invalidatePromoIfSelectionChanged(flow) {
        if (!flow.promo?.quote) return;
        if (!getActivePromoQuote(flow)) clearPromoQuote(flow, false);
    }

    function clearPromoQuote(flow, clearInput) {
        if (!flow.promo) return;
        flow.promo.quote = null;
        flow.promo.code = "";
        flow.promo.loading = false;
        if (clearInput) {
            const input = document.getElementById("promoCodeInput");
            if (input) input.value = "";
            setPromoFeedback("", "");
        }
    }

    function renderPromoState(flow, promo) {
        const applyBtn = document.getElementById("promoApplyBtn");
        const removeBtn = document.getElementById("promoRemoveBtn");
        const input = document.getElementById("promoCodeInput");
        if (!applyBtn || !removeBtn || !input) return;

        const loading = Boolean(flow.promo?.loading);
        applyBtn.disabled = loading;
        applyBtn.textContent = loading ? t("product.applyingPromo", "Applying…") : t("product.applyPromo", "Apply");
        removeBtn.hidden = !promo;
        input.disabled = loading;

        if (promo) {
            const symbol = promo.currency === "THB" ? "฿" : "Ks";
            setPromoFeedback(
                `✓ ${promo.promoCode || ""} ${t("product.promoAppliedInline", "applied")} · ${t("product.youSaved", "You saved {amount}").replace("{amount}", `${Number(promo.discountAmount || 0).toLocaleString()} ${symbol}`)}`,
                "success"
            );
        }
    }

    function promoErrorMessage(data = {}) {
        const code = String(data.code || data.error || "").toUpperCase();
        if (code.includes("EXPIRED")) return t("product.promoExpired", "This promo code has expired.");
        if (code.includes("INELIGIBLE") || code.includes("MINIMUM") || code.includes("LIMIT")) {
            return t("product.promoNotEligible", "This promo code is not available for this purchase.");
        }
        if (code.includes("NOT_FOUND") || code.includes("INVALID")) {
            return t("product.promoInvalid", "This promo code is invalid or unavailable.");
        }
        return data.message || t("product.promoUnavailable", "Promo service is unavailable. Please try again.");
    }

    function setPromoFeedback(message, tone = "") {
        const feedback = document.getElementById("promoFeedback");
        if (!feedback) return;
        feedback.textContent = message || "";
        feedback.dataset.tone = tone || "";
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
                productCode: pkg?.productCode || flow.config.productCode || flow.config.gameKey,
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
                        window.AZIEL_MOTION?.emphasize(row, "selected");
                        selectedPackEl = pack;
                    });

                    list.appendChild(row);
                });

            panel.classList.add("show");
            panel.classList.add("az-motion-panel");
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
            if (window.AZIEL_MOTION?.scrollTo) {
                window.AZIEL_MOTION.scrollTo(buyBtn, { block: "center" });
            } else {
                buyBtn.scrollIntoView({
                    behavior: "smooth",
                    block: "center"
                });
            }
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
            productCode: packEl.dataset.productCode || "",
            packageCode: packEl.dataset.code || "",
            name: packEl.dataset.name || "",
            price: Number(packEl.dataset.price || 0),
            amount: Number(packEl.dataset.price || 0),
            currency: packEl.dataset.currency || "",
            region: packEl.dataset.region || "",
            code: packEl.dataset.code || "",
            icon: packEl.dataset.icon || "",
            referencePrice: Number(packEl.dataset.referencePrice || 0),
            saveAmount: Number(packEl.dataset.saveAmount || 0),
            discountPercent: Number(packEl.dataset.discountPercent || 0),
            showDiscount: packEl.dataset.showDiscount === "true",
            showOriginalPrice: packEl.dataset.showOriginalPrice === "true",
            formattedPrice: packEl.querySelector(".pack-price")?.textContent?.trim() || ""
        };
    }

    function setText(selector, text) {
        const el = getEl(selector);
        if (!el) return;

        el.textContent = text;
        el.dataset.summaryOwner = "game-flow";
    }

    function setMotionText(selector, text) {
        const el = getEl(selector);
        if (!el) return;

        el.dataset.summaryOwner = "game-flow";

        if (window.AZIEL_MOTION?.swapText) {
            window.AZIEL_MOTION.swapText(el, text);
            return;
        }

        el.textContent = text;
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
        refreshPackageForCheckout,
        updateSummary
    };
})();
