(function () {
    const ENDPOINT = "/api/coupons/available";

    function ready(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn);
        } else {
            fn();
        }
    }

    function apiUrl(path) {
        return window.AZIEL?.apiUrl ? window.AZIEL.apiUrl(path) : path;
    }

    function currentRegion() {
        return (
            window.AZIEL?.getShopRegion?.() ||
            window.AZIEL?.getRegion?.() ||
            localStorage.getItem("selectedRegion") ||
            localStorage.getItem("region") ||
            "MM"
        );
    }

    async function loadCoupons() {
        const section = document.getElementById("availableCoupons");
        const list = document.getElementById("availableCouponsList");
        if (!section || !list) return;

        section.hidden = true;
        list.innerHTML = "";

        try {
            const params = new URLSearchParams({
                region: currentRegion()
            });

            const response = await fetch(
                apiUrl(`${ENDPOINT}?${params.toString()}`),
                {
                    headers: {
                        Accept: "application/json",
                        ...(window.AZIEL?.authHeaders?.() || window.PaymentUtils?.authHeaders?.() || {})
                    },
                    cache: "no-store"
                }
            );

            const data = await response.json().catch(() => ({}));

            if (!response.ok || data?.success !== true) {
                throw new Error(data?.message || "Could not load coupons");
            }

            const coupons = Array.isArray(data?.coupons)
                ? data.coupons
                : [];

            if (!coupons.length) return;

            list.innerHTML = coupons.map(renderCoupon).join("");

            list.querySelectorAll("[data-claim-coupon]").forEach(button => {
                button.addEventListener("click", () => {
                    claimCoupon(button.dataset.claimCoupon || "", button);
                });
            });

            section.dataset.couponAuthority = "claim-based-coupons";
            section.hidden = false;

            window.AZIEL_MOTION?.enter?.(list, "fast");
        } catch (error) {
            console.log("Home coupons unavailable:", error);
            section.hidden = true;
            list.innerHTML = "";
        }
    }

    async function claimCoupon(campaignId, button) {
        if (!campaignId) return;
        button.disabled = true;
        try {
            const response = await fetch(apiUrl(`/api/coupons/${encodeURIComponent(campaignId)}/claim`), {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    ...(window.AZIEL?.authHeaders?.() || window.PaymentUtils?.authHeaders?.() || {})
                },
                body: JSON.stringify({ region: currentRegion() })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data?.success !== true) throw new Error(data?.message || "Claim failed");
            button.textContent = "CLAIMED";
            button.dataset.claimed = "true";
            window.AZIEL_UI?.toast?.success?.("Coupon claimed.");
            window.dispatchEvent(new CustomEvent("aziel:couponClaimed", { detail: data }));
        } catch (error) {
            console.log("Coupon claim failed:", error);
            button.disabled = false;
            window.AZIEL_UI?.toast?.warning?.("Please sign in to claim this coupon.");
        }
    }

    function renderCoupon(coupon = {}) {
        const campaignId = escapeHtml(coupon.campaignId || "");
        const name = escapeHtml(coupon.name || "AZIEL Promotion");
        const discount = escapeHtml(coupon.benefitLabel || "Coupon");
        const claimed = String(coupon.claimState || "").toUpperCase() === "CLAIMED";

        return `
            <article class="home-coupon-card" data-coupon-campaign="${campaignId}">
                <div class="home-coupon-card-top">
                    <div class="home-coupon-discount">
                        <strong>${discount}</strong>
                    </div>

                    <button
                        class="home-coupon-claim"
                        type="button"
                        data-claim-coupon="${campaignId}"
                        ${claimed ? "disabled data-claimed=\"true\"" : ""}
                        aria-label="Claim ${name}"
                    >
                        ${claimed ? "CLAIMED" : "CLAIM"}
                    </button>
                </div>

                <p class="home-coupon-name" title="${name}">
                    ${name}
                </p>
            </article>
        `;
    }

    function escapeHtml(value = "") {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    ready(() => {
        loadCoupons();
        window.addEventListener("aziel:shopRegionChanged", loadCoupons);
    });
})();
