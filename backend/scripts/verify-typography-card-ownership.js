const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function main() {
    const design = read("frontend/css/theme/aziel-design-system.css");
    const home = read("frontend/css/home/aziel-home.css");
    const game = read("frontend/css/game/game.css");

    [
        "--az-page-max",
        "--az-gutter-desktop",
        "--az-gutter-mobile",
        "--az-section-gap",
        "--az-content-gap",
        "--az-radius-surface",
        "--az-radius-hero",
        "--az-type-page-title",
        "--az-type-section-title",
        "--az-type-subsection-title",
        "--az-type-label",
        "--az-type-meta",
        "--az-ambient-home-opacity",
        "--az-ambient-game-opacity",
        "--az-safe-action-bottom"
    ].forEach(token => assert(design.includes(token), `Design system missing shared token ${token}`));

    [
        "--public-page-max",
        "--public-gutter-mobile",
        "--type-section-title",
        "--surface-liquid",
        "--motion-ease-premium",
        "--ambient-home-opacity-light",
        "--safe-bottom"
    ].forEach(token => assert(design.includes(token), `Design system missing public storefront token ${token}`));

    [
        "CANONICAL TYPOGRAPHY-FIRST HOME RESET",
        ".az-section-head h2",
        ".trust-card",
        "box-shadow: none !important",
        "AZIEL PUBLIC STOREFRONT V2.6",
        "background: transparent !important"
    ].forEach(token => assert(home.includes(token), `Home typography/card reset missing ${token}`));

    [
        "CANONICAL MOBILE HOW TO + TYPE RESET",
        "font-size: var(--az-type-section-title",
        ".card-title h2",
        ".form-card label"
    ].forEach(token => assert(game.includes(token), `Game typography reset missing ${token}`));

    [home, game].forEach((css, index) => {
        const label = index === 0 ? "home" : "game";
        assert(!/width:\s*100vw[\s\S]{0,120}padding-(left|right|inline)|padding-(left|right|inline)[\s\S]{0,120}width:\s*100vw/i.test(css), `${label}: must not introduce 100vw plus padding overflow.`);
    });

    console.log("Typography and card ownership verification passed.");
}

main();
