const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notMatches(file, pattern, message) {
    assert(!pattern.test(read(file)), `${file}: ${message}`);
}

function main() {
    const css = read("frontend/css/payment/payment-checkout-sheet.css");
    const mobileBlock = css.match(/@media \(max-width: 520px\) \{[\s\S]*?\n\}/)?.[0] || "";

    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        "z-index: 1000002;",
        "payment sheet must be above floating live chat widgets."
    );
    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        ".az-payment-sheet *,",
        "sheet descendants must share border-box/max-width ownership."
    );
    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        "box-sizing: border-box;",
        "sheet must enforce box sizing."
    );
    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        "overflow-x: hidden;",
        "overflow-x hiding must be owned by the sheet/sheet body."
    );
    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        "min-width: 0;",
        "panel/body/rows must be allowed to shrink inside mobile viewport."
    );
    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        "width: min(472px, calc(100vw - 24px));",
        "mobile panel must be viewport-bounded."
    );
    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        "max-width: calc(100vw - 24px);",
        "mobile panel must cap at visible viewport minus gutter."
    );
    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        "padding-right: max(12px, env(safe-area-inset-right));",
        "mobile overlay must respect right safe area."
    );
    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        "padding-left: max(12px, env(safe-area-inset-left));",
        "mobile overlay must respect left safe area."
    );
    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        "left: auto;",
        "sticky submit must not be viewport-positioned."
    );
    includes(
        "frontend/css/payment/payment-checkout-sheet.css",
        "right: auto;",
        "sticky submit must not be viewport-positioned."
    );

    assert(!/\.az-payment-sheet__panel\s*\{[\s\S]*?width:\s*100vw/.test(mobileBlock), "mobile panel must not use width: 100vw.");
    notMatches(
        "frontend/css/payment/payment-checkout-sheet.css",
        /\.az-payment-sheet\s*\{[\s\S]*?width:\s*100vw[\s\S]*?padding/i,
        "sheet must not combine width:100vw with horizontal padding."
    );

    includes(
        "frontend/js/payment/payment-checkout-sheet.js",
        "document.body.classList.add(\"az-payment-sheet-open\")",
        "opening the sheet must set body state for overlap prevention."
    );
    includes(
        "frontend/js/payment/payment-checkout-sheet.js",
        "document.body.classList.remove(\"az-payment-sheet-open\")",
        "closing the sheet must restore body state."
    );
    includes(
        "frontend/css/support/live-chat.css",
        "body.az-payment-sheet-open .aziel-support-tab",
        "live chat launcher must be hidden while payment sheet is open."
    );
    includes(
        "frontend/css/support/live-chat.css",
        "body.az-payment-sheet-open .live-chat-panel",
        "live chat panel must be hidden while payment sheet is open."
    );

    console.log("Payment modal mobile overflow verification passed.");
}

main();
