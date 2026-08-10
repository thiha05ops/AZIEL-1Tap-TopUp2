const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function main() {
    const css = read("frontend/css/core/footer.css");
    const runtime = read("frontend/js/pwa-fix.js");
    const home = read("frontend/home.html");

    assert(css.includes("width: min(var(--public-storefront-max, 1500px)"), "Footer must use the shared storefront max-width.");
    assert(css.includes("grid-template-columns: minmax(220px, 1.35fr) repeat(5"), "Desktop footer must expose clear typography-first groups.");
    assert(css.includes("@media (max-width: 520px)") && css.includes("grid-template-columns: 1fr"), "Mobile footer must stack compactly.");
    assert(css.includes("padding-bottom: max(82px, calc(68px + env(safe-area-inset-bottom)))"), "Mobile footer must leave room for Live Chat and the safe area.");
    assert(css.includes(":focus-visible"), "Footer links must preserve visible focus.");
    assert(!/\\.site-footer\\s+>\\s+div\\s*\\{[\\s\\S]{0,120}box-shadow/.test(css), "Footer groups must not become cards.");

    ["Company", "Support", "Legal", "Follow Us", "Payment Methods"].forEach(label => {
        assert(home.includes(label) || home.includes(label.toLowerCase()), `Home footer missing ${label}.`);
    });

    assert(runtime.includes("initAzielFooterPolish"), "Shared runtime must own generated footer behavior.");
    assert(runtime.includes("new Date().getFullYear()"), "Footer year must be generated from runtime date.");
    assert(runtime.includes("noopener noreferrer"), "External footer links must be hardened.");
    assert(runtime.includes("Accepted payment methods"), "Payment logo group must have an accessible label.");

    console.log("Public footer verification passed.");
}

main();
