const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition, message) => {
    if (!condition) throw new Error(`Product Detail PD-1 verification failed: ${message}`);
};

const prices = read("frontend/js/prices.js");
const catalogRuntime = read("frontend/js/catalog-runtime.js");
const desktopCss = read("frontend/css/game/product-detail-desktop.css");
const productStage = read("frontend/js/product-detail-stage.js");
const checkout = read("frontend/js/product-checkout.js");
const gameFlow = read("frontend/js/game-flow.js");
const productDetail = read("frontend/js/product-detail.js");
const server = read("backend/server.js");
const routeContract = require("../config/storefrontRouteContract");
const productPages = ["product.html"];

assert(Object.keys(routeContract.PRODUCT_RENDERERS).length === 0, "all canonical products must use the shared Product Detail renderer");
assert(server.includes('app.get("/products/:productCode"'), "canonical products must use /products/:productCode");
assert(server.includes('const renderer = PRODUCT_RENDERERS[productCode] || "product.html"'), "canonical product routes must fall back to the shared Product Detail shell");

assert(catalogRuntime.includes('artwork: String(item.iconUrl || "").trim()'), "catalog package artwork must come from managed package media");
assert(prices.includes("const artwork = String(item.artwork || \"\").trim()"), "text-only packages must not reserve media");
assert(prices.includes('const longNameClass = String(item.name || "").trim().length > 28'), "long mobile package names must receive a presentation-only compact class");
assert(prices.includes('<div class="pack-content">'), "package artwork and title must share one mobile composition wrapper");
assert(prices.includes('media?.remove()'), "failed package media must be removed from the card");
assert(prices.includes('card?.classList.add("pack--text-only")'), "failed media must activate text-only layout");
assert(!prices.includes('data-package-media>\n        <img src="${escapeAttr(item.icon)}"'), "legacy icons must not masquerade as package artwork");

assert(desktopCss.includes("@media (min-width: 901px)"), "PD-1 styling must be desktop-only");
assert(desktopCss.includes("grid-template-columns: minmax(0, 1fr) 360px"), "desktop must use a wide package column and narrow purchase column");
assert(desktopCss.includes("repeat(auto-fit, minmax(min(220px, 100%), 1fr))"), "desktop package columns must respect a readable minimum width");
assert(desktopCss.includes("white-space: normal !important"), "package names must wrap instead of ellipsizing commerce information");
assert(desktopCss.includes("var(--public-storefront-gutter"), "Product Detail must use the shared Home/storefront gutter");
assert(desktopCss.includes("var(--public-storefront-mobile-gutter"), "Product Detail must use the shared storefront mobile gutter");
assert(
    /\.order-left\s*\{[^}]*\bdisplay\s*:\s*contents\s*;/s.test(desktopCss),
    "existing functional cards must be composed without changing runtime ownership"
);
assert(desktopCss.includes(".az-product-detail [hidden]"), "readiness-hidden Product Detail UI must override layout display rules");
assert(desktopCss.includes("display: none !important"), "readiness-hidden Product Detail UI must be removed from layout");
assert(!desktopCss.includes("--text-main"), "Product Knowledge must not use an undefined light-theme foreground token");
assert(desktopCss.includes(".product-faq-item summary"), "FAQ questions must have an explicit shared foreground");
assert(desktopCss.includes("color: var(--text-secondary)"), "Product Knowledge body copy must use shared secondary text hierarchy");
assert(desktopCss.includes("overflow-x") === false, "PD-1 must not override the shared overflow safety contract");
assert(desktopCss.includes(".az-product-detail .game-mini-footer"), "Product Detail footer alignment must stay scoped away from Home and other footer contracts");
assert(desktopCss.includes("minmax(0, 1.4fr) minmax(160px, .8fr) minmax(200px, 1fr)"), "desktop footer must retain its aligned three-column contract");
assert(desktopCss.includes("var(--public-storefront-max, 1500px)"), "footer and Product Detail content must share the storefront max-width token");
assert(desktopCss.includes("grid-template-columns: minmax(0, 1fr)"), "mobile Product Detail footer must stack without fixed widths");
assert(desktopCss.includes("height: 144px !important") && desktopCss.includes("max-height: 144px !important"), "mobile two-column package cards must keep equal fixed dimensions");
assert(desktopCss.includes("grid-template-rows: minmax(0, 1fr) auto"), "mobile package cards must reserve a shared content area above the price row");
assert(desktopCss.includes(".az-product-detail .pack-content") && desktopCss.includes("display: contents"), "desktop must keep the established package-card composition");
assert(desktopCss.includes("flex-direction: column !important") && desktopCss.includes("gap: 7px !important"), "mobile artwork and title must form one centered stack");
assert(desktopCss.includes(".pack-content:has(.pack-icon)") && desktopCss.includes("justify-content: flex-start !important") && desktopCss.includes("transform: translateY(-5px)"), "mobile icon-bearing content must move upward as one group to compensate for source transparency");
assert(desktopCss.includes("width: 64px !important") && desktopCss.includes("height: 55px !important"), "mobile package artwork must use a 64px image width inside a 55px visual slot");
assert(desktopCss.includes("height: auto !important") && desktopCss.includes("max-width: none !important"), "mobile artwork must size the image itself without square-thumbnail constraints");
assert(desktopCss.includes("object-fit: contain !important"), "mobile package artwork must preserve its aspect ratio without cropping");
assert(desktopCss.includes("border: 0 !important") && desktopCss.includes("background: transparent !important"), "mobile package artwork must not use a nested icon box");
assert(desktopCss.includes("text-align: center !important") && desktopCss.includes("-webkit-line-clamp: 3"), "mobile package names must center and wrap within a controlled height");
assert(desktopCss.includes(".pack.pack--long-name .pack-name") && desktopCss.includes("font-size: 11.5px !important"), "long mobile names must tighten instead of growing the card");
assert(
    desktopCss.includes(".pack:not(:has(.pack-icon)) .pack-info")
        && desktopCss.includes(".pack.pack--text-only .pack-info")
        && desktopCss.includes("align-self: stretch !important"),
    "text-only mobile packages must stretch and center within the content row without an empty icon slot"
);
assert(
    desktopCss.includes(".az-product-detail .pack-content")
        && desktopCss.includes("grid-row: 1 !important")
        && desktopCss.includes(".az-product-detail .pack-price-block")
        && desktopCss.includes("grid-row: 2 !important"),
    "text-only package content must not overlap the reserved price row"
);

