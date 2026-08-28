(function () {
    const t = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback.replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? `{${name}}`);
    const STORAGE_KEY = "azielProductCheckoutDraft";
    let draft = null;
    let authoritativeReview = null;
    let reviewLoading = false;
    let paymentSubmitting = false;
    let paymentCommitted = false;
    let reconciliationMessage = "";

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
        document.getElementById("checkoutChangePackage").href = draft.returnUrl || "home.html";
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
        const canonicalPackage = review?.package || {};
        const canonicalProductName = canonicalPackage.gameName || draft.order.game;
        const canonicalPackageName = canonicalPackage.packageName || draft.order.packageName;
        document.getElementById("checkoutProduct").textContent = canonicalProductName;
        document.getElementById("checkoutPackage").textContent = canonicalPackageName;
        document.getElementById("checkoutSummaryProduct").textContent = canonicalProductName;
        document.getElementById("checkoutSummaryPackage").textContent = canonicalPackageName;
        setReviewValue("checkoutBasePrice", formatMoney(pricing.originalPrice, pricing.currency));
        setReviewValue("checkoutDiscount", pricing.discountAmount > 0
            ? `−${formatMoney(pricing.discountAmount, pricing.currency)}`
            : formatMoney(0, pricing.currency));
        setReviewValue("checkoutPromo", review?.promotion?.code || t("checkout.promoNotApplied", "Not applied"));
        setReviewValue("checkoutTotal", formatMoney(pricing.quotedTotalAmount, pricing.currency));
        setReviewValue("checkoutSummaryTotal", formatMoney(pricing.quotedTotalAmount, pricing.currency));
    }

    function setReviewSkeletons() {
        for (const id of ["checkoutBasePrice", "checkoutDiscount", "checkoutPromo", "checkoutTotal", "checkoutSummaryTotal"]) {
            setReviewValue(id, "", true);
        }
    }

    function showRecoveryActions(show) {
        const actions = document.getElementById("checkoutRecoveryActions");
        if (actions) actions.hidden = !show;
    }

    function reconcileDraft(review) {
        const pricing = review?.pricing || {};
        const canonicalPackage = review?.package || {};
        const localAmount = Number(draft.order.amount || 0);
        const canonicalBase = Number(pricing.originalPrice || 0);
        const localPromo = String(draft.order.promoCode || "").trim().toUpperCase();
        const canonicalPromo = String(review?.promotion?.code || "").trim().toUpperCase();
        const changes = [];

        if (localAmount > 0 && canonicalBase > 0 && Math.abs(localAmount - canonicalBase) > 0.000001) {
            changes.push(t("checkout.priceUpdated", "The price changed. The authoritative total is shown below."));
        }
        if (localPromo !== canonicalPromo) {
            changes.push(canonicalPromo
                ? t("checkout.promotionUpdated", "The promotion was updated during review.")
                : t("checkout.promotionRemoved", "The previous promotion is no longer valid."));
        }
        if (canonicalPackage.packageCode && canonicalPackage.packageCode !== draft.order.packageCode) {
            changes.push(t("checkout.packageUpdated", "The package details were updated during review."));
        }

        reconciliationMessage = changes.join(" ") || t("checkout.reviewVerified", "Package and total verified.");
        draft = {
            ...draft,
            authoritativeStatus: "verified",
            reconciledAt: new Date().toISOString(),
            reconciliation: {
                packageCode: canonicalPackage.packageCode || draft.order.packageCode,
                priceChanged: localAmount > 0 && canonicalBase > 0 && Math.abs(localAmount - canonicalBase) > 0.000001,
                promotionChanged: localPromo !== canonicalPromo
            }
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    }

    async function loadAuthoritativeReview() {
        if (!draft?.order || reviewLoading) return;
        reviewLoading = true;
        authoritativeReview = null;
        reconciliationMessage = "";
        setReviewSkeletons();
        showRecoveryActions(false);
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
                const error = new Error(data.message || t("checkout.reviewFailed", "Checkout review could not be verified."));
                error.code = data.code || `HTTP_${res.status}`;
                throw error;
            }
            authoritativeReview = data.review;
            renderAuthoritativeReview(authoritativeReview);
            reconcileDraft(authoritativeReview);
            showRecoveryActions(false);
        } catch (error) {
            draft = { ...draft, authoritativeStatus: "failed", reviewErrorCode: error?.code || "REVIEW_FAILED" };
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
            feedback(`${error?.message || t("checkout.reviewFailed", "Checkout review could not be verified.")} ${t("checkout.chooseRecovery", "Retry, or return to change the package.")}`, true);
            showRecoveryActions(true);
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
        const actionMessage = payment?.key
            ? t("payment.continueWith", "Continue with {method}.", { method: payment.method || payment.key })
            : t("payment.selectMethod", "Select a payment method.");
        feedback(reconciliationMessage ? `${reconciliationMessage} ${actionMessage}` : actionMessage);
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
            if (/expired/i.test(String(error?.message || ""))) {
                authoritativeReview = null;
                reconciliationMessage = "";
                showRecoveryActions(true);
            }
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
        document.getElementById("checkoutRetryReview")?.addEventListener("click", loadAuthoritativeReview);
        document.getElementById("checkoutPriceToggle")?.addEventListener("click", togglePriceDetails);
        document.addEventListener("paymentChanged", updatePaymentReady);
        updatePaymentReady();
        loadAuthoritativeReview();
    });

    window.AZIEL_PRODUCT_CHECKOUT = {
        validateReviewForHandoff
    };
})();
