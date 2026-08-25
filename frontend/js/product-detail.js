// Generic canonical product-detail shell for canonical products without a dedicated static page.

(function () {
    const PRODUCT_COPY = Object.freeze({
        "mlbb-twilight-weekly-pass": ["Mobile Legends Twilight Pass & Weekly Pass", "Mobile Game", "Select an available Twilight or Weekly Pass package."],
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
    const copy = PRODUCT_COPY[productCode];
    const route = window.AZIEL_CATALOG_PRESENTATION?.resolveProductRoute?.("", productCode) || "";

    if (!copy || !route) {
        document.documentElement.dataset.publicProductState = "HIDDEN";
        return;
    }

    const [name, tag, packagePrompt] = copy;
    document.getElementById("packages")?.setAttribute("data-game", productCode);
    applyText("[data-product-title]", name);
    applyText("[data-product-tag]", tag);
    applyText("[data-package-prompt]", packagePrompt);
    applyText("[data-product-summary-name]", name);
    applyText("#selectedPackageTitle", "Select Package");

    const isValorant = productCode === "valorant";
    if (isValorant) {
        applyText('label[for="userId"]', "Riot ID");
        document.getElementById("userId")?.setAttribute("placeholder", "Name#TAG");
    }

    window.AZIEL_GAME_FLOW?.init({
        game: name,
        gameKey: productCode,
        userIdSelector: "#userId",
        zoneIdSelector: "",
        zoneRequired: false,
        userIdRequiredMessage: isValorant ? "Please enter your Riot ID (Name#TAG)." : `Please enter your ${name} account ID or username.`,
        accountFields: isValorant ? [{ key: "riotId", label: "Riot ID", selector: "#userId", required: true, requiredMessage: "Please enter your Riot ID (Name#TAG)." }] : undefined,
        pendingReturnUrl: `product.html?product=${encodeURIComponent(productCode)}`
    });
})();
