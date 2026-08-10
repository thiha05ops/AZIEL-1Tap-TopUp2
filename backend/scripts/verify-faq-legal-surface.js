const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

const POLICY_FILES = [
    "frontend/policies/privacy.html",
    "frontend/policies/terms.html",
    "frontend/policies/payment.html",
    "frontend/policies/refund.html",
    "frontend/policies/support.html"
];

const PUBLIC_SURFACE_FILES = [
    "frontend/faq.html",
    ...POLICY_FILES,
    "frontend/about.html",
    "frontend/contact.html",
    "frontend/support.html",
    "frontend/home.html",
    "frontend/mobile-games.html",
    "frontend/pc-games.html",
    "frontend/lang/en.js",
    "frontend/lang/th.js",
    "frontend/lang/my.js"
];

const FOOTER_FILES = [
    "frontend/home.html",
    "frontend/mobile-games.html",
    "frontend/pc-games.html",
    "frontend/about.html",
    "frontend/contact.html",
    "frontend/support.html",
    "frontend/faq.html",
    ...POLICY_FILES
];

const REQUIRED_FAQ_QUESTIONS = [
    "What is AZIEL 1Tap Shop?",
    "Which regions or countries are currently supported?",
    "Which games or products are available?",
    "Which payment methods are available?",
    "Why does payment availability differ by region?",
    "How long does an order take?",
    "Where can I track my order?",
    "What do order statuses mean?",
    "Why is my order still Payment Pending?",
    "What does Manual Review mean?",
    "What happens after payment is confirmed?",
    "What should I do if my top-up is not received?",
    "Can I request a refund?",
    "Where will an approved refund be credited?",
    "What happens if I enter the wrong User ID or Server ID?",
    "Can a completed digital order be cancelled?",
    "How does AZIEL Wallet work?",
    "Why is my wallet balance not updated?",
    "How can I contact Support?",
    "What information should I provide to Support?",
    "Is Live Chat suitable for sending payment evidence?",
    "Will AZIEL ever ask for my password, OTP, or payment PIN?",
    "How do I reset my password?",
    "How are email notifications used?",
    "Why might an email or OTP be delayed?",
    "How can I report an unauthorized account action?",
    "Are prices and product availability permanent?",
    "Why might a package or payment method be temporarily unavailable?"
];

const SOCIAL_LINKS = [
    ["Facebook", "https://www.facebook.com/share/1DhL7dQ16a/?mibextid=wwXIfr"],
    ["Telegram", "https://t.me/aziel1tap"],
    ["YouTube", "https://youtube.com/@aziel1tapshop"],
    ["Discord", "https://discord.gg/txTGuTK76"]
];

const LEGAL_LINKS = [
    "/policies/privacy.html",
    "/policies/terms.html",
    "/policies/payment.html",
    "/policies/refund.html",
    "/policies/support.html"
];

const UNSUPPORTED_CLAIMS = /registered company|licensed payment provider|official partner|instant delivery|guaranteed|100% secure|best price|number one|leading platform|thousands of customers|millions of users|automated fulfillment|24\/7 support|live PromptPay|fully compliant|zero risk|permanent availability|1-5 Minutes|100% Protected|always low price/i;
const SECRET_OR_INTERNAL = /localhost|127\.0\.0\.1|process\.env|EMAIL_PASS|OMISE_SECRET|JWT_SECRET|SESSION_SECRET|supplier internals|Admin phases|raw payment evidence/i;

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
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

function findHtmlFiles(dir) {
    const absolute = path.join(ROOT, dir);
    const results = [];

    fs.readdirSync(absolute, { withFileTypes: true }).forEach(entry => {
        if (entry.isFile() && entry.name.endsWith(".html")) {
            results.push(path.join(dir, entry.name));
        }
    });

    return results;
}

function extractFollowBlock(source) {
    const match = source.match(/<h4[^>]*data-i18n="followUs"[^>]*>Follow Us<\/h4>([\s\S]*?)<\/div>/);
    return match ? match[1] : "";
}

