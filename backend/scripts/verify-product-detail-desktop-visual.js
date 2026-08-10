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
const productPages = [
    "product.html", "mlbb.html", "aov-id.html", "freefire.html", "genshin.html",
    "hok.html", "pubg-rp.html", "pubg.html", "roblox.html", "telegram.html"
];

assert(catalogRuntime.includes('artwork: String(item.iconUrl || "").trim()'), "catalog package artwork must come from managed package media");
assert(prices.includes("const artwork = String(item.artwork || \"\").trim()"), "text-only packages must not reserve media");
assert(prices.includes('media?.remove()'), "failed package media must be removed from the card");
assert(prices.includes('card?.classList.add("pack--text-only")'), "failed media must activate text-only layout");
assert(!prices.includes('data-package-media>\n        <img src="${escapeAttr(item.icon)}"'), "legacy icons must not masquerade as package artwork");

assert(desktopCss.includes("@media (min-width: 901px)"), "PD-1 styling must be desktop-only");
assert(desktopCss.includes("grid-template-columns: minmax(0, 1fr) 360px"), "desktop must use a wide package column and narrow purchase column");
assert(desktopCss.includes("repeat(auto-fit, minmax(min(220px, 100%), 1fr))"), "desktop package columns must respect a readable minimum width");
assert(desktopCss.includes("white-space: normal !important"), "package names must wrap instead of ellipsizing commerce information");
assert(desktopCss.includes("var(--public-storefront-gutter"), "Product Detail must use the shared Home/storefront gutter");
assert(desktopCss.includes("var(--public-storefront-mobile-gutter"), "Product Detail must use the shared storefront mobile gutter");
assert(desktopCss.includes(".order-left { display: contents; }"), "existing functional cards must be composed without changing runtime ownership");
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

productPages.forEach(page => {
    const html = read(`frontend/${page}`);
    assert(html.includes("/css/game/product-detail-desktop.css?v=20260811-footer-alignment"), `${page} must load the current shared Product Detail presentation layer`);
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
assert(gameFlow.includes('paymentSelectionStage: "checkout"'), "Product Detail flow must defer payment choice to Checkout");
assert(gameFlow.includes('sessionStorage.setItem("azielProductCheckoutDraft"'), "Product Detail must stage the existing order payload for Checkout");
assert(checkout.includes("AZIEL_CATALOG?.getPackage"), "Checkout must revalidate the selected canonical package");
assert(checkout.includes('window.location.href = "payment-method.html"'), "Checkout Review must hand off to the page-based Payment Method authority");
assert(read("frontend/checkout.html").includes('id="checkoutPayButton"'), "Checkout Review must retain its Payment Method handoff action");
assert(!read("frontend/checkout.html").includes('id="paymentGrid"'), "Payment method selection must not be embedded in Checkout Review");
assert(prices.includes("showPackageSkeletons(packageContainer)"), "package loading must use stable skeleton cards");
assert(!prices.includes('showCatalogMessage(packageContainer, "Loading packages..."'), "raw package loading text must not be visible");

assert(read("frontend/home.html").includes("product-detail-desktop.css") === false, "Home must remain outside PD-1 styling");

console.log("Product Detail PD-1 visual verification passed.");
