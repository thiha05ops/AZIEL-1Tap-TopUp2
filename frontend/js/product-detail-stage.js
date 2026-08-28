// Product Detail presentation staging. Payment choice belongs to Checkout.
(function () {
    const tr = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback;
    document.documentElement.classList.add("az-product-detail");
    document.body?.classList.add("az-purchase-surface");

    if (!document.querySelector('link[data-aziel-purchase-shell="true"]')) {
        const purchaseStyles = document.createElement("link");
        purchaseStyles.rel = "stylesheet";
        purchaseStyles.href = "/css/commerce/purchase-shell.css?v=20260808-unified";
        purchaseStyles.dataset.azielPurchaseShell = "true";
        document.head.appendChild(purchaseStyles);
    }

    const paymentCard = document.getElementById("paymentGrid")?.closest(".form-card");
    paymentCard?.remove();

    const paymentSummary = document.getElementById("summaryPayment")?.closest(".summary-line");
    paymentSummary?.remove();

    const buyButton = document.getElementById("buyBtn");
    if (buyButton) {
        buyButton.textContent = tr("checkout.buyNow", "Buy Now");
        buyButton.dataset.i18n = "checkout.buyNow";
    }

    const accountHeading = document.querySelector(".order-left > .form-card:first-child .card-title h2");
    if (accountHeading) {
        accountHeading.textContent = tr("product.accountInformation", "Account Information");
        accountHeading.dataset.i18n = "product.accountInformation";
    }

    const orderLeft = document.querySelector(".order-left");
    const accountCard = orderLeft?.querySelector(".form-card:first-child");
    const packageCard = document.getElementById("packages")?.closest(".form-card");
    accountCard?.classList.add("product-account-card");
    packageCard?.classList.add("product-package-card");
    const packageRoot = document.getElementById("packages");
    if (packageRoot && !packageRoot.children.length) {
        packageRoot.setAttribute("aria-busy", "true");
        packageRoot.innerHTML = Array.from({ length: 8 }, () => '<div class="pack pack-skeleton az-storefront-skeleton" aria-hidden="true"><span class="pack-skeleton-name"></span><span class="pack-skeleton-price"></span></div>').join("");
        const loadingStatus = document.createElement("span"); loadingStatus.className = "az-visually-hidden"; loadingStatus.setAttribute("role", "status"); loadingStatus.textContent = tr("product.loadingPackages", "Loading available packages"); packageRoot.appendChild(loadingStatus);
    }

    const hero = document.querySelector(".game-hero");
    const identity = hero?.querySelector(".game-banner");
    const info = hero?.querySelector(".game-info");
    const initialProductName = identity?.querySelector("h1")?.textContent?.trim() || document.title.split("|")[0].trim();
    const initialProductDescription = identity?.querySelector(".banner-overlay p")?.textContent?.trim() || "";
    if (orderLeft && identity && packageCard) {
        identity.classList.add("product-identity");
        orderLeft.insertBefore(identity, packageCard);
    }

    const orderLayout = document.querySelector(".order-layout");
    if (info && orderLayout) {
        info.classList.add("product-lower-info");
        const heading = info.querySelector("h2");
        if (heading) {
            heading.textContent = tr("product.howToTopUp", "How to Top Up");
            heading.dataset.i18n = "product.howToTopUp";
        }
        const trust = info.querySelector(".trust-box span");
        if (trust) trust.textContent = tr("product.trustLine", "Fast delivery • Secure checkout • Order tracking");
        orderLayout.insertAdjacentElement("afterend", info);
    }
    hero?.remove();

    const summary = document.querySelector(".order-summary");
    const summaryTotal = summary?.querySelector(".summary-total");
    if (summary && summaryTotal && !document.getElementById("summaryPrice")) {
        const priceLine = document.createElement("div");
        priceLine.className = "summary-line";
        const priceLabel = document.createElement("span"); priceLabel.textContent = tr("product.subtotal", "Subtotal"); priceLabel.dataset.i18n = "product.subtotal";
        const priceValue = document.createElement("b"); priceValue.id = "summaryPrice"; priceValue.textContent = "0";
        priceLine.append(priceLabel, priceValue);
        summary.insertBefore(priceLine, summaryTotal);

        const promoLine = document.createElement("div");
        promoLine.id = "summaryDiscountRow";
        promoLine.className = "summary-line summary-promo-line";
        promoLine.hidden = true;
        const promoLabel = document.createElement("span"); promoLabel.id = "summaryPromoLabel"; promoLabel.textContent = tr("product.promoDiscount", "Promo discount");
        const promoValue = document.createElement("b"); promoValue.id = "summaryDiscount"; promoValue.textContent = "0";
        promoLine.append(promoLabel, promoValue);
        summary.insertBefore(promoLine, summaryTotal);

        const saved = document.createElement("p");
        saved.id = "summaryPromoSaved";
        saved.className = "summary-promo-saved";
        saved.hidden = true;
        saved.setAttribute("aria-live", "polite");
        summaryTotal.insertAdjacentElement("afterend", saved);
    }
    const safeNote = summary?.querySelector(".safe-note");
    if (safeNote) {
        safeNote.dataset.i18n = "checkout.paymentProtected";
        safeNote.textContent = tr("checkout.paymentProtected", "Secure Checkout • Your payment is protected");
    }

    function movePromoCard(promo = document.getElementById("azielPromoBox")) {
        if (!promo || promo.closest(".product-promo-card") || !summary) return;
        const card = document.createElement("section");
        card.className = "product-promo-card";
        card.appendChild(promo);
        summary.insertAdjacentElement("afterend", card);
    }
    document.addEventListener("aziel:promo-controls-ready", event => movePromoCard(event.detail?.box), { once: true });
    movePromoCard();

    function createInfoSection(title) {
        const section = document.createElement("section");
        section.className = "product-information-section";
        const panelId = `productInfo-${Math.random().toString(36).slice(2, 9)}`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "product-information-toggle";
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", panelId);
        const label = document.createElement("span");
        label.textContent = title;
        const chevron = document.createElement("span");
        chevron.className = "product-information-chevron";
        chevron.setAttribute("aria-hidden", "true");
        chevron.textContent = "⌄";
        button.append(label, chevron);
        const panel = document.createElement("div");
        panel.id = panelId;
        panel.className = "product-information-panel";
        panel.hidden = true;
        button.addEventListener("click", () => {
            const expanded = button.getAttribute("aria-expanded") === "true";
            button.setAttribute("aria-expanded", expanded ? "false" : "true");
            panel.hidden = expanded;
        });
        section.append(button, panel);
        return { section, panel };
    }

    function renderProductIdentity(product) {
        if (!identity) return;
        const locale = window.AZIEL_LOCALE?.getLocale?.() || "en";
        const signature = `${product.productCode || ""}:${product.updatedAt || "fallback"}:${product.imageUrl || ""}:${locale}`;
        if (identity.dataset.identitySignature === signature) return;
        identity.dataset.identitySignature = signature;
        identity.removeAttribute("data-managed-content-state");
        identity.replaceChildren();

        const artworkUrl = String(product.imageUrl || product.artworkPath || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(product.productCode) || "").trim();
        if (artworkUrl) {
            const media = document.createElement("div");
            media.className = "product-identity-media";
            const image = document.createElement("img");
            image.src = artworkUrl;
            image.alt = product.imageAltText || product.name;
            image.width = 340;
            image.height = 340;
            image.decoding = "async";
            image.addEventListener("error", () => media.remove(), { once: true });
            media.appendChild(image);
            identity.appendChild(media);
        }

        const content = document.createElement("div");
        content.className = "product-identity-content";
        const eyebrow = document.createElement("p");
        eyebrow.className = "product-identity-eyebrow";
        const category = String(product.catalogCategory || "Product").replaceAll("_", " ");
        eyebrow.textContent = tr(`product.category.${category.toLowerCase().replace(/[^a-z0-9]+/g, "")}`, category);
        const title = document.createElement("h1");
        title.textContent = product.name;
        const badges = document.createElement("div");
        badges.className = "product-identity-badges";
        const market = String(product.displayMarketLabel || "").trim();
        const regions = Array.isArray(product.supportedRegions) ? product.supportedRegions.join(" · ") : "";
        if (market || regions) {
            const badge = document.createElement("span");
            const marketLabel = market || regions;
            badge.textContent = tr(`product.market.${marketLabel.toLowerCase().replace(/[^a-z0-9]+/g, "")}`, marketLabel);
            badges.appendChild(badge);
        }
        const description = document.createElement("p");
        description.className = "product-identity-description";
        description.textContent = resolveProductKnowledge(product.productKnowledge || {}).shortDescription || product.description || document.title.split("|")[0].trim();
        content.append(eyebrow, title, badges, description);

        const requiredLabels = Array.from(document.querySelectorAll(".product-account-card label")).map(label => label.textContent.trim()).filter(Boolean);
        if (requiredLabels.length) {
            const note = document.createElement("p");
            note.className = "product-identity-note";
            note.textContent = tr("product.checkAccountFields", "Check your {fields} carefully before checkout.", { fields: requiredLabels.join(tr("common.and", " and ")) });
            content.appendChild(note);
        }
        identity.appendChild(content);
    }

    function setMeta(selector, attribute, value) {
        let node = document.head.querySelector(selector);
        if (!node) {
            node = document.createElement(selector.startsWith("link") ? "link" : "meta");
            if (selector.includes("canonical")) node.rel = "canonical";
            else if (selector.includes("property=")) node.setAttribute("property", selector.match(/property=['\"]([^'\"]+)/)?.[1] || "");
            else node.name = selector.match(/name=['\"]([^'\"]+)/)?.[1] || "";
            document.head.appendChild(node);
        }
        node.setAttribute(attribute, value);
    }

    function applyProductSeo(product) {
        const title = String(product.seo?.title || `${product.name} | AZIEL`).trim();
        const description = String(product.seo?.description || product.productKnowledge?.shortDescription || product.description || "").trim();
        const route = String(product.publicReadiness?.route || product.productRoute || location.pathname + location.search).trim();
        const canonical = new URL(route, location.origin).href;
        document.title = title;
        setMeta('meta[name="description"]', "content", description);
        setMeta('meta[property="og:title"]', "content", title);
        setMeta('meta[property="og:description"]', "content", description);
        setMeta('link[rel="canonical"]', "href", canonical);
        if (product.imageUrl) setMeta('meta[property="og:image"]', "content", new URL(product.imageUrl, location.origin).href);
    }

    function renderUnavailableState(product, state) {
        orderLayout.hidden = true;
        document.getElementById("mobilePackagePanel")?.setAttribute("hidden", "");
        if (identity && identity.closest(".order-layout")) orderLayout.insertAdjacentElement("beforebegin", identity);
        let status = document.querySelector(".product-public-state");
        if (!status) {
            status = document.createElement("section");
            status.className = "product-public-state";
            identity?.insertAdjacentElement("afterend", status);
        }
        status.replaceChildren();
        const heading = document.createElement("h2");
        const availabilityCode = product.availabilityCode || state;
        const isComingSoon = availabilityCode === "COMING_SOON";
        heading.textContent = isComingSoon ? tr("readiness.comingSoon", "Coming Soon") : tr("readiness.unavailable", "Product unavailable");
        const copy = document.createElement("p");
        copy.textContent = product.availabilityReason || window.AZIEL_CATALOG?.availabilityMessage?.(availabilityCode) || (isComingSoon
            ? tr("readiness.comingSoonBody", "This product is listed in AZIEL but is not yet available for purchase in your selected region.")
            : tr("readiness.unavailableBody", "This product is currently unavailable."));
        const explore = document.createElement("a"); explore.href = "/mobile-games.html"; explore.textContent = tr("readiness.continueExploring", "Continue Exploring");
        status.append(heading, copy, explore);
        if (state === "HIDDEN") {
            identity?.replaceChildren();
            const hiddenTitle = document.createElement("h1"); hiddenTitle.textContent = tr("readiness.unavailable", "Product unavailable"); identity?.appendChild(hiddenTitle);
            document.title = "Product unavailable | AZIEL";
            setMeta('meta[name="robots"]', "content", "noindex, nofollow");
        }
    }

    function resolveAndRenderPublicState(product) {
        const region = window.AZIEL?.getShopRegion?.() || "MM";
        const configuredState = product.publicState || product.publicReadiness?.state || (product.purchasable ? "AVAILABLE" : "COMING_SOON");
        const regionalState = product.publicReadiness?.regions?.[region]?.state;
        const hasAccountConfig = document.querySelectorAll(".product-account-card input, .product-account-card select").length > 0;
        const regionalCode = product.publicReadiness?.regions?.[region]?.availabilityCode;
        if (configuredState === "AVAILABLE" && regionalState === "COMING_SOON") {
            product.availabilityCode = regionalCode || "REGION_UNAVAILABLE";
            product.availabilityReason = product.publicReadiness?.regions?.[region]?.availabilityReason || product.availabilityReason;
        }
        const state = configuredState === "AVAILABLE" && regionalState !== "COMING_SOON" && hasAccountConfig ? "AVAILABLE" : (product.availabilityCode === "COMING_SOON" ? "COMING_SOON" : "HIDDEN");
        document.documentElement.dataset.publicProductState = state;
        if (state !== "AVAILABLE") renderUnavailableState(product, state);
        else {
            orderLayout.hidden = false;
            document.querySelector(".product-public-state")?.remove();
        }
        return state;
    }

    function renderLowerProductContent() {
        const gameKey = document.getElementById("packages")?.dataset.game || "";
        const product = window.AZIEL_CATALOG?.getProduct?.(gameKey);
        if (!product) {
            if (window.AZIEL_CATALOG?.getStatus?.() === "ready") resolveDirectAvailability(gameKey);
            return;
        }
        renderProductIdentity(product);
        applyProductSeo(product);
        const publicState = resolveAndRenderPublicState(product);
        document.querySelector(".product-information-grid")?.remove();

        const knowledge = resolveProductKnowledge(product.productKnowledge || {});
        const accountLabels = Array.from(document.querySelectorAll(".product-account-card label"))
            .map(label => label.childNodes[0]?.textContent?.replace(/\s*\*\s*$/, "").trim() || label.textContent.trim())
            .filter(Boolean);
        const howTo = document.querySelector(".product-lower-info");
        if (howTo) howTo.hidden = publicState !== "AVAILABLE";
        const steps = [
                accountLabels.length ? tr("product.howTo.accountFields", "Enter your {fields}.", { fields: accountLabels.join(tr("common.and", " and ")) }) : tr("product.howTo.account", "Enter the account information requested above."),
                tr("product.howTo.package", "Select the package you want."),
                tr("product.howTo.checkout", "Continue to checkout and choose a payment method."),
                tr("product.howTo.complete", "Complete payment and track your order status.")
            ];
        const howToList = howTo?.querySelector("ol, ul");
        if (howToList) {
            howToList.replaceChildren(...steps.map(text => {
                const item = document.createElement("li");
                item.textContent = text;
                return item;
            }));
        } else {
            howTo?.querySelectorAll(".step-row p").forEach((node, index) => { if (steps[index]) node.textContent = steps[index]; });
        }

        const container = document.createElement("div");
        container.className = "product-information-grid";

        const aboutText = [knowledge.about?.summary, knowledge.about?.details].filter(Boolean);
        if (aboutText.length) {
            const about = createInfoSection(tr("product.about", "About This Product"));
            aboutText.forEach(text => { const p = document.createElement("p"); p.textContent = text; about.panel.appendChild(p); });
            container.appendChild(about.section);
        }

        const guide = knowledge.packageGuide || {};
        if (guide.intro || guide.groups?.length) {
            const section = createInfoSection(tr("product.packageGuide", "Package Guide"));
            if (guide.intro) { const p = document.createElement("p"); p.textContent = guide.intro; section.panel.appendChild(p); }
            (guide.groups || []).forEach(group => {
                const block = document.createElement("div");
                block.className = "product-knowledge-item";
                const title = document.createElement("h3"); title.textContent = group.title;
                const body = document.createElement("p"); body.textContent = group.description;
                if (group.title) block.appendChild(title);
                if (group.description) block.appendChild(body);
                section.panel.appendChild(block);
            });
            container.appendChild(section.section);
        }

        if (knowledge.purchaseNotes?.length) {
            const before = createInfoSection(tr("product.beforePurchase", "Before You Purchase"));
            knowledge.purchaseNotes.forEach(entry => {
                const block = document.createElement("div"); block.className = "product-knowledge-item";
                if (entry.title) { const h = document.createElement("h3"); h.textContent = entry.title; block.appendChild(h); }
                if (entry.body) { const p = document.createElement("p"); p.textContent = entry.body; block.appendChild(p); }
                before.panel.appendChild(block);
            });
            container.appendChild(before.section);
        }

        if (knowledge.faq?.length) {
            const faq = createInfoSection(tr("product.faq", "Frequently Asked Questions"));
            knowledge.faq.forEach(entry => {
                const row = document.createElement("details"); row.className = "product-faq-item";
                const question = document.createElement("summary"); question.textContent = entry.question;
                const answer = document.createElement("p"); answer.textContent = entry.answer;
                row.append(question, answer); faq.panel.appendChild(row);
            });
            container.appendChild(faq.section);
        }

        if (container.children.length) (document.querySelector(".product-lower-info") || orderLayout).insertAdjacentElement("afterend", container);
    }

    let directAvailabilityRequest = null;
    function resolveDirectAvailability(productCode) {
        if (!productCode || directAvailabilityRequest) return directAvailabilityRequest;
        directAvailabilityRequest = fetch(`/api/catalog/${encodeURIComponent(productCode)}`, {
            cache: "no-store",
            headers: { Accept: "application/json" }
        }).then(async response => {
            const data = await response.json().catch(() => ({}));
            if (response.ok && data.success && data.product) return data.product;
            return {
                availabilityCode: data.availabilityCode || "PRODUCT_HIDDEN",
                availabilityReason: data.message || window.AZIEL_CATALOG?.availabilityMessage?.("PRODUCT_HIDDEN")
            };
        }).catch(() => ({
            availabilityCode: "CATALOG_UNAVAILABLE",
            availabilityReason: window.AZIEL_CATALOG?.availabilityMessage?.("CATALOG_UNAVAILABLE") || "Catalog is temporarily unavailable. Please try again shortly."
        })).then(result => {
            renderUnavailableState(result, result.availabilityCode === "COMING_SOON" ? "COMING_SOON" : "HIDDEN");
            return result;
        });
        return directAvailabilityRequest;
    }

    function resolveProductKnowledge(source = {}) {
        const locale = window.AZIEL_LOCALE?.getLocale?.() || window.AZIEL_I18N?.getLang?.() || "en";
        const locales = source.locales || {};
        const hasContent = value => Boolean(value && (
            value.shortDescription || value.about?.summary || value.about?.details ||
            value.purchaseNotes?.length || value.packageGuide?.intro || value.packageGuide?.groups?.length || value.faq?.length
        ));
        const english = hasContent(locales.en) ? locales.en : source;
        const requested = locales[locale] || {};
        if (locale === "en" || !hasContent(requested)) return english;
        return {
            shortDescription: requested.shortDescription || english.shortDescription || "",
            about: {
                summary: requested.about?.summary || english.about?.summary || "",
                details: requested.about?.details || english.about?.details || ""
            },
            purchaseNotes: requested.purchaseNotes?.length ? requested.purchaseNotes : (english.purchaseNotes || []),
            packageGuide: {
                intro: requested.packageGuide?.intro || english.packageGuide?.intro || "",
                groups: requested.packageGuide?.groups?.length ? requested.packageGuide.groups : (english.packageGuide?.groups || [])
            },
            faq: requested.faq?.length ? requested.faq : (english.faq || [])
        };
    }

    document.addEventListener("pricesRendered", renderLowerProductContent);
    document.addEventListener("aziel:catalog-updated", renderLowerProductContent);
    window.addEventListener("aziel:shopRegionChanged", renderLowerProductContent);
    window.addEventListener("aziel:locale-changed", renderLowerProductContent);
    document.addEventListener("DOMContentLoaded", renderLowerProductContent);
    renderProductIdentity({
        productCode: document.getElementById("packages")?.dataset.game || "",
        name: initialProductName,
        description: initialProductDescription,
        imageUrl: window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(document.getElementById("packages")?.dataset.game || "") || "",
        supportedRegions: []
    });
})();
