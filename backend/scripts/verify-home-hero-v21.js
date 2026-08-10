const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const html = read("frontend/home.html");
const css = read("frontend/css/home/marketplace-reference.css");
const runtime = read("frontend/js/home-banner-runtime.js");

assert(!/az-home-ribbon|az-ribbon|azRibbon/i.test(html), "Home must not retain decorative ribbon markup.");
assert(!/az-home-ribbon|az-ribbon|azRibbon/i.test(css), "Home CSS must not retain decorative ribbon selectors or gradients.");
assert(!html.includes("az-bg-wave"), "Home must not retain the legacy decorative wave mount.");
assert(css.includes("object-fit: cover !important"), "Banner media must use natural cover cropping.");
assert(css.includes("object-position: var(--az-banner-object-position, center center) !important"), "Banner focal metadata must be preserved.");
assert(css.includes("cursor: grab"), "Desktop track must advertise grab interaction.");
assert(css.includes("cursor: grabbing"), "Active drag must advertise grabbing interaction.");
assert(css.includes("width: 66% !important"), "Active banner must use the corrected dominant width.");
assert(css.includes("width: 14% !important"), "Both adjacent previews must share one width authority.");

assert(runtime.includes("renderCards(dragCurrentX)"), "Pointer movement must update slide transforms continuously.");
assert(runtime.includes("DRAG_CLICK_THRESHOLD"), "Click and drag must have a dedicated threshold.");
assert(runtime.includes("FLICK_VELOCITY_THRESHOLD"), "Release must support velocity-based flicks.");
assert(runtime.includes("const desktopStep = (stageWidth * .397) + desktopGap"), "Side-preview offsets must use one symmetric stage-and-gap authority.");
assert(runtime.includes("diff < -DRAG_THRESHOLD || velocity < -FLICK_VELOCITY_THRESHOLD"), "Next-slide snap must use distance or velocity.");
assert(runtime.includes("diff > DRAG_THRESHOLD || velocity > FLICK_VELOCITY_THRESHOLD"), "Previous-slide snap must use distance or velocity.");
assert(runtime.includes("pauseForInteraction(goTo)"), "Drag must pause existing autoplay.");
assert(runtime.includes("scheduleAuto(goTo)"), "Autoplay must resume through existing scheduling authority.");
assert(runtime.includes('window.matchMedia("(prefers-reduced-motion: reduce)")'), "Autoplay must respect reduced motion.");
assert(runtime.includes('home.style.setProperty("--home-hero-rgb-primary"'), "Representative banner RGB must update the shared atmosphere authority.");
assert(runtime.includes("colorCache.has(source)"), "Representative image colors must be cached per source.");
assert(runtime.includes("await ensureImageReady(image)"), "Mounted banner media must decode before one-time RGB sampling.");
assert(runtime.includes("if (!colors.fallback) colorCache.set(source, colors)"), "A premature fallback must not poison the per-image RGB cache.");
assert(runtime.includes('crossorigin="anonymous"'), "Managed banner media must allow safe one-time RGB sampling when its provider supports CORS.");

const atmosphereBlock = css.slice(0, css.indexOf(".az-home .az-home-hero.az-banner-zone"));
assert(!atmosphereBlock.includes("radial-gradient"), "Upper Home atmosphere must not use a radial spotlight.");
assert(atmosphereBlock.includes("linear-gradient(180deg"), "Upper Home atmosphere must fade vertically.");

console.log("Home Hero RGB atmosphere and geometry verification passed.");
