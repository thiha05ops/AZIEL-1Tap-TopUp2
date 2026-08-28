(function () {
    const t = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback.replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? `{${name}}`);
    const STORAGE_KEY = "azielProductCheckoutDraft";
    let draft = null;
    let authoritativeReview = null;
    let reviewLoading = false;
    let paymentSubmitting = false;
    let paymentCommitted = false;

    function symbol(currency) {
        return String(currency).toUpperCase() === "THB" ? "฿" : "Ks";
    }

    function feedback(message, error = false) {
        const node = document.getElementById("checkoutFeedback");
        if (!node) return;
        node.textContent = message;
        node.classList.toggle("is-error", error);
        node.classList.remove("is-redundant-action");
    }

    function isMobileCheckout() {
        return window.matchMedia?.("(max-width: 600px)")?.matches === true;
    }

    function mobileActionLabel(label) {
        return isMobileCheckout() ? String(label || "").replace(/\.\s*$/, "") : label;
    }

    function formatMoney(amount, currency) {
        return `${Number(amount || 0).toLocaleString()} ${symbol(currency)}`;
    }

    function readDraft() {
        try {
            const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
            if (!parsed?.order?.productCode || !parsed?.order?.packageCode) return null;
            const age = Date.now() - new Date(parsed.createdAt || 0).getTime();
            return age >= 0 && age <= 30 * 60 * 1000 ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function selectedPayment() {
        return window.selectedPaymentData || null;
    }

    function validateReviewForHandoff(review) {
        const expiresAt = new Date(review?.expiresAt || 0);
        if (!review?.quoteId || String(review.status || "").toUpperCase() !== "ISSUED") {
            throw new Error(t("checkout.reviewFailed", "Checkout review could not be verified."));
        }
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
            throw new Error(t("checkout.reviewExpired", "This checkout review has expired. Refresh the page to get a new total."));
        }
        return review;
    }

    function render(order) {
        document.getElementById("checkoutProduct").textContent = order.game;
        document.getElementById("checkoutPackage").textContent = order.packageName;
        document.getElementById("checkoutAccount").textContent = [order.userId, order.zoneId !== "-" ? order.zoneId : ""].filter(Boolean).join(" / ");
        document.getElementById("checkoutRegion").textContent = order.region;
        document.getElementById("checkoutSummaryProduct").textContent = order.game;
        document.getElementById("checkoutSummaryPackage").textContent = order.packageName;
        setReviewValue("checkoutTotal", "", true);
        document.getElementById("checkoutBackLink").href = draft.returnUrl || "home.html";
    }

    function setReviewValue(id, value, loading = false) {
        const node = document.getElementById(id);
        if (!node) return;
        node.textContent = loading ? "\u00a0" : value;
        node.classList.toggle("az-storefront-skeleton", loading);
        node.classList.toggle("checkout-value-skeleton", loading);
        node.toggleAttribute("aria-busy", loading);
    }

    function renderAuthoritativeReview(review) {
        const pricing = review?.pricing || {};
        setReviewValue("checkoutBasePrice", formatMoney(pricing.originalPrice, pricing.currency));
        setReviewValue("checkoutDiscount", pricing.discountAmount > 0
            ? `−${formatMoney(pricing.discountAmount, pricing.currency)}`
            : formatMoney(0, pricing.currency));
        setReviewValue("checkoutPromo", review?.promotion?.code || t("checkout.promoNotApplied", "Not applied"));
        setReviewValue("checkoutTotal", formatMoney(pricing.quotedTotalAmount, pricing.currency));
        setReviewValue("checkoutSummaryTotal", formatMoney(pricing.quotedTotalAmount, pricing.currency));
    }

    async function loadAuthoritativeReview() {
        if (!draft?.order || reviewLoading) return;
        reviewLoading = true;
        authoritativeReview = null;
        updatePaymentReady();
        feedback(t("checkout.verifyingReview", "Verifying package, promotion, and total with AZIEL..."));
        try {
            const res = await fetch("/api/commerce/checkout/review", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(window.AZIEL?.authHeaders?.() || window.PaymentUtils?.authHeaders?.() || {})
                },
                body: JSON.stringify({
                    checkoutKey: draft.order.orderId,
                    orderId: draft.order.orderId,
                    productCode: draft.order.productCode,
                    gameKey: draft.order.gameKey,
                    game: draft.order.game,
                    packageCode: draft.order.packageCode,
                    region: draft.order.region,
                    currency: draft.order.currency,
                    promoCode: draft.order.promoCode || ""
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success || !data.review?.quoteId) {
                throw new Error(data.message || t("checkout.reviewFailed", "Checkout review could not be verified."));
            }
            authoritativeReview = data.review;
            renderAuthoritativeReview(authoritativeReview);
        } catch (error) {
            feedback(error?.message || t("checkout.reviewFailed", "Checkout review could not be verified."), true);
        } finally {
            reviewLoading = false;
            updatePaymentReady();
        }
    }

    function updatePaymentReady() {
        const button = document.getElementById("checkoutPayButton");
        const payment = selectedPayment();
        const ready = Boolean(authoritativeReview?.quoteId && payment?.key && !reviewLoading && !paymentSubmitting && !paymentCommitted);
        if (button) button.disabled = !ready;
        if (button) {
            const pricing = authoritativeReview?.pricing || {};
            const method = payment?.method || payment?.appDisplayName || payment?.key || "";
            const actionLabel = !payment?.key
                ? t("payment.selectMethod", "Select a payment method")
                : payment.paymentType === "wallet" || payment.key === "wallet"
                    ? `${t("payment.pay", "Pay")} ${formatMoney(pricing.quotedTotalAmount, pricing.currency)}`
                    : t("payment.continueWith", `Continue with ${method}`, { method });
            button.textContent = payment?.key ? mobileActionLabel(actionLabel) : actionLabel;
        }
        if (reviewLoading) return;
        if (!authoritativeReview?.quoteId) return;
        feedback(payment?.key ? t("payment.continueWith", "Continue with {method}.", { method: payment.method || payment.key }) : t("payment.selectMethod", "Select a payment method."));
        if (payment?.key) document.getElementById("checkoutFeedback")?.classList.add("is-redundant-action");
    }

    function togglePriceDetails() {
        const section = document.querySelector(".checkout-price-breakdown");
        const button = document.getElementById("checkoutPriceToggle");
        if (!section || !button) return;
        const expanded = section.dataset.mobileExpanded !== "true";
        section.dataset.mobileExpanded = String(expanded);
        button.setAttribute("aria-expanded", String(expanded));
    }

    async function continuePayment() {
        const payment = selectedPayment();
        if (paymentSubmitting || paymentCommitted || !draft?.order || !authoritativeReview?.quoteId || !payment?.key) return;
        const button = document.getElementById("checkoutPayButton");
        document.getElementById("checkoutFeedback")?.classList.remove("is-redundant-action");
        const lock = window.AZIEL_PURCHASE_TRANSITION?.acquire("PREPARING_PAYMENT", {
            controls: [button, document.getElementById("paymentGrid"), document.getElementById("checkoutBackLink")],
            statusNode: document.getElementById("checkoutFeedback"),
            message: t("payment.preparing", "Preparing payment...")
        });
        if (!lock) return;
        paymentSubmitting = true;
        button.disabled = true;
        try {
            validateReviewForHandoff(authoritativeReview);
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, review: authoritativeReview }));
            const pricing = authoritativeReview.pricing || {};
            const result = await window.AZIEL_PAYMENT.start({
                ...draft.order,
                checkoutKey: draft.order.orderId,
                amount: pricing.quotedTotalAmount,
                currency: pricing.currency,
                reviewQuoteId: authoritativeReview.quoteId,
                paymentMethod: payment.key,
                paymentType: payment.paymentType || "manual",
                provider: payment.provider || "manual",
                pagePresentation: true
            });
            paymentCommitted = result?.success === true && result?.navigating === true;
            if (!paymentCommitted) lock.release();
        } catch (error) {
            feedback(error?.message || t("checkout.couldNotContinue", "Checkout could not continue."), true);
            lock.release();
        } finally {
            if (!paymentCommitted) {
                paymentSubmitting = false;
                updatePaymentReady();
            }
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        draft = readDraft();
        if (!draft) {
            window.location.replace("home.html");
            return;
        }
        render(draft.order);
        document.getElementById("checkoutPayButton")?.addEventListener("click", continuePayment);
        document.getElementById("checkoutPriceToggle")?.addEventListener("click", togglePriceDetails);
        document.addEventListener("paymentChanged", updatePaymentReady);
        updatePaymentReady();
        loadAuthoritativeReview();
    });

    window.AZIEL_PRODUCT_CHECKOUT = {
        validateReviewForHandoff
    };
})();
