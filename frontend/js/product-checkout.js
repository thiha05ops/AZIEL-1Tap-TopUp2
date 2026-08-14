(function () {
    const t = (key, fallback) => window.AZIEL_LOCALE?.t?.(key, fallback) || fallback;
    const STORAGE_KEY = "azielProductCheckoutDraft";
    let draft = null;
    let authoritativeReview = null;
    let reviewLoading = false;
    let paymentSubmitting = false;

    function symbol(currency) {
        return String(currency).toUpperCase() === "THB" ? "฿" : "Ks";
    }

    function feedback(message, error = false) {
        const node = document.getElementById("checkoutFeedback");
        if (!node) return;
        node.textContent = message;
        node.classList.toggle("is-error", error);
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
        return null;
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
        const ready = Boolean(authoritativeReview?.quoteId && !reviewLoading && !paymentSubmitting);
        if (button) button.disabled = !ready;
        if (reviewLoading) return;
        if (!authoritativeReview?.quoteId) return;
        feedback(t("checkout.totalReady", "Your authoritative total is ready."));
    }

    async function continuePayment() {
        if (paymentSubmitting || !draft?.order || !authoritativeReview?.quoteId) return;
        const button = document.getElementById("checkoutPayButton");
        paymentSubmitting = true;
        button.disabled = true;
        try {
            validateReviewForHandoff(authoritativeReview);
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, review: authoritativeReview }));
            window.location.href = "payment-method.html";
        } catch (error) {
            feedback(error?.message || t("checkout.couldNotContinue", "Checkout could not continue."), true);
        } finally {
            paymentSubmitting = false;
            updatePaymentReady();
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
        updatePaymentReady();
        loadAuthoritativeReview();
    });

    window.AZIEL_PRODUCT_CHECKOUT = {
        validateReviewForHandoff
    };
})();