function verifyFaq() {
    const file = "frontend/faq.html";
    const js = read("frontend/js/faq.js");
    const css = read("frontend/css/faq.css");
    const designSystem = read("frontend/css/theme/aziel-design-system.css");

    assert(exists(file), "FAQ page must exist.");
    includes(file, 'id="azHeaderMount"', "FAQ must use shared header mount.");
    includes(file, "/js/header-loader.js", "FAQ must use shared header loader.");
    includes(file, "AZIEL Help Center", "FAQ must present Help Center title.");
    includes(file, 'id="faqNoResults"', "FAQ must include no-result state.");
    includes(file, 'aria-expanded="false"', "FAQ buttons must expose aria-expanded.");
    includes(file, "aria-controls=", "FAQ buttons must expose aria-controls.");
    includes(file, 'role="region"', "FAQ answers must expose region semantics.");

    REQUIRED_FAQ_QUESTIONS.forEach(question => {
        includes(file, question, `required FAQ question missing: ${question}`);
    });

    assert((read(file).match(/class="faq-question"/g) || []).length >= 28, "FAQ must contain at least 28 accordion questions.");
    assert(js.includes('event.key !== "Enter" && event.key !== " "'), "frontend/js/faq.js: FAQ keyboard Enter/Space support missing.");
    assert(js.includes("faqNoResults"), "frontend/js/faq.js: FAQ search no-result support missing.");
    assert(js.includes("item.hidden"), "frontend/js/faq.js: FAQ search should hide items without layout hacks.");
    assert(designSystem.includes("--public-header-height: var(--az-header-height)"), "Shared design system must own public header spacing authority.");
    assert(css.includes("@media (prefers-reduced-motion: reduce)"), "frontend/css/faq.css: FAQ must respect reduced motion.");
    assert(css.includes("overflow-wrap: anywhere"), "frontend/css/faq.css: FAQ must protect long answer wrapping.");
    assert(css.includes(":focus-visible"), "frontend/css/faq.css: FAQ must expose focus styles.");
}

function verifyPolicies() {
    const designSystem = read("frontend/css/theme/aziel-design-system.css");
    POLICY_FILES.forEach(file => {
        assert(exists(file), `${file} must exist.`);
        includes(file, 'id="azHeaderMount"', "policy page must use shared header mount.");
        includes(file, "<title>", "policy title missing.");
        includes(file, 'meta name="description"', "policy meta description missing.");
        includes(file, "Last Updated: July 2026", "policy Last Updated missing.");
        includes(file, "/css/core/footer.css", "policy footer CSS missing.");
        includes(file, "/css/policy/policy.css", "policy CSS missing.");
        includes(file, "<footer class=\"site-footer trust-footer\"", "policy shared footer missing.");
    });

    [
        "Information We Collect",
        "How We Use Information",
        "Third-Party Service Categories",
        "Retention",
        "Your Choices",
        "Security",
        "Minors and Legal Capacity",
        "Contact"
    ].forEach(snippet => includes("frontend/policies/privacy.html", snippet, `privacy topic missing: ${snippet}`));

    [
        "Acceptance",
        "Account Eligibility and Security",
        "Accurate Identifiers",
        "Regional and Product Availability",
        "Prices and Payment Confirmation",
        "Manual Verification and Order Acceptance",
        "Fulfillment Timing and Digital Goods",
        "Prohibited Conduct",
        "Suspension, Maintenance, and Third-Party Dependencies",
        "Policy Changes and Contact"
    ].forEach(snippet => includes("frontend/policies/terms.html", snippet, `terms topic missing: ${snippet}`));

    includes("frontend/policies/payment.html", "Available Payment Options", "payment policy must use safer payment options heading.");
    includes("frontend/policies/payment.html", "checkout is the source of current availability", "payment policy must point to checkout as source of truth.");
    includes("frontend/policies/payment.html", "not the same as confirmed payment", "payment policy must distinguish submitted vs confirmed.");
    includes("frontend/policies/payment.html", "PromptPay provider flows must not be treated as production-live unless the active environment and provider configuration support live processing", "payment policy must avoid unsupported live-provider claims.");
    includes("frontend/policies/payment.html", "AZIEL will never ask for your password, OTP, recovery code, banking password, payment PIN", "payment policy security warning missing.");

    includes("frontend/policies/refund.html", "Approved and completed refunds are credited to AZIEL Wallet", "refund destination must match wallet refund truth.");
    includes("frontend/policies/refund.html", "does not promise a bank transfer or original-payment-method refund", "refund policy must not promise unsupported refund destination.");
    includes("frontend/policies/refund.html", "Fraud and Abuse Review", "refund fraud review missing.");

    includes("frontend/policies/support.html", "Support Center is the preferred channel", "support policy must establish Support Center ownership.");
    includes("frontend/policies/support.html", "Telegram and Discord are public community or update channels", "support policy must separate public channels.");
    includes("frontend/policies/support.html", "passwords, OTPs, recovery codes, banking passwords, or payment PINs", "support security warning missing.");
    includes("frontend/policies/support.html", "Response and resolution timing are not fixed", "support policy must avoid fixed response guarantee.");

    const css = read("frontend/css/policy/policy.css");
    assert(designSystem.includes("--public-header-height: var(--az-header-height)"), "Shared design system must retain policy/header spacing authority.");
    includes("frontend/css/policy/policy.css", "@media (max-width: 768px)", "policy responsive CSS missing.");
    includes("frontend/css/policy/policy.css", "overflow-wrap: anywhere", "policy text wrapping protection missing.");
    includes("frontend/css/policy/policy.css", ":focus-visible", "policy focus styles missing.");
    assert(!/(^|[^-])height:\s*\d+px/.test(css), "policy CSS must not use fixed content heights.");
}

