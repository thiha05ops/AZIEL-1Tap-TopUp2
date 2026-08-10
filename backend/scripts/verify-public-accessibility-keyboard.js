const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function includes(file, token, message) {
    assert(read(file).includes(token), `${file}: ${message}`);
}

function main() {
    const header = read("frontend/js/header.js");
    const headerCss = read("frontend/css/theme/aziel-header.css");
    const search = read("frontend/js/search.js");
    const homeBanner = read("frontend/js/home-banner-runtime.js");
    const homePromotions = read("frontend/js/home-promotion-preview.js");
    const notifications = read("frontend/js/notifications-page.js");
    const notificationCss = read("frontend/css/notifications/notification.css");
    const homeCss = read("frontend/css/home/aziel-home.css");
    const gameRuntime = read("frontend/js/game-presentation-runtime.js");
    const faq = read("frontend/faq.html");

    assert(header.includes('aria-haspopup="true"'), "Games trigger must expose popup ownership.");
    assert(header.includes('aria-expanded="false"'), "Games trigger must initialize aria-expanded.");
    assert(header.includes('aria-controls="azGamesDropdownMenu"'), "Games trigger must control the menu.");
    assert(header.includes('role="menu"') && header.includes('role="menuitem"'), "Games dropdown must expose menu/menuitem roles.");
    assert(header.includes("syncDropdownA11y"), "Games dropdown must keep aria-expanded synchronized with visual state.");
    assert(header.includes("focusFirst") && header.includes("ArrowDown"), "Games dropdown must support keyboard entry.");
    assert(header.includes("restoreFocus") && header.includes("Escape"), "Games dropdown Escape must restore focus to the trigger.");
    assert(header.includes("Home") && header.includes("End"), "Games dropdown must support Home/End navigation.");

    assert(search.includes('role="dialog"') && search.includes('aria-modal="true"'), "Search overlay must remain a modal dialog.");
    assert(search.includes('type="text" inputmode="search"') && search.includes('role="searchbox"'), "Search input must expose text searchbox semantics without native search controls.");
    assert(search.includes('aria-autocomplete="list"'), "Search input must announce list autocomplete behavior.");
    assert(search.includes('aria-controls="azSearchBody"'), "Search input must control the results list.");
    assert(search.includes('aria-activedescendant'), "Search input must expose the active result.");
    assert(search.includes("trapFocus(event, overlay)"), "Search overlay must trap Tab only while active.");
    assert(search.includes("state.lastFocused") && search.includes("preventScroll: true"), "Search must restore focus to the opener.");
    assert(search.includes("ArrowDown") && search.includes("ArrowUp") && search.includes("Enter") && search.includes("Escape"), "Search keyboard controls missing.");

    assert(homeBanner.includes('aria-roledescription", "carousel"'), "Home carousel must expose carousel roledescription.");
    assert(homeBanner.includes("ArrowLeft") && homeBanner.includes("ArrowRight"), "Home carousel must support Left/Right arrows.");
    assert(homeBanner.includes('aria-current="false"') && homeBanner.includes("aria-current"), "Carousel indicators must report current state.");

    assert(homePromotions.includes('class="home-promotion-card"') && homePromotions.includes("promotion.title"), "Promotion links must receive an accessible name from their visible title.");
    assert(homePromotions.includes("promotion.imageAltText || promotion.title"), "Promotion media must expose meaningful configured or title fallback alt text.");

    assert(notifications.includes('setAttribute("role", "tablist")'), "Notification filters must expose a tablist.");
    assert(notifications.includes('role="tab"'), "Notification filter buttons must expose tab roles.");
    assert(notifications.includes("aria-selected") && notifications.includes("tabindex"), "Notification filters must manage selected/focus state.");
    assert(notifications.includes("ArrowRight") && notifications.includes("ArrowLeft") && notifications.includes("Home") && notifications.includes("End"), "Notification filters must support keyboard navigation.");

    assert(gameRuntime.includes("aria-expanded"), "Game mobile How To accordion must own aria-expanded.");
    assert(faq.includes("aria-expanded") && faq.includes("aria-controls"), "FAQ accordion controls must expose expanded/control state.");

    assert(headerCss.includes(":focus-visible"), "Header/search CSS must preserve visible focus indicators.");
    assert(homeCss.includes(":focus-visible"), "Home CSS must preserve visible focus indicators.");
    assert(notificationCss.includes(":focus-visible"), "Notification CSS must preserve visible focus indicators.");

    console.log("Public accessibility and keyboard verification passed.");
}

main();
