#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const progressCss = read("frontend/css/core/loading-progress.css");
const manager = read("frontend/js/loading-manager.js");
const headerLoader = read("frontend/js/header-loader.js");

assert.match(progressCss, /@supports \(-webkit-touch-callout: none\)[\s\S]*font-size: max\(16px, 1em\) !important/);
assert.match(progressCss, /touch-action: manipulation/);
assert.doesNotMatch(progressCss, /touch-action:\s*none/);
assert.match(progressCss, /height:\s*2px/);
assert.match(progressCss, /prefers-reduced-motion:\s*reduce/);
assert.match(progressCss, /#6d28d9[\s\S]*#facc15/);

assert.match(manager, /const operations = new Set/);
assert.match(manager, /Promise\.resolve\(value\)\.finally\(\(\) => finish\(token\)\)/);
assert.match(manager, /operations\.size === 1/);
assert.match(manager, /window\.setTimeout\(\(\) => expire\(token\), 30000\)/);
assert.match(manager, /aziel:loadingExpired/);
assert.doesNotMatch(manager, /setTimeout\(\(\) => finish\(token\), 220\)/);
assert.match(manager, /target\.origin !== window\.location\.origin/);
assert.match(manager, /anchor\.hasAttribute\("download"\)/);
assert.doesNotMatch(manager, /window\.fetch\s*=/);
assert.doesNotMatch(manager, /XMLHttpRequest\.prototype/);
assert.doesNotMatch(manager, /history\.(pushState|replaceState)\s*=/);
assert.match(headerLoader, /__AZIEL_LOADING_SCRIPT_LOADER__/);
assert.match(headerLoader, /loading-progress\.css/);
assert.match(headerLoader, /loading-manager\.js/);

const nodes = [];
const mount = {
    id: "azHeaderMount",
    appendChild(node) {
        node.parentElement = this;
        if (!nodes.includes(node)) nodes.push(node);
    }
};
const documentStub = {
    readyState: "complete",
    body: mount,
    documentElement: mount,
    addEventListener() {},
    getElementById(id) { return id === "azHeaderMount" ? mount : null; },
    querySelector(selector) {
        return selector.includes("data-aziel-global-progress") ? nodes[0] || null : null;
    },
    createElement() {
        const classes = new Set();
        return {
            dataset: {},
            style: { setProperty() {} },
            classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
            setAttribute() {},
            parentElement: null,
            innerHTML: "",
            className: ""
        };
    }
};
const storage = new Map();
const windowStub = {
    location: { href: "https://aziel.example/login", origin: "https://aziel.example", pathname: "/login", search: "" },
    sessionStorage: {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key)
    },
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
};
vm.runInNewContext(manager, { window: windowStub, document: documentStub, URL, Promise, setTimeout, clearTimeout, setInterval, clearInterval });
const first = windowStub.AZIEL_LOADING.start("first");
const second = windowStub.AZIEL_LOADING.start("second");
assert.strictEqual(windowStub.AZIEL_LOADING.isActive(), true, "overlapping operations must activate the manager");
windowStub.AZIEL_LOADING.finish(first);
assert.strictEqual(windowStub.AZIEL_LOADING.isActive(), true, "one completion must not finish another operation");
windowStub.AZIEL_LOADING.finish(second);
assert.strictEqual(windowStub.AZIEL_LOADING.isActive(), false, "the last completion must settle the manager");
vm.runInNewContext(manager, { window: windowStub, document: documentStub, URL, Promise, setTimeout, clearTimeout, setInterval, clearInterval });
assert.strictEqual(nodes.length, 1, "manager initialization must remain idempotent");

for (const [file, label] of [
    ["frontend/js/catalog-runtime.js", "catalog-data"],
    ["frontend/js/product-detail.js", "product-catalog"],
    ["frontend/js/account.js", "account"],
    ["frontend/js/login.js", "login"],
    ["frontend/js/register.js", "registration"],
    ["frontend/js/verify-email.js", "email-verification"],
    ["frontend/js/forgot-password.js", "password-otp-request"],
    ["frontend/js/verify-otp.js", "password-otp-verification"],
    ["frontend/js/reset-password.js", "password-reset"]
]) {
    const source = read(file);
    assert.match(source, new RegExp(`AZIEL_LOADING\\?\\.start\\("${label}`), `${file} must start its operation`);
    assert.match(source, /AZIEL_LOADING\?\.finish\(loadingToken\)/, `${file} must finish its operation`);
}

for (const file of [
    "frontend/forgot-password.html",
    "frontend/verify-otp.html",
    "frontend/reset-password.html",
    "frontend/live-chat.html",
    "frontend/payments/dinger-success.html",
    "frontend/payments/dinger-fail.html"
]) {
    const html = read(file);
    assert.match(html, /loading-progress\.css\?v=20261025-native-ux-v2/);
    assert.match(html, /loading-manager\.js\?v=20261025-native-ux-v2/);
}

const htmlFiles = [];
function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) collect(absolute);
        else if (entry.name.endsWith(".html")) htmlFiles.push(absolute);
    }
}
collect(path.join(root, "frontend"));
for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(html, /user-scalable\s*=\s*no|max(?:imum)?-scale\s*=\s*1(?:[\s,"'])/i, `${file} blocks pinch zoom`);
    if (html.includes("header-loader.js")) {
        assert.match(html, /header-loader\.js\?v=20261027-pwa-phase2-v1/, `${file} must use the current immutable loader version`);
    }
}

console.log(`Native mobile UX verification passed (${htmlFiles.length} HTML files checked).`);
