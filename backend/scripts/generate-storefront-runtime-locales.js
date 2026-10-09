#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const LANGUAGES = Object.freeze(["en", "my", "th"]);
const SOURCE = lang => path.join(ROOT, "frontend/lang", `${lang}.js`);
const RUNTIME = lang => path.join(ROOT, "frontend/lang/runtime", `${lang}.js`);
// Transitional Phase 1 build input. Phase 2 must fold these keys into the
// canonical per-language source catalogs and remove this input.
const LEGACY_SUPPLEMENT = path.join(ROOT, "frontend/lang/storefront-static.js");

function read(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch (error) {
        throw new Error(`Could not read locale source ${path.relative(ROOT, file)}: ${error.message}`);
    }
}

function sourceKeys(source, file) {
    const keys = [];
    const pattern = /^\s*(?:([A-Za-z_$][\w$]*)|"([^"]+)"|'([^']+)')\s*:/gm;
    for (const match of source.matchAll(pattern)) keys.push(match[1] || match[2] || match[3]);
    const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))].sort();
    if (duplicates.length) {
        throw new Error(`Duplicate locale keys in ${path.relative(ROOT, file)}: ${duplicates.join(", ")}`);
    }
    return keys;
}

function runSource(context, file) {
    const source = read(file);
    vm.runInContext(source, context, {
        filename: path.relative(ROOT, file),
        timeout: 1000,
        contextCodeGeneration: { strings: false, wasm: false }
    });
}

function validateDictionary(lang, value) {
    if (!value || Object.prototype.toString.call(value) !== "[object Object]") {
        throw new Error(`${lang} locale source did not produce a dictionary object.`);
    }
    for (const [key, translation] of Object.entries(value)) {
        if (!key || typeof translation !== "string" || !translation.trim()) {
            throw new Error(`${lang} locale has an invalid translation at key ${JSON.stringify(key)}.`);
        }
    }
}

function assertParity(dictionaries) {
    const englishKeys = Object.keys(dictionaries.en);
    for (const lang of LANGUAGES.slice(1)) {
        const localizedKeys = Object.keys(dictionaries[lang]);
        const missing = englishKeys.filter(key => !Object.prototype.hasOwnProperty.call(dictionaries[lang], key));
        const extra = localizedKeys.filter(key => !Object.prototype.hasOwnProperty.call(dictionaries.en, key));
        if (missing.length || extra.length) {
            throw new Error(`${lang} locale key parity failed. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`);
        }
    }
}

function buildDictionaries() {
    for (const lang of LANGUAGES) sourceKeys(read(SOURCE(lang)), SOURCE(lang));
    const sandbox = { window: { AZIEL_LANG: {} } };
    const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    for (const lang of LANGUAGES) runSource(context, SOURCE(lang));
    runSource(context, LEGACY_SUPPLEMENT);

    const dictionaries = {};
    for (const lang of LANGUAGES) {
        const dictionary = sandbox.window.AZIEL_LANG[lang];
        validateDictionary(lang, dictionary);
        dictionaries[lang] = Object.fromEntries(Object.entries(dictionary).sort(([left], [right]) => left.localeCompare(right, "en")));
    }

    assertParity(dictionaries);
    return dictionaries;
}

function renderRuntime(lang, dictionary) {
    return `window.AZIEL_LANG=window.AZIEL_LANG||{};window.AZIEL_LANG.${lang}=${JSON.stringify(dictionary)};\n`;
}

function generatedOutputs() {
    const dictionaries = buildDictionaries();
    return Object.fromEntries(LANGUAGES.map(lang => [lang, renderRuntime(lang, dictionaries[lang])]));
}

function check(outputs) {
    const stale = LANGUAGES.filter(lang => read(RUNTIME(lang)) !== outputs[lang]);
    if (stale.length) throw new Error(`Stale storefront runtime locale bundles: ${stale.join(", ")}. Run: node backend/scripts/generate-storefront-runtime-locales.js`);
}

function main() {
    const outputs = generatedOutputs();
    if (process.argv.includes("--check")) {
        check(outputs);
        console.log("Storefront runtime locale bundles are current.");
        return;
    }
    for (const lang of LANGUAGES) fs.writeFileSync(RUNTIME(lang), outputs[lang], "utf8");
    console.log(`Generated ${LANGUAGES.length} deterministic storefront runtime locale bundles.`);
}

if (require.main === module) {
    try { main(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = Object.freeze({ LANGUAGES, buildDictionaries, generatedOutputs, renderRuntime, check, sourceKeys, assertParity, validateDictionary });
