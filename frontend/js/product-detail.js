// Generic canonical product-detail shell for canonical products without a dedicated static page.

(function () {
    const PRODUCT_COPY = Object.freeze({
        "mlbb-twilight-weekly-pass": ["Mobile Legends Twilight Pass & Weekly Diamonds", "Mobile Game", "Select an available Weekly Diamonds or Twilight Pass package."],
        "marvel-rivals": ["Marvel Rivals Top Up", "Mobile Game", "Select an available Marvel Rivals top-up package."],
        "blood-strike": ["Blood Strike Golds", "Mobile Game", "Select an available Blood Strike Golds package."],
        "blood-strike-pass": ["Blood Strike Pass", "Mobile Game", "Select an available Blood Strike Pass package."],
        "age-of-empires-mobile": ["Age of Empires Mobile Top Up", "Mobile Game", "Select an available Age of Empires Mobile top-up package."],
        "lineage-2m": ["Lineage 2M Top Up", "Mobile Game", "Select an available Lineage 2M top-up package."],
        overmortal: ["OverMortal Voucher", "Mobile Game", "Select an available OverMortal voucher package."],
        "magic-chess-go-go": ["Magic Chess: Go Go Top Up", "Mobile Game", "Select an available Magic Chess: Go Go top-up package."],
        lifeafter: ["LifeAfter Credits & Packages", "Mobile Game", "Select an available LifeAfter credits or package option."],
        capcut: ["CapCut Top Up", "Social Top Up", "Select an available CapCut top-up package."],
        valorant: ["Valorant", "Thailand", "Select an available Valorant Points package."]
    });

    function productCodeFromUrl() {
        return String(new URLSearchParams(window.location.search).get("product") || "").trim().toLowerCase();
    }

    function applyText(selector, value) {
        const node = document.querySelector(selector);
        if (node) node.textContent = value;
    }

    const productCode = productCodeFromUrl();
    if (productCode === "mlbb-twilight-weekly-pass") {
        window.location.replace("mlbb.html?product=mlbb-twilight-weekly-pass");
        return;
    }
    if (productCode === "freefire-pass-membership") {
        window.location.replace("freefire.html?product=freefire-pass-membership");
        return;
    }
    const route = window.AZIEL_CATALOG_PRESENTATION?.resolveProductRoute?.("", productCode) || "";

    if (!route) {
        document.documentElement.dataset.publicProductState = "HIDDEN";
        return;
    }

    async function bootstrap() {
        try {
            await window.AZIEL_CATALOG?.ensureFresh?.();
        } catch (_) {
            document.documentElement.dataset.publicProductState = "HIDDEN";
            return null;
        }
        const product = window.AZIEL_CATALOG?.getProduct?.(productCode);
        if (!product) {
            document.documentElement.dataset.publicProductState = "HIDDEN";
            return null;
        }
        const fallback = PRODUCT_COPY[productCode] || [];
        const name = product.name || fallback[0] || productCode;
        const tag = product.displayMarketLabel || fallback[1] || String(product.catalogCategory || "Product").replaceAll("_", " ");
        const packagePrompt = product.productKnowledge?.shortDescription || product.description || fallback[2] || "Select an available package.";
        document.getElementById("packages")?.setAttribute("data-game", productCode);
        applyText("[data-product-title]", name);
        applyText("[data-product-tag]", tag);
        applyText("[data-package-prompt]", packagePrompt);
        applyText("[data-product-summary-name]", name);
        applyText("#selectedPackageTitle", "Select Package");

        const contract = window.AZIEL_GAME_INPUT_CONTRACTS?.forProduct?.(productCode);
        const accountCard = document.getElementById("userId")?.closest(".form-card");
        const firstField = contract?.accountFields?.[0];
        if (!firstField) {
            document.documentElement.dataset.publicProductState = "SETUP_INCOMPLETE";
            return product;
        }
        applyText('label[for="userId"]', firstField.label);
        document.getElementById("userId")?.setAttribute("placeholder", firstField.key === "riotId" ? "Name#TAG" : `Enter ${firstField.label}`);
        if (contract?.accountFields?.some(field => field.key === "zoneId") && !document.getElementById("serverId")) {
            const label = document.createElement("label"); label.htmlFor = "serverId"; label.textContent = "Zone ID";
            const input = document.createElement("input"); input.type = "text"; input.id = "serverId"; input.inputMode = "numeric"; input.placeholder = "Enter Zone ID";
            accountCard?.append(label, input);
        }

        window.AZIEL_GAME_FLOW?.init({
            game: name,
            gameKey: productCode,
            userIdSelector: "#userId",
            zoneIdSelector: contract?.accountFields?.some(field => field.key === "zoneId") ? "#serverId" : "",
            zoneRequired: contract?.accountFields?.some(field => field.key === "zoneId") || false,
            userIdRequiredMessage: firstField.requiredMessage,
            accountFields: contract.accountFields,
            pendingReturnUrl: `product.html?product=${encodeURIComponent(productCode)}`
        });
        return product;
    }

    window.AZIEL_GENERIC_PRODUCT_DETAIL = Object.freeze({ bootstrap });
    bootstrap();
})();
