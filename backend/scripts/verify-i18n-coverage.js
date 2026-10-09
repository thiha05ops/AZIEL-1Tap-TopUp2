const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const FRONTEND = path.join(ROOT, "frontend");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function loadDictionary(file, rootName, lang) {
    const context = { window: {} };
    context.window[rootName] = {};
    vm.createContext(context);
    vm.runInContext(read(file), context, { filename: file });
    return context.window[rootName][lang] || {};
}

function sortedKeys(object) {
    return Object.keys(object).sort();
}

function walk(dir, predicate, output = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        if (["node_modules", "uploads", "assets", "css"].includes(entry.name)) continue;

        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(file, predicate, output);
        } else if (predicate(file)) {
            output.push(file);
        }
    }

    return output;
}

const excludedText = new Set([
    "AZIEL",
    "AZIEL 1Tap Shop",
    "Facebook",
    "Telegram",
    "YouTube",
    "Discord",
    "English",
    "မြန်မာ",
    "ไทย",
    "Myanmar",
    "Thailand",
    "MMK",
    "THB",
    "USD",
    "User ID",
    "Server ID",
    "Order ID",
    "API",
    "QR",
    "SCB",
    "KBZPay",
    "WavePay",
    "AYA Pay",
    "PromptPay",
    "Bangkok Bank",
    "AZIEL Wallet",
    "×",
    "© 2026 AZIEL 1Tap Shop.",
    "1 TAP. TOP UP. DONE."
]);

const excludedPattern = /^(\d+|[\d\s.,:()#%+\-/฿$Ks]+|[A-Z0-9_-]{2,}|https?:|\/|@)$/;

function collectHardcodedHtml(knownText) {
    const findings = [];
    const htmlFiles = walk(FRONTEND, file => file.endsWith(".html"));

    htmlFiles.forEach(file => {
        const relative = path.relative(ROOT, file);
        const content = fs.readFileSync(file, "utf8")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "");
        const regex = />\s*([^<>\n][^<>]*?)\s*</g;
        let match;

        while ((match = regex.exec(content))) {
            const text = match[1].replace(/\s+/g, " ").trim();
            if (!text || text.length < 2) continue;
            if (excludedText.has(text) || excludedPattern.test(text)) continue;
            if (knownText.has(text)) continue;

            const context = content.slice(Math.max(0, match.index - 220), match.index);
            if (/data-i18n-skip|no-translate/.test(context)) continue;

            findings.push(`${relative}: ${text}`);
        }
    });

    return findings;
}

function assertKeyParity(label, dictionaries) {
    const base = sortedKeys(dictionaries.en);
    Object.entries(dictionaries).forEach(([lang, dict]) => {
        assert.deepStrictEqual(
            sortedKeys(dict),
            base,
            `${label} ${lang} keys must match English.`
        );
    });
}

function main() {
    const publicDicts = {
        en: loadDictionary("frontend/lang/en.js", "AZIEL_LANG", "en"),
        my: loadDictionary("frontend/lang/my.js", "AZIEL_LANG", "my"),
        th: loadDictionary("frontend/lang/th.js", "AZIEL_LANG", "th")
    };
    const adminDicts = {
        en: loadDictionary("frontend/lang/admin/en.js", "AZIEL_ADMIN_LANG", "en"),
        my: loadDictionary("frontend/lang/admin/my.js", "AZIEL_ADMIN_LANG", "my"),
        th: loadDictionary("frontend/lang/admin/th.js", "AZIEL_ADMIN_LANG", "th")
    };

    assertKeyParity("public", publicDicts);
    assertKeyParity("admin", adminDicts);

    const i18nRuntime = read("frontend/js/i18n.js");
    assert(i18nRuntime.includes("{ ...english, ...localized }"), "Public i18n must merge locale keys over English fallback.");
    assert(i18nRuntime.includes("data-i18n-aria-label"), "Public i18n must support aria-label translation.");
    assert(!/fallback \|\| keyOrText/.test(i18nRuntime), "Public i18n must not expose raw keys as the primary fallback.");

    const adminRuntime = read("frontend/js/admin/admin-i18n.js");
    assert(adminRuntime.includes("\"th\""), "Admin i18n must support Thai.");
    assert(adminRuntime.includes("{ ...english, ...localized }"), "Admin i18n must merge locale keys over English fallback.");

    const adminHtml = read("frontend/admin.html");
    assert(adminHtml.includes("/lang/admin/th.js"), "Admin shell must load Thai admin dictionary.");
    assert(adminHtml.includes("<option value=\"th\">ไทย</option>"), "Admin language selector must expose Thai.");
    assert(read("frontend/admin-login.html").includes("/lang/admin/th.js"), "Admin login must load Thai admin dictionary.");

    const knownText = new Set([
        ...Object.keys(publicDicts.en),
        ...Object.values(publicDicts.en),
        ...Object.keys(adminDicts.en),
        ...Object.values(adminDicts.en)
    ].map(String));
    const hardcodedHtml = collectHardcodedHtml(knownText);
    assert.strictEqual(
        hardcodedHtml.length,
        0,
        `Uncovered hardcoded HTML strings:\n${hardcodedHtml.slice(0, 80).join("\n")}`
    );

    ["my", "th"].forEach(lang => {
        assert.notStrictEqual(publicDicts[lang].nav_home, publicDicts.en.nav_home, `Public ${lang} nav_home must be translated.`);
        assert.notStrictEqual(adminDicts[lang].dashboard, adminDicts.en.dashboard, `Admin ${lang} dashboard must be translated.`);
    });

    console.log("i18n coverage verification passed.");
}

main();