function verifyFooter() {
    FOOTER_FILES.forEach(file => {
        const source = read(file);
        includes(file, "Game top-ups, order tracking, wallet services, and customer support in one place.", "canonical safe brand statement missing.");
        includes(file, "About AZIEL", "Company About link missing.");
        includes(file, "Contact Us", "Company Contact link missing.");
        includes(file, "Support Center", "Support Center link missing.");
        includes(file, "FAQ", "FAQ link missing.");

        LEGAL_LINKS.forEach(link => {
            const linkWithoutSlash = link.slice(1);
            assert(source.includes(`href="${link}"`) || source.includes(`href="${linkWithoutSlash}"`), `${file}: legal link missing: ${link}`);
        });

        const followBlock = extractFollowBlock(source);
        assert(followBlock, `${file}: Follow Us footer block missing.`);
        const links = [...followBlock.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer">([^<]+)<\/a>/g)]
            .map(match => [match[2], match[1]]);
        assert(JSON.stringify(links) === JSON.stringify(SOCIAL_LINKS), `${file}: Follow Us links must match official links exactly.`);
        assert((followBlock.match(/<a /g) || []).length === 4, `${file}: Follow Us must contain exactly four entries.`);
        assert(!followBlock.includes('href="#"'), `${file}: Follow Us must not contain placeholder links.`);
        assert(!/aziel1tap9|support@aziel\.com|Working Hours|Everyday 9:00 AM - 11:00 PM|tel:/i.test(source), `${file}: stale contact/footer value found.`);
    });

    findHtmlFiles("frontend").forEach(file => {
        const source = read(file);
        if (!source.includes("site-footer") && !source.includes("support-footer")) return;
        assert(!/<h4[^>]*data-i18n="company"[\s\S]*?href="#"/.test(source), `${file}: active footer must not contain placeholder company href.`);
    });
}

function verifyClaimSafety() {
    PUBLIC_SURFACE_FILES.forEach(file => {
        const publicText = file.includes("/lang/")
            ? read(file).replace(/^\s*"[^"]+"\s*:/gm, "")
            : read(file);
        assert(!UNSUPPORTED_CLAIMS.test(publicText), `${file}: unsupported public claim found.`);
        notMatches(file, SECRET_OR_INTERNAL, "public trust surface must not expose local URLs, secrets, or internal evidence/supplier terms.");
        assert(!read(file).includes("javascript:void(0)"), `${file}: no javascript placeholder hrefs allowed.`);
    });
}

function main() {
    verifyFaq();
    verifyPolicies();
    verifyFooter();
    verifyClaimSafety();
    console.log("FAQ and legal trust surface verification passed.");
}

if (require.main === module) {
    main();
}

module.exports = {
    main
};
