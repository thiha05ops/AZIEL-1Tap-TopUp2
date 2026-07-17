const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function reducedMotionBlock(css) {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    assert(start >= 0, "Reduced-motion media query missing.");
    return css.slice(start);
}

function assertTransformOpacityOnly(css, selector, label) {
    const block = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[\\s\\S]*?\\}`))?.[0] || "";
    assert(block, `${label} motion selector missing.`);
    assert(!/left\s*:|top\s*:|width\s*:|height\s*:/.test(block), `${label} must not animate layout properties.`);
}

function main() {
    const headerCss = read("frontend/css/theme/aziel-header.css");
    const homeCss = read("frontend/css/home/aziel-home.css");
    const notificationCss = read("frontend/css/notifications/notification.css");
    const homeBanner = read("frontend/js/home-banner-runtime.js");

    assert(headerCss.includes(".az-search-overlay") && headerCss.includes("opacity var(--az-motion-duration"), "Search overlay must animate with opacity.");
    assert(headerCss.includes(".az-nav-drop-menu") && headerCss.includes("transform: translateX(-50%) translateY(12px) scale(.96)"), "Games dropdown must use transform/opacity open motion.");
    assert(headerCss.includes(".az-search-result:hover") && headerCss.includes("transform: translateY(-1px)"), "Search result hover must use transform.");
    assert(reducedMotionBlock(headerCss).includes(".az-nav-drop-menu"), "Header reduced-motion block must cover dropdown motion.");
    assert(reducedMotionBlock(headerCss).includes(".az-search-overlay"), "Header reduced-motion block must cover search overlay motion.");
    assert(reducedMotionBlock(headerCss).includes(".az-skeleton-line"), "Header reduced-motion block must disable shared skeleton shimmer.");

    assert(homeBanner.includes("transform var(--az-banner-transition-duration") && homeBanner.includes("opacity var(--az-banner-transition-duration"), "Home carousel transition must use transform and opacity.");
    assert(!homeBanner.includes("setInterval(() => window") && !homeBanner.includes("requestAnimationFrame(loop"), "Home carousel must not introduce constant animation loops.");
    assert(homeCss.includes(".promotion-preview-item:hover") && homeCss.includes("transform: translateY(-1px)"), "Latest Promotions hover must use subtle transform.");
    assert(homeCss.includes("transform: scale(1.04)"), "Latest Promotions icon hover scale missing.");
    assert(reducedMotionBlock(homeCss).includes(".promotion-preview-item"), "Home reduced-motion block must cover promotion row motion.");
    assert(reducedMotionBlock(homeCss).includes(".promo-item.skeleton"), "Home reduced-motion block must disable promotion skeleton shimmer.");
    assertTransformOpacityOnly(homeCss, ".promotion-preview-item", "Latest Promotions");

    assert(notificationCss.includes(".noti-card:hover") && notificationCss.includes("transform: translateY(-1px)"), "Notification cards must use subtle hover transform.");
    assert(notificationCss.includes(".noti-filter:active") && notificationCss.includes("transform: scale(.98)"), "Notification filters must use button press transform.");
    assert(reducedMotionBlock(notificationCss).includes(".noti-card"), "Notification reduced-motion block must cover card motion.");
    assert(reducedMotionBlock(notificationCss).includes("#notificationDropdown"), "Notification reduced-motion block must cover dropdown motion.");

    console.log("Public motion and reduced-motion verification passed.");
}

main();
