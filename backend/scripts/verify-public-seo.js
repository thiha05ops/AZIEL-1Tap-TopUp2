const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

const SITE = "https://azielplay.com";
const SEO_FILES = [
    "frontend/home.html",
    "frontend/mlbb.html",
    "frontend/pubg.html",
    "frontend/freefire.html",
    "frontend/hok.html",
    "frontend/aov-id.html",
    "frontend/pubg-rp.html",
    "frontend/telegram.html",
    "frontend/genshin.html",
    "frontend/roblox.html",
    "frontend/mobile-games.html",
    "frontend/pc-games.html",
    "frontend/gift-cards.html",
    "frontend/about.html",
    "frontend/contact.html",
    "frontend/faq.html",
    "frontend/policies/privacy.html",
    "frontend/policies/terms.html",
    "frontend/policies/payment.html",
    "frontend/policies/refund.html",
    "frontend/policies/support.html"
];

function count(source, pattern) {
    return (source.match(pattern) || []).length;
}

function main() {
    const titles = new Set();

    SEO_FILES.forEach(file => {
        const source = read(file);
        const title = source.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
        assert(title, `${file}: title missing.`);
        assert(!titles.has(title), `${file}: duplicate title ${title}.`);
        titles.add(title);
        assert(count(source, /<title>/gi) === 1, `${file}: must have one title.`);
        assert(count(source, /name="description"/gi) === 1, `${file}: must have one meta description.`);
        assert(source.includes(`rel="canonical" href="${SITE}/`), `${file}: canonical must use ${SITE}.`);
        assert(source.includes('property="og:title"'), `${file}: Open Graph title missing.`);
        assert(source.includes('property="og:description"'), `${file}: Open Graph description missing.`);
        assert(source.includes('name="twitter:card"'), `${file}: Twitter card missing.`);
        assert(source.includes('name="robots" content="index, follow"'), `${file}: robots index/follow missing.`);
        assert(!/localhost|127\.0\.0\.1|onrender\.com/i.test(source), `${file}: SEO must not expose local or Render canonical URLs.`);
        assert(!/AggregateRating|ratingValue|reviewCount|lowPrice|highPrice|offers"\s*:/.test(source), `${file}: SEO must not publish fake prices or ratings.`);
    });

    const home = read("frontend/home.html");
    assert(home.includes('"@type": "Organization"'), "Home must include Organization schema.");
    assert(home.includes('"@type": "WebSite"'), "Home must include WebSite schema.");
    assert(!home.includes('"SearchAction"'), "Home must not declare SearchAction without a real query URL.");

    ["frontend/mlbb.html", "frontend/pubg.html", "frontend/freefire.html"].forEach(file => {
        const source = read(file);
        assert(source.includes('"@type":"Service"'), `${file}: game page must include truthful Service schema.`);
    });

    const robots = read("frontend/robots.txt");
    const sitemap = read("frontend/sitemap.xml");
    assert(robots.includes(`Sitemap: ${SITE}/sitemap.xml`), "robots.txt must point to azielplay sitemap.");
    assert(robots.includes("Disallow: /wallet.html") && robots.includes("Disallow: /notifications.html"), "robots.txt must exclude private surfaces.");
    assert(sitemap.includes(`${SITE}/home.html`) && sitemap.includes(`${SITE}/mlbb.html`), "Sitemap must use azielplay public URLs.");
    assert(!/onrender\.com|localhost|127\.0\.0\.1/i.test(sitemap + robots), "Sitemap/robots must not use local or Render URLs.");

    console.log("Public SEO verification passed.");
}

main();
