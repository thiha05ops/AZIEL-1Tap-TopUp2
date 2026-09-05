const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition, message) => {
    if (!condition) throw new Error(`Product Detail Step 3 verification failed: ${message}`);
};

const flow = read("frontend/js/game-flow.js");
const stage = read("frontend/js/product-detail-stage.js");
const prices = read("frontend/js/prices.js");
const css = read("frontend/css/game/product-detail-desktop.css");
const locales = ["en", "my", "th"].map(locale => read(`frontend/lang/${locale}.js`));

const updateSummary = flow.slice(flow.indexOf("function updateSummary"), flow.indexOf("function buildOrderData"));

assert(stage.includes('priceLabel.textContent = tr("product.subtotal"'), "summary must label the current Commerce price as Subtotal");
assert(stage.includes('promoLine.id = "summaryDiscountRow"'), "summary must own a conditional Promo row");
assert(stage.includes('saved.id = "summaryPromoSaved"'), "summary must own an announced You saved line");
assert(stage.includes('saved.setAttribute("aria-live", "polite")'), "saving feedback must be announced accessibly");

assert(updateSummary.includes("pkg?.price"), "Subtotal must use the authoritative package preview price");
assert(updateSummary.includes("promo?.discountAmount"), "Promo row must use PricingQuote discountAmount");
assert(updateSummary.includes("promo?.finalAmount"), "Total must use PricingQuote finalAmount");
assert(!updateSummary.includes("referencePrice"), "referencePrice must not enter the transactional summary");
assert(!/discountAmount\s*=\s*[^;]*(baseAmount|referencePrice)\s*[-+*/]/.test(updateSummary), "frontend must not calculate authoritative Promo savings");

assert(flow.includes('t("product.promoInvalid"'), "invalid Promo feedback must use locale authority");
assert(flow.includes('t("product.promoExpired"'), "expired Promo feedback must use locale authority");
assert(flow.includes('t("product.promoNotEligible"'), "ineligible Promo feedback must use locale authority");
assert(flow.includes('data-i18n-placeholder="product.enterPromo"'), "Promo input must update when locale changes");
assert(flow.includes('data-i18n="product.applyPromo"'), "Promo actions must update when locale changes");
assert(flow.includes('removeBtn.hidden = !promo'), "Promo removal state must track the active server quote");
assert(flow.includes('promoSaved.hidden = !promo'), "removing Promo must hide saving feedback immediately");

assert(css.includes("information is typography-first"), "Step 3 presentation layer must be present");
assert(css.includes("background: transparent !important"), "informational sections must not use heavy card surfaces");
assert(css.includes("border-radius: 0 !important"), "informational sections must use divider structure");
assert(css.includes(".product-faq-item summary"), "FAQ must use simple disclosure-row styling");
assert(css.includes(".product-lower-info .step-row"), "How to Top Up must have compact mobile flow styling");
assert(css.includes("border-radius: 14px"), "functional mobile surfaces must retain card affordance");
assert(css.includes("grid-template-columns: minmax(0, 1fr) auto"), "Promo input and Apply action must remain compact on mobile");
assert(css.includes("@media (prefers-reduced-motion: reduce)"), "FAQ affordance must honor reduced motion");

