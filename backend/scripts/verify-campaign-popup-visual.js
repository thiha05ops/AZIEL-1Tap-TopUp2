const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function includes(file, pattern, message) {
    assert(read(file).includes(pattern), `${file}: ${message}`);
}

function matches(file, pattern, message) {
    assert(pattern.test(read(file)), `${file}: ${message}`);
}

function verifyRuntimeOwnership() {
    includes("frontend/js/campaign-runtime.js", "renderPopup(campaign", "campaign-runtime.js must remain popup owner.");
    includes("frontend/js/campaign-runtime.js", "/api/campaigns/entry-popup/claim", "Claim endpoint contract must remain unchanged.");
    includes("frontend/js/campaign-runtime.js", "AZIEL_CAMPAIGNS", "Campaign runtime global must remain.");
    includes("frontend/js/campaign-runtime.js", "isAdminPage", "Runtime must avoid Admin pages.");
    includes("frontend/js/campaign-runtime.js", "selectGuestCampaign", "Guest frequency flow must remain.");
    includes("frontend/js/campaign-runtime.js", "markGuestShown", "Guest shown state must remain.");
    includes("frontend/js/campaign-runtime.js", "bangkokDayKey", "Asia/Bangkok daily frequency helper must remain.");
}

function verifyVisualStyleOwner() {
    includes("frontend/js/campaign-runtime.js", "/css/campaign/campaign-popup.css", "Runtime must load the shared popup stylesheet.");
    includes("frontend/admin.html", "/css/campaign/campaign-popup.css", "Admin Preview must reuse the shared popup stylesheet.");
    includes("frontend/css/campaign/campaign-popup.css", ".campaign-popup-dialog", "Shared popup stylesheet must own popup dialog styles.");
    assert(!read("frontend/css/admin/admin-design-system.css").includes(".campaign-popup-overlay"), "Admin CSS must not duplicate popup visual ownership.");
}

function verifyImageAtmosphere() {
    includes("frontend/js/campaign-runtime.js", "has-image", "Runtime must support has-image state.");
    includes("frontend/js/campaign-runtime.js", "no-image", "Runtime must support no-image state.");
    includes("frontend/js/campaign-runtime.js", "--campaign-image-url", "Runtime must pass dynamic Campaign image URL to CSS.");
    includes("frontend/js/campaign-runtime.js", "campaign-popup-atmosphere", "Runtime must create atmosphere layer.");
    includes("frontend/js/campaign-runtime.js", "campaign-popup-visual", "Runtime must create visual image layer.");
    includes("frontend/js/campaign-runtime.js", "image.addEventListener(\"error\"", "Image failure must be handled.");
    includes("frontend/css/campaign/campaign-popup.css", "background-image: var(--campaign-image-url)", "Atmosphere must use actual Campaign image dynamically.");
    includes("frontend/css/campaign/campaign-popup.css", "filter: blur", "Atmosphere must use blurred image color bleed.");
    includes("frontend/css/campaign/campaign-popup.css", ".campaign-popup-dialog.no-image", "No-image popup state must be styled.");
    includes("frontend/css/campaign/campaign-popup.css", ".campaign-popup-visual::before", "Image edge must be blended by gradient.");
}

