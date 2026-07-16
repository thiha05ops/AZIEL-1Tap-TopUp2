const fs = require("fs");
const path = require("path");
const faqLegalSurface = require("./verify-faq-legal-surface");

const ROOT = path.resolve(__dirname, "../..");

const SOCIAL_LINKS = [
    ["Facebook", "https://www.facebook.com/share/1DhL7dQ16a/?mibextid=wwXIfr"],
    ["Telegram", "https://t.me/aziel1tap"],
    ["YouTube", "https://youtube.com/@aziel1tapshop"],
    ["Discord", "https://discord.gg/txTGuTK76"]
];

const FOOTER_FILES = [
    "frontend/home.html",
    "frontend/mobile-games.html",
    "frontend/pc-games.html",
    "frontend/about.html",
    "frontend/contact.html",
    "frontend/support.html",
    "frontend/faq.html",
    "frontend/policies/privacy.html",
    "frontend/policies/terms.html",
    "frontend/policies/payment.html",
    "frontend/policies/refund.html",
    "frontend/policies/support.html"
];

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

function extractFollowBlock(source) {
    const match = source.match(/<h4[^>]*data-i18n="followUs"[^>]*>Follow Us<\/h4>([\s\S]*?)<\/div>/);
    return match ? match[1] : "";
}

function verifyAboutPage() {
    assert(fs.existsSync(path.join(ROOT, "frontend/about.html")), "About page must exist.");
    const file = "frontend/about.html";

    [
        "ABOUT AZIEL",
        "Built to make game top-ups simpler.",
        "Game top-ups should not feel complicated.",
        "More than a top-up page.",
        "How AZIEL works",
        "Thailand and Myanmar first.",
        "Our principles",
        "THE AZIEL PROMISE",
        "READY TO TOP UP?",
        "1 TAP.",
        "TOP UP.",
        "DONE."
    ].forEach(snippet => includes(file, snippet, `missing required About content: ${snippet}`));

    ["01 CHOOSE", "02 PAY", "03 TRACK", "04 DONE", "CLEAR", "SECURE", "RELIABLE", "SIMPLE"]
        .forEach(snippet => includes(file, snippet, `missing About flow/principle: ${snippet}`));

    includes(file, 'id="azHeaderMount"', "About must use shared header mount.");
    includes(file, "/js/header-loader.js", "About must use header-loader.");
    includes(file, "/js/theme.js", "About must use theme infrastructure.");
    includes(file, "/css/public-trust.css", "About must use focused public trust CSS.");
    includes(file, 'href="/home.html#popularGames"', "About Explore Games CTA must use a real destination.");
    includes(file, 'href="/support.html"', "About Support CTA must use a real destination.");
}

function verifyContactPage() {
    assert(fs.existsSync(path.join(ROOT, "frontend/contact.html")), "Contact page must exist.");
    const file = "frontend/contact.html";

    [
        "CONTACT AZIEL",
        "Need help? We're here.",
        "Support Center",
        "Orders, payments, wallet, and account support.",
        "aziel1tapshop@gmail.com",
        "https://t.me/aziel1tap",
        "https://discord.gg/txTGuTK76",
        "Before contacting support",
        "Order ID",
        "Game User ID / Server ID",
        "Never share your password, OTP code, or payment PIN with anyone.",
        "Support ownership"
    ].forEach(snippet => includes(file, snippet, `missing required Contact content: ${snippet}`));

    includes(file, 'id="azHeaderMount"', "Contact must use shared header mount.");
    includes(file, "/js/header-loader.js", "Contact must use header-loader.");
    includes(file, "/js/theme.js", "Contact must use theme infrastructure.");
    includes(file, "/css/public-trust.css", "Contact must use focused public trust CSS.");
    includes(file, 'href="/support.html"', "Contact must point authenticated issues to Support Center.");
    includes(file, 'target="_blank" rel="noopener noreferrer"', "External Contact links must use safe new-tab behavior.");

    notMatches(file, /aziel1tap9|tel:|Phone:|Support Time|Working Hours|support@aziel\.com/i, "Contact page must not expose stale legacy contact data.");
}

function verifyFooterDestinations() {
    FOOTER_FILES.forEach(file => {
        const source = read(file);
        assert(source.includes('href="about.html"') || source.includes('href="/about.html"'), `${file}: Company footer must link About AZIEL.`);
        assert(source.includes('href="contact.html"') || source.includes('href="/contact.html"'), `${file}: Company footer must link Contact Us.`);
        assert(source.includes("Game top-ups, order tracking, wallet services, and customer support in one place."), `${file}: Footer must use canonical safe brand statement.`);
        assert(!/<h4[^>]*data-i18n="company"[\s\S]*?href="#"/.test(source), `${file}: Company footer must not contain placeholder href.`);

        const followBlock = extractFollowBlock(source);
        assert(followBlock, `${file}: Follow Us footer block missing.`);
        const links = [...followBlock.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer">([^<]+)<\/a>/g)]
            .map(match => [match[2], match[1]]);
        assert(JSON.stringify(links) === JSON.stringify(SOCIAL_LINKS), `${file}: Follow Us links must match official links exactly.`);
        assert((followBlock.match(/<a /g) || []).length === 4, `${file}: Follow Us must contain exactly four entries.`);
        assert(!followBlock.includes('href="#"'), `${file}: Follow Us must not contain placeholder links.`);
    });
}

function verifySupportContactSurface() {
    const file = "frontend/support.html";
    includes(file, "https://t.me/aziel1tap", "Support Center Telegram link must use official Telegram.");
    includes(file, "https://discord.gg/txTGuTK76", "Support Center Discord link must use official Discord.");
    includes(file, "aziel1tapshop@gmail.com", "Support Center email must use public AZIEL email truth.");
    includes(file, "Never share passwords, OTPs, or payment PINs.", "Support Center must include security reminder.");
    notMatches(file, /https:\/\/t\.me\/("|')|aziel1tap9|support@aziel\.com|Working Hours|Everyday 9:00 AM - 11:00 PM|href="#"/i, "Support contact surface must not expose stale contact placeholders.");
}

function verifyCssAndClaimSafety() {
    const css = read("frontend/css/public-trust.css");
    ["@media (max-width: 900px)", "@media (max-width: 640px)", "overflow", "grid-template-columns: 1fr"]
        .forEach(snippet => assert(css.includes(snippet), `public-trust.css: missing responsive ownership snippet: ${snippet}`));

    ["frontend/about.html", "frontend/contact.html"].forEach(file => {
        const source = read(file);
        notMatches(file, /registered company|licensed payment provider|official partner|instant delivery|guaranteed|100% secure|number one|leading platform|thousands of customers|automated fulfillment|live PromptPay|Codex|SEAGM|supplier internals|Admin phases/i, "Unsupported public claim found.");
        notMatches(file, /localhost|127\.0\.0\.1|process\.env|EMAIL_PASS|OMISE_SECRET|JWT_SECRET|SESSION_SECRET/i, "Public trust page must not expose local URLs or secret/env values.");
        assert(!source.includes("javascript:void(0)"), `${file}: no javascript placeholder hrefs allowed.`);
    });
}

function main() {
    faqLegalSurface.main();
    verifyAboutPage();
    verifyContactPage();
    verifyFooterDestinations();
    verifySupportContactSurface();
    verifyCssAndClaimSafety();
    console.log("Public trust/company surface verification passed.");
}

main();
