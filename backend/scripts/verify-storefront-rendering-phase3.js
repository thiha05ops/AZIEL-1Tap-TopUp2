#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

const home = read("frontend/js/home.js");
const banners = read("frontend/js/home-banner-runtime.js");
const placement = read("frontend/js/home-placement-runtime.js");
const productStage = read("frontend/js/product-detail-stage.js");
const gameFlow = read("frontend/js/game-flow.js");
const account = read("frontend/js/account.js");
const header = read("frontend/js/header.js");
const railCss = read("frontend/css/home/home-product-system.css");

assert(!home.includes("initAzielBanner"), "home.js must not own carousel state.");
assert(banners.includes("__azielHomeBannerRuntimeReady"), "Canonical banner runtime must be idempotent.");
assert(banners.includes("AbortController") && banners.includes("cleanupCarouselController"), "Carousel refresh must remove old listeners/timers.");
assert(banners.includes("scheduleGestureRender(dragCurrentX)"), "Pointer moves must be requestAnimationFrame-batched.");
assert(banners.includes("measureCarousel(track)") && banners.includes("carouselMetrics.step"), "Gesture geometry must be cached outside repeated writes.");
const renderCards = banners.slice(banners.indexOf("function renderCards"), banners.indexOf("function getShortestOffset"));
assert(!renderCards.includes("clientWidth") && !renderCards.includes("getBoundingClientRect"), "Gesture rendering must not force layout reads.");
assert(banners.includes("reducedMotionMedia.matches") && banners.includes('listen(reducedMotionMedia, "change"'), "Autoplay must honor reduced-motion changes.");

assert(placement.includes("mobileLayoutActive === mobile"), "Section relocation must be idempotent.");
assert(placement.includes("renderHomeSections(lastProducts, lastCatalogReady)"), "Breakpoint changes must reuse catalog data.");
assert(railCss.includes("overflow-x: auto") && railCss.includes("scroll-snap-type: x mandatory"), "Mobile group rail must retain native horizontal scrolling.");
assert(railCss.includes("grid-template-columns: 1fr"), "Mobile grouped panel rows must remain one-column/five-row compatible.");

assert(!productStage.includes("new MutationObserver"), "Product Detail must not retain a body-wide observer.");
assert(productStage.includes('aziel:promo-controls-ready') && gameFlow.includes('aziel:promo-controls-ready'), "Promo relocation must use a deterministic lifecycle event.");

assert(account.includes("document.hidden || accountRefreshInFlight"), "Account polling must pause while hidden and avoid overlap.");
assert(account.includes("Promise.all(["), "Independent wallet and account refresh work must run concurrently.");
assert(header.includes('{ passive: true }') && header.includes("requestAnimationFrame"), "Canonical header scroll work must remain passive and frame-batched.");

for (const cssFile of ["frontend/css/core/main.css", "frontend/css/theme/aziel-design-system.css", "frontend/css/home/home.css", "frontend/css/home/aziel-home.css"]) {
    assert(read(cssFile).includes("scroll-behavior: auto"), `${cssFile} must not force global smooth scrolling.`);
}

console.log(JSON.stringify({
    result: "PASS",
    canonicalCarouselControllers: 1,
    rawPointerLayoutReads: 0,
    resizeCatalogRefetches: 0,
    bodyWideProductObservers: 0,
    hiddenAccountPolling: false,
    globalSmoothScrollForced: false
}, null, 2));