function verifyResponsiveComposition() {
    includes("frontend/css/campaign/campaign-popup.css", "grid-template-columns: minmax(0, .88fr) minmax(360px, 1.12fr)", "Desktop must support content-left / visual-right composition.");
    includes("frontend/css/campaign/campaign-popup.css", "width: min(960px, calc(100vw - 64px))", "Desktop popup should be wide/cinematic.");
    matches("frontend/css/campaign/campaign-popup.css", /@media\s*\(max-width:\s*820px\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, "Mobile must intentionally stack instead of squeezing desktop columns.");
    includes("frontend/css/campaign/campaign-popup.css", "width: min(520px, calc(100vw - 32px))", "Mobile popup must remain floating with gutters.");
    includes("frontend/css/campaign/campaign-popup.css", "max-height: calc(100dvh - 48px", "Mobile popup must be viewport-safe.");
    includes("frontend/css/campaign/campaign-popup.css", "overflow-y: auto", "Popup must support internal overflow.");
    includes("frontend/css/campaign/campaign-popup.css", "env(safe-area-inset-top)", "Safe-area support must exist.");
    assert(!read("frontend/css/campaign/campaign-popup.css").includes("height: 100dvh"), "Popup itself must not become full-screen height.");
    assert(!read("frontend/css/campaign/campaign-popup.css").includes("width: 100vw"), "Popup itself must not become full-screen width.");
    assert(!read("frontend/css/campaign/campaign-popup.css").includes("border-radius: 0"), "Mobile popup must keep rounded corners.");
}

function verifyTypographyAndInteraction() {
    includes("frontend/css/campaign/campaign-popup.css", "font-size: clamp(2rem, 4vw, 3.5rem)", "Desktop title hierarchy must be strong.");
    includes("frontend/css/campaign/campaign-popup.css", "max-width: 44ch", "Body line length must be controlled.");
    includes("frontend/css/campaign/campaign-popup.css", "linear-gradient(135deg, #8b5cf6", "CTA must use premium purple gradient treatment.");
    includes("frontend/css/campaign/campaign-popup.css", "width: 44px", "Close control must preserve approximate 44px target.");
    includes("frontend/css/campaign/campaign-popup.css", "min-height: 46px", "CTA must remain touch-usable.");
    includes("frontend/css/campaign/campaign-popup.css", ":focus-visible", "Visible focus states must remain.");
    includes("frontend/css/campaign/campaign-popup.css", "prefers-reduced-motion: reduce", "Reduced motion must be respected.");
}

function verifyAccessibilityAndSafety() {
    includes("frontend/js/campaign-runtime.js", "setAttribute(\"role\", \"dialog\")", "Dialog role must remain.");
    includes("frontend/js/campaign-runtime.js", "setAttribute(\"aria-modal\", \"true\")", "aria-modal must remain.");
    includes("frontend/js/campaign-runtime.js", "Close campaign popup", "Accessible close label must remain.");
    includes("frontend/js/campaign-runtime.js", "event.key === \"Escape\"", "Escape close must remain.");
    includes("frontend/js/campaign-runtime.js", "trapFocus", "Focus trap must remain.");
    includes("frontend/js/campaign-runtime.js", "az-campaign-lock", "Body scroll lock must remain.");
    includes("frontend/js/campaign-runtime.js", "event.target === overlay", "Backdrop close must remain.");
    includes("frontend/js/campaign-runtime.js", "title.textContent", "Title must render as safe text.");
    includes("frontend/js/campaign-runtime.js", "body.textContent", "Body must render as safe text.");
    assert(!read("frontend/js/campaign-runtime.js").includes("innerHTML"), "Runtime must not render Campaign content with innerHTML.");
    assert(!read("frontend/js/campaign-runtime.js").includes("canvas"), "No canvas pixel sampling may be added.");
}

function verifyScopeBoundaries() {
    const pkg = read("package.json");
    ["colorthief", "color-thief", "vibrant", "node-vibrant"].forEach(dep => {
        assert(!pkg.toLowerCase().includes(dep), `No heavy color extraction dependency allowed: ${dep}`);
    });
    includes("backend/models/Campaign.js", "enum: CAMPAIGN_PLACEMENTS", "Campaign model must use the central placement contract.");
    includes("backend/catalog/campaignPlacements.js", "ENTRY_POPUP", "ENTRY_POPUP must remain supported.");
    includes("backend/services/campaignService.js", "ONCE_EVERY_3_DAYS", "Campaign frequency semantics must remain.");
    includes("backend/services/campaignService.js", "Asia/Bangkok", "Asia/Bangkok day semantics must remain.");
    assert(!read("frontend/js/home.js").includes("campaign-popup"), "No page-specific Campaign popup logic in home.js.");
    assert(!read("frontend/js/game-flow.js").includes("campaign-popup"), "No page-specific Campaign popup logic in game-flow.js.");
}

function main() {
    verifyRuntimeOwnership();
    verifyVisualStyleOwner();
    verifyImageAtmosphere();
    verifyResponsiveComposition();
    verifyTypographyAndInteraction();
    verifyAccessibilityAndSafety();
    verifyScopeBoundaries();
    console.log("Campaign popup visual verification passed.");
}

main();
