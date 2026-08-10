const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function main() {
    const runtime = read("frontend/js/game-presentation-runtime.js");
    const css = read("frontend/css/game/game.css");

    [
        "initHowToAccordion",
        "game-howto-toggle",
        "aria-expanded",
        "aria-controls",
        "setExpanded(isProductDetail ? false : desktopQuery.matches)",
        "button.addEventListener(\"click\"",
        "desktopQuery.addEventListener(\"change\"",
        "if (!isProductDetail) setExpanded(event.matches)"
    ].forEach(token => assert(runtime.includes(token), `game-presentation-runtime.js missing ${token}`));

    [
        ".game-howto",
        ".game-howto-panel",
        "max-height: 0",
        ".game-howto.is-expanded .game-howto-panel",
        "min-height: 48px",
        "border-bottom: 1px solid var(--border)",
        "grid-template-columns: 28px 1fr"
    ].forEach(token => assert(css.includes(token), `game.css missing mobile accordion CSS ${token}`));

    assert(!runtime.includes("localStorage") || !runtime.includes("gameHowTo"), "How To accordion state should not persist.");

    console.log("Mobile How To accordion verification passed.");
}

main();
