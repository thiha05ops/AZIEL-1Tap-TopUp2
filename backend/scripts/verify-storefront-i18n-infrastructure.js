#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const generator = require("./generate-storefront-runtime-locales");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

function createStorage(entries = []) {
    const values = new Map(entries);
    const writes = [];
    return {
        values,
        writes,
        api: {
            getItem(key) { return values.get(key) ?? null; },
            setItem(key, value) { writes.push([key, String(value)]); values.set(key, String(value)); },
            removeItem(key) { values.delete(key); }
        }
    };
}

function evaluateI18n(entries = []) {
    const storage = createStorage(entries);
    const document = {
        documentElement: { lang: "", dataset: {}, removeAttribute() {} },
        readyState: "complete",
        addEventListener() {},
        getElementById() { return null; },
        querySelectorAll() { return []; }
    };
    const window = {
        AZIEL_LANG: { en: {}, my: {}, th: {} },
        AZIEL_LOCALE_LOADER: { async load(lang) { return lang; } },
        addEventListener() {},
        dispatchEvent() {}
    };
    class CustomEvent {
        constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    }
    vm.runInNewContext(read("frontend/js/i18n.js"), {
        window,
        document,
        localStorage: storage.api,
        CustomEvent,
        location: { hostname: "example.com" },
        console
    });
    return { storage, document, i18n: window.AZIEL_I18N };
}

function evaluateLoader(entries = []) {
    const storage = createStorage(entries);
    const document = {
        documentElement: { lang: "", dataset: {} },
        readyState: "complete",
        head: { appendChild() {} },
        createElement() {
            return { dataset: {}, addEventListener() {}, textContent: "", id: "" };
        }
    };
    const window = { AZIEL_LANG: { en: {}, my: {}, th: {} } };
    vm.runInNewContext(read("frontend/js/locale-loader.js"), {
        window,
        document,
        localStorage: storage.api,
        console
    });
    return { storage, document, loader: window.AZIEL_LOCALE_LOADER };
}

function verifyDefaultLanguageResolution() {
    for (const [stored, expected] of [[null, "my"], ["en", "en"], ["th", "th"], ["my", "my"], ["obsolete", "my"]]) {
        const entries = stored === null ? [] : [["azielLanguage", stored]];
        const runtime = evaluateI18n(entries);
        const loader = evaluateLoader(entries);
        assert.strictEqual(runtime.i18n.getLang(), expected, `runtime language for ${stored ?? "fresh profile"}`);
        assert.strictEqual(loader.loader.initialLocale, expected, `loader language for ${stored ?? "fresh profile"}`);
        assert.strictEqual(runtime.document.documentElement.lang, expected, "runtime must synchronize the document language");
        assert.strictEqual(loader.document.documentElement.lang, expected, "loader must synchronize the initial document language");
        assert.strictEqual(runtime.storage.writes.length, 0, "initial resolution must not overwrite a canonical preference");
        assert.strictEqual(loader.storage.writes.length, 0, "locale loading must never write language preferences");
    }

    const legacy = evaluateI18n([["azielLang", "TH"]]);
    assert.strictEqual(legacy.i18n.getLang(), "th", "a valid explicit legacy preference must be preserved");
    assert.strictEqual(legacy.storage.values.get("azielLanguage"), "th", "a valid legacy preference must migrate to the canonical key");

    const invalidCanonicalWithLegacy = [["azielLanguage", "obsolete"], ["azielLang", "en"]];
    assert.strictEqual(evaluateLoader(invalidCanonicalWithLegacy).loader.initialLocale, "en", "loader must recover a valid explicit legacy preference after an invalid canonical value");
    assert.strictEqual(evaluateI18n(invalidCanonicalWithLegacy).i18n.getLang(), "en", "runtime must match loader legacy recovery");
}