assert(prices.includes('Number(item.discountPercent || 0).toLocaleString()}% ${escapeHtml(t("product.offerOff", "OFF"))}'), "compare badge must be compact and server-derived");
assert(prices.includes("Promise.allSettled"), "one preview failure must not reject the complete package grid");
assert(prices.includes("MOBILE_PACKAGE_PICKER_QUERY"), "mobile package picker breakpoint must be owned by prices.js");
assert(prices.includes("setupMobilePackagePicker()"), "mobile package picker must be initialized with the shared price renderer");
assert(prices.includes("resolved !== key ? resolved : fallback"), "missing selector translations must fall back instead of rendering literal i18n keys");
assert(prices.includes("function renderSelectedPackagePreview"), "compact package selector state must have one authoritative renderer");
assert(prices.includes("window.renderPackageSelectorState = renderSelectedPackagePreview"), "generic product bootstrap must be able to request selector-state refresh");
assert(prices.includes("[title, subtitle, code].forEach(claimRuntimeSelectorText)"), "selector renderer must claim runtime text ownership from static i18n");
assert(prices.includes("pkg.icon || defaultIcon"), "selected package preview must prefer package icon and fall back to mobile package preview");
assert(prices.includes("list.appendChild(packageContainer)"), "mobile picker must reuse the authoritative #packages DOM instead of duplicating package rendering");
assert(prices.includes("inlineParent.insertBefore(packageContainer"), "desktop must restore the existing inline package grid");
assert(prices.includes("openMobilePackagePicker"), "summary control must open the mobile package picker");
assert(prices.includes("closeMobilePackagePicker"), "picker must close without clearing selectedPackage");
assert(prices.includes("refreshMobilePackagePickerContainer"), "mobile picker must refresh stale #packages references before sync/open");
assert(prices.includes("event?.stopImmediatePropagation?.()"), "shared mobile picker must prevent legacy clone-panel handlers from clearing #mobilePackageList");
assert(!/productCode\s*===\s*\"(?:mlbb|pubg|heaven-burns-red|afk)/.test(prices), "mobile picker must not introduce product-specific package behavior");
assert(css.includes(".product-package-card > #packages") && css.includes("display: none !important"), "mobile Product Detail must not render the full package catalog inline");
assert(css.includes("#mobilePackageList #packages") && css.includes("display: block !important"), "mobile picker must render the shared package grid inside the sheet");
assert(css.includes(".mobile-selected-package:not([hidden])") && css.includes("display: grid !important"), "mobile compact package selector must override desktop hidden state");
assert(css.includes("grid-template-columns: 60px minmax(0, 1fr) 18px"), "mobile compact package selector must preserve larger preview image, text, and chevron columns");
assert(css.includes("min-height: 76px"), "mobile compact package selector must keep a compact commerce-row height");
assert(css.includes("border: 0 !important") && css.includes("background: transparent !important"), "mobile compact package selector must not render as a nested card");
assert(css.includes("box-shadow: none !important"), "mobile compact package selector must remove nested-card shadow");
assert(css.includes("width: 58px !important") && css.includes("height: 58px !important"), "mobile compact package selector preview image must have breathing room");
assert(css.includes("text-align: left !important"), "mobile compact package selector content must remain left aligned");
assert(css.includes("font-weight: 750"), "mobile compact package selector title must use a cleaner semibold hierarchy");
assert(css.includes(".mobile-selected-package.has-package span") && css.includes("color: var(--warning)"), "selected mobile package price must use AZIEL accent color");
assert(css.includes(".mobile-selected-package b") && css.includes("font-size: 22px"), "mobile compact package selector must retain a clear tap affordance");
assert(prices.includes('t("product.choosePackage", "Choose a package")'), "mobile selector title must have English fallback copy");
assert(prices.includes('t("product.tapToSelectPackage", "Tap to select")'), "mobile selector subtitle must have English fallback copy");
assert(!read("frontend/js/product-detail.js").includes('applyText("#selectedPackageTitle"'), "generic product bootstrap must not compete with the selector-state renderer");

[
    "product.subtotal", "product.promoDiscount", "product.youSaved", "product.enterPromo",
    "product.applyPromo", "product.removePromo", "product.promoApplied", "product.promoInvalid",
    "product.promoExpired", "product.promoNotEligible", "product.offerOff"
].forEach(key => locales.forEach((source, index) => {
    assert(source.includes(`"${key}"`), `${key} must exist in ${["EN", "MY", "TH"][index]}`);
}));

assert(stage.includes('document.createElement("details")'), "FAQ must preserve native keyboard-operable disclosures");
assert(css.includes("color: var(--text-secondary)"), "Product Knowledge body text must preserve theme-safe hierarchy");

console.log("Product Detail mobile + Promo presentation verification passed.");