productPages.forEach(page => {
    const html = read(`frontend/${page}`);
    assert(
        /href=["']\/css\/game\/product-detail-desktop\.css(?:\?[^"']*)?["']/.test(html),
        `${page} must load the current shared Product Detail presentation layer`
    );
    assert(html.includes('id="packages"'), `${page} must retain shared package rendering`);
    assert(html.includes('id="buyBtn"'), `${page} must retain Buy Now/checkout handoff`);
    assert(html.includes("/js/product-detail-stage.js?v="), `${page} must load staged checkout presentation`);
    assert(html.includes('class="az-product-detail"'), `${page} must expose Product Detail structure before hydration`);
    assert(/product-detail-stage\.js\?v=[^"']+" defer/.test(html), `${page} must stage the final shell before DOMContentLoaded`);
    assert(html.includes('class="game-mini-footer"'), `${page} must use the shared Product Detail footer contract`);
});

assert(productStage.includes('paymentCard?.remove()'), "Product Detail payment selector must be removed before payment runtime initializes");
assert(productStage.includes('paymentSummary?.remove()'), "Product Detail summary must not show a payment row");
assert(productStage.includes('orderLayout.insertAdjacentElement("afterend", info)'), "How to Top Up must move below the purchase area");
assert(productStage.includes("product-identity-media"), "Product Detail must use compact product identity media");
assert(productStage.includes('image.addEventListener("error", () => media.remove()'), "broken product artwork must collapse cleanly");
assert(productStage.includes('button.setAttribute("aria-expanded", "false")'), "lower information rows must use accessible accordion state");
assert(prices.includes('pack.onclick = () => selectPackage(pack)') && prices.includes('pack.onkeydown = event =>'), "package selection must support pointer and keyboard activation");
assert(prices.includes('packEl.setAttribute("aria-pressed", "true")') && prices.includes('new CustomEvent("packageSelected"'), "package selection must update accessible state and notify the order flow");
assert(productDetail.includes("product.customerInputContract?.verified === true"), "account inputs must come from the verified shared product contract");
assert(productDetail.includes("resolvedAccountFields.slice(1)") && productDetail.includes("applyConstraints(input, field)"), "shared Product Detail must render and constrain additional account inputs");
assert(productDetail.includes("window.location.pathname.match(/^\\/products\\/"), "shared Product Detail identity must come from the canonical product path");
assert(!productDetail.includes('localStorage.getItem("region")'), "customer payment country must not choose product or game-server identity");
assert(read("frontend/product.html").includes('id="summaryPackage"') && read("frontend/product.html").includes('id="summaryAmount"'), "shared Product Detail must retain package and total order summary fields");
assert(gameFlow.includes('paymentSelectionStage: "checkout"'), "Product Detail flow must defer payment choice to Checkout");
assert(gameFlow.includes('sessionStorage.setItem("azielProductCheckoutDraft"'), "Product Detail must stage the existing order payload for Checkout");
assert(
    checkout.includes('fetch("/api/commerce/checkout/review"')
        && checkout.includes("packageCode: draft.order.packageCode"),
    "Checkout must revalidate the selected canonical package"
);
assert(gameFlow.includes('window.location.href = flow.config.checkoutUrl || "/checkout"'), "Product Detail must hand the selected package to Checkout Review");
assert(checkout.includes("validateReviewForHandoff(authoritativeReview)") && checkout.includes("window.AZIEL_PAYMENT.start({"), "Checkout Review must validate its quote before handing off to the selected payment authority");
assert(read("frontend/checkout.html").includes('id="checkoutPayButton"'), "Checkout Review must retain its Payment Method handoff action");
assert(read("frontend/checkout.html").includes('id="paymentGrid"'), "Checkout Review must retain the current payment-method selection surface");
assert(prices.includes("showPackageSkeletons(packageContainer)"), "package loading must use stable skeleton cards");
assert(!prices.includes('showCatalogMessage(packageContainer, "Loading packages..."'), "raw package loading text must not be visible");

assert(read("frontend/home.html").includes("product-detail-desktop.css") === false, "Home must remain outside PD-1 styling");

console.log("Product Detail PD-1 visual verification passed.");