async function verifyRuntimeAuthority() {
    const source = read("frontend/js/i18n.js");
    const writes = [];
    const events = [];
    const storage = new Map([["azielLanguage", "en"], ["shopRegion", "MM"], ["shopCurrency", "MMK"]]);
    const document = {
        documentElement: { lang: "", removeAttribute() {} },
        readyState: "complete",
        addEventListener() {},
        getElementById() { return null; },
        querySelectorAll() { return []; }
    };
    const window = {
        AZIEL_LANG: { en: { greeting: "Hello" }, my: { greeting: "မင်္ဂလာပါ" }, th: { greeting: "สวัสดี" } },
        AZIEL_LOCALE_LOADER: { async load(lang) { return lang; } },
        addEventListener() {},
        dispatchEvent(event) { events.push(event); }
    };
    class CustomEvent {
        constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    }
    const localStorage = {
        getItem(key) { return storage.get(key) ?? null; },
        setItem(key, value) { writes.push([key, String(value)]); storage.set(key, String(value)); },
        removeItem(key) { storage.delete(key); }
    };
    vm.runInNewContext(source, { window, document, localStorage, CustomEvent, location: { hostname: "example.com" }, console });
    assert.strictEqual(window.AZIEL_I18N, window.AZIEL_LOCALE, "AZIEL_I18N must be the single storefront authority");
    assert.deepStrictEqual([...window.AZIEL_I18N.supportedLocales], ["en", "my", "th"]);
    assert.strictEqual(await window.AZIEL_I18N.setLang("MY"), "my");
    assert.strictEqual(storage.get("azielLanguage"), "my");
    assert.strictEqual(document.documentElement.lang, "my");
    assert.strictEqual(events.filter(event => event.type === "aziel:languageChanged").length, 1);
    assert.strictEqual(events.some(event => event.type === "aziel:locale-changed"), false);
    assert.strictEqual(storage.get("shopRegion"), "MM", "language change must not mutate region");
    assert.strictEqual(storage.get("shopCurrency"), "MMK", "language change must not mutate currency");
    assert.strictEqual(writes.some(([key]) => ["language", "azielLang", "selectedLanguage"].includes(key)), false, "legacy language keys must not be written");
}

function activeCustomerJavaScript() {
    const root = path.join(ROOT, "frontend/js");
    const output = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.includes(".bak")) continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith("admin") && !["design-studio", "os"].includes(entry.name)) walk(file);
            } else if (entry.name.endsWith(".js") && !entry.name.startsWith("admin-")) output.push(file);
        }
    }
    walk(root);
    return output;
}

function verifyActiveListenersAndLegacyReachability() {
    const stale = activeCustomerJavaScript().filter(file => read(path.relative(ROOT, file)).includes("aziel:locale-changed"));
    assert.deepStrictEqual(stale.map(file => path.relative(ROOT, file)), [], "active storefront modules must use aziel:languageChanged only");
    const activePages = fs.readdirSync(path.join(ROOT, "frontend")).filter(name => name.endsWith(".html") && !name.startsWith("admin"));
    for (const page of activePages) {
        const html = read(`frontend/${page}`);
        assert(!html.includes("core/region/locale-switcher.js"), `${page} must not load the legacy core locale switcher`);
        assert(!html.includes("js/region-switcher.js"), `${page} must not load the Google Translate era region switcher`);
        assert(!html.includes("lang/storefront-static.js"), `${page} must use generated runtime catalogs, not storefront-static.js`);
    }
}

function verifyGenerator() {
    const first = generator.generatedOutputs();
    const second = generator.generatedOutputs();
    assert.deepStrictEqual(first, second, "runtime generation must be deterministic");
    generator.check(first);
    assert.throws(() => generator.sourceKeys("window.X={\n duplicate: 'a',\n duplicate: 'b'\n};", path.join(ROOT, "duplicate.js")), /Duplicate locale keys/);
    assert.throws(() => generator.assertParity({ en: { required: "Required" }, my: {}, th: { required: "จำเป็น" } }), /my locale key parity failed/);
    assert.throws(() => generator.assertParity({ en: { required: "Required" }, my: { required: "လိုအပ်" }, th: {} }), /th locale key parity failed/);
    assert.throws(() => generator.validateDictionary("my", { broken: null }), /invalid translation/);
    const stale = { ...first, en: `${first.en}// stale\n` };
    assert.throws(() => generator.check(stale), /Stale storefront runtime locale bundles/);
}

function verifyPaymentContractsUntouched() {
    const combined = [
        read("backend/services/myanmyanpay/myanMyanPayPaymentPolicy.js"),
        read("backend/services/commerce/providers/myanMyanPayAdapter.js"),
        read("frontend/js/payment/mm-payment-shell.js")
    ].join("\n");
    for (const token of ["MYANMYANPAY", "myanmyanpay_mmqr", "MYANMYANPAY_MMQR", "provider_webhook"]) assert(combined.includes(token), `${token} payment contract must remain intact`);
}

async function main() {
    verifyDefaultLanguageResolution();
    await verifyRuntimeAuthority();
    verifyActiveListenersAndLegacyReachability();
    verifyGenerator();
    verifyPaymentContractsUntouched();
    console.log("Storefront i18n Phase 1 infrastructure verification passed.");
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
