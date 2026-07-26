const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(rootDir, file), "utf8");
}

class ClassList {
    constructor(owner) {
        this.owner = owner;
        this.values = new Set();
    }
    add(...tokens) {
        tokens.filter(Boolean).forEach(token => this.values.add(token));
        this.owner.attributes.class = [...this.values].join(" ");
    }
    remove(...tokens) {
        tokens.forEach(token => this.values.delete(token));
        this.owner.attributes.class = [...this.values].join(" ");
    }
    contains(token) {
        return this.values.has(token);
    }
    toggle(token, force) {
        const shouldAdd = force === undefined ? !this.values.has(token) : Boolean(force);
        if (shouldAdd) this.add(token);
        else this.remove(token);
        return shouldAdd;
    }
}

class Element {
    constructor(tagName, attrs = {}, text = "") {
        this.tagName = String(tagName).toUpperCase();
        this.attributes = {};
        this.dataset = {};
        this.children = [];
        this.parentNode = null;
        this.listeners = {};
        this.hidden = false;
        this.disabled = false;
        this.title = "";
        this._textContent = text;
        this._innerHTML = "";
        this.classList = new ClassList(this);
        Object.entries(attrs).forEach(([key, value]) => this.setAttribute(key, value));
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === "id") this.id = String(value);
        if (name === "class") String(value).split(/\s+/).filter(Boolean).forEach(token => this.classList.add(token));
        if (name.startsWith("data-")) {
            const dataKey = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
            this.dataset[dataKey] = String(value);
        }
    }

    getAttribute(name) {
        return this.attributes[name] || null;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    addEventListener(type, handler) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(handler);
    }

    dispatchEvent(event) {
        event.currentTarget = this;
        (this.listeners[event.type] || []).forEach(handler => handler(event));
        return true;
    }

    contains(node) {
        for (let current = node; current; current = current.parentNode) {
            if (current === this) return true;
        }
        return false;
    }

    matches(selector) {
        if (selector.startsWith("#")) return this.id === selector.slice(1);
        if (selector.startsWith("[")) {
            const attr = selector.slice(1, -1);
            return this.getAttribute(attr) !== null;
        }
        return this.tagName.toLowerCase() === selector.toLowerCase();
    }

    closest(selector) {
        for (let current = this; current; current = current.parentNode) {
            if (current.matches(selector)) return current;
        }
        return null;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        if (selector.includes(" ")) {
            const [ancestorSelector, childSelector] = selector.split(/\s+/, 2);
            return this.querySelectorAll(ancestorSelector).flatMap(node => node.querySelectorAll(childSelector));
        }
        const results = [];
        const visit = node => {
            node.children.forEach(child => {
                if (child.matches(selector)) results.push(child);
                visit(child);
            });
        };
        visit(this);
        return results;
    }

    set textContent(value) {
        this._textContent = String(value);
        this.children = [];
    }

    get textContent() {
        return this.children.length ? this.children.map(child => child.textContent).join("") : this._textContent;
    }

    set innerHTML(value) {
        this._innerHTML = String(value);
        this.children = [];
        parsePricingRows(this._innerHTML).forEach(row => this.appendChild(row));
    }

    get innerHTML() {
        return this._innerHTML;
    }
}

class Document extends Element {
    constructor() {
        super("document");
    }
    getElementById(id) {
        return this.querySelector(`#${id}`);
    }
    createElement(tagName) {
        return new Element(tagName);
    }
}

function parseAttributes(raw) {
    const attrs = {};
    raw.replace(/([a-zA-Z0-9:-]+)="([^"]*)"/g, (_, key, value) => {
        attrs[key] = value;
        return "";
    });
    return attrs;
}

function parsePricingRows(html) {
    const rows = [];
    const rowRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
    let match;
    while ((match = rowRegex.exec(html))) {
        const row = new Element("button", parseAttributes(match[1]));
        const body = match[2];
        const strong = /<strong>([\s\S]*?)<\/strong>/.exec(body);
        const small = /<small>([\s\S]*?)<\/small>/.exec(body);
        const span = row.appendChild(new Element("span"));
        span.appendChild(new Element("strong", {}, strong ? stripTags(strong[1]) : ""));
        span.appendChild(new Element("small", {}, small ? stripTags(small[1]) : ""));
        rows.push(row);
    }
    return rows;
}

function stripTags(value) {
    return String(value || "").replace(/<[^>]*>/g, "").trim();
}

function createNode(id, tag = "div") {
    return new Element(tag, { id });
}

function buildDocument() {
    const document = new Document();
    const section = document.appendChild(new Element("section", { id: "section-pricing-engine" }));
    section.appendChild(createNode("pricingProductSearch", "input"));
    const list = section.appendChild(createNode("pricingProductList"));
    [
        ["mlbb", "mlbb", "Mobile Legends", "7740 + 1548 Diamonds", "MLBB_7740", "TH", "THB", "THB", "1120", "1", true],
        ["pubg", "pubg", "PUBG Mobile", "8100 UC", "PUBG_8100_UC", "MM", "MMK", "THB", "870", "118", false],
        ["free-fire", "free-fire", "Free Fire", "Weekly Membership", "FF_WEEKLY", "MM", "MMK", "MMK", "18500", "1", false]
    ].forEach(([id, code, name, pkg, pkgId, region, currency, supplierCurrency, supplierPrice, exchangeRate, active]) => {
        const row = new Element("button", {
            class: `catalog-product-row pricing-product-row${active ? " active" : ""}`,
            "data-pricing-product-id": id,
            "data-pricing-product-code": code,
            "data-pricing-product": name,
            "data-pricing-package": pkg,
            "data-pricing-package-id": pkgId,
            "data-pricing-region": region,
            "data-pricing-currency": currency,
            "data-pricing-supplier-currency": supplierCurrency,
            "data-pricing-supplier-price": supplierPrice,
            "data-pricing-exchange-rate": exchangeRate
        });
        const span = row.appendChild(new Element("span"));
        span.appendChild(new Element("strong", {}, name));
        span.appendChild(new Element("small", {}, pkg));
        list.appendChild(row);
    });

    [
        "pricingRulesSubtitle", "pricingPreviewProduct", "pricingStorefrontProduct", "pricingStorefrontPackage",
        "pricingRuleExchangeValue", "pricingRuleSupplierFeeValue", "pricingRuleGatewayValue", "pricingRulePlatformValue",
        "pricingRuleProfitValue", "pricingRuleRoundValue", "pricingSummaryExchange", "pricingSummaryProfit",
        "pricingSummaryGateway", "pricingSummaryPackages", "pricingSummaryPackagesMeta", "pricingSimulationError",
        "pricingFlow", "pricingBreakdown", "pricingStorefrontPrice", "pricingProductionStatus",
        "pricingSummaryExchangeMeta", "pricingSummaryProfitMeta", "pricingSummaryGatewayMeta"
    ].forEach(id => section.appendChild(createNode(id)));

    ["exchangeRate", "gatewayFee", "platformFee", "profit", "rounding"].forEach(field => {
        section.appendChild(new Element("button", { "data-pricing-edit": field }));
    });
    section.appendChild(new Element("button", { id: "pricingSaveDraftBtn" }, "Save Draft"));
    section.appendChild(new Element("button", { id: "pricingPublishBtn" }, "Publish"));
    return { document, section };
}

function createEvent(type, target) {
    return {
        type,
        target,
        currentTarget: null,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; }
    };
}

function serverState() {
    return {
        success: true,
        version: { versionNumber: 7, publishedAt: "2026-07-26T00:00:00.000Z", publishedBy: "owner" },
        affected: { packagesAffected: 3, productsAffected: 3, currenciesAffected: ["THB", "MMK"] },
        products: [
            { productId: "mlbb", productCode: "mlbb", productName: "Mobile Legends", packages: [{ packageId: "MLBB_7740", packageCode: "MLBB_7740", packageName: "7740 + 1548 Diamonds", productCode: "mlbb", productName: "Mobile Legends", region: "TH", currency: "THB", supplierCurrency: "THB", supplierPrice: 1120, exchangeRate: 1 }] },
            { productId: "pubg", productCode: "pubg", productName: "PUBG Mobile", packages: [{ packageId: "PUBG_8100_UC", packageCode: "PUBG_8100_UC", packageName: "8100 UC", productCode: "pubg", productName: "PUBG Mobile", region: "MM", currency: "MMK", supplierCurrency: "THB", supplierPrice: 870, exchangeRate: 118 }] },
            { productId: "free-fire", productCode: "free-fire", productName: "Free Fire", packages: [{ packageId: "FF_WEEKLY", packageCode: "FF_WEEKLY", packageName: "Weekly Membership", productCode: "free-fire", productName: "Free Fire", region: "MM", currency: "MMK", supplierCurrency: "MMK", supplierPrice: 18500, exchangeRate: 1 }] }
        ],
        policies: [
            { region: "TH", currency: "THB", active: { config: { profitRule: { type: "PERCENT", value: 10 } } }, draft: { config: { profitRule: { type: "PERCENT", value: 12 } } } },
            { region: "MM", currency: "MMK", active: { config: { profitRule: { type: "PERCENT", value: 8 }, exchangeRate: 118 } }, draft: { config: { profitRule: { type: "PERCENT", value: 9 }, exchangeRate: 118 } } }
        ]
    };
}

function jsonResponse(body) {
    return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => body,
        text: async () => JSON.stringify(body)
    };
}

function createHarness(fetchImpl) {
    const { document, section } = buildDocument();
    const listeners = {};
    const context = {
        console,
        document,
        window: null,
        localStorage: {
            data: { adminToken: "token", adminRole: "OWNER" },
            getItem(key) { return this.data[key] || null; },
            setItem(key, value) { this.data[key] = String(value); }
        },
        fetch: fetchImpl,
        setTimeout,
        clearTimeout,
        URLSearchParams,
        AbortController
    };
    context.window = {
        document,
        location: { search: "" },
        localStorage: context.localStorage,
        fetch: fetchImpl,
        setTimeout,
        clearTimeout,
        addEventListener(type, handler) { listeners[type] = listeners[type] || []; listeners[type].push(handler); },
        removeEventListener(type, handler) { listeners[type] = (listeners[type] || []).filter(item => item !== handler); },
        dispatchEvent(event) { (listeners[event.type] || []).forEach(handler => handler(event)); },
        prompt: () => null,
        alert: message => { throw new Error(`Unexpected alert: ${message}`); },
        confirm: () => true,
        AZIEL_ADMIN_AUTH: {
            state: { loaded: true, admin: { role: "OWNER" } },
            hasPermission: permission => permission === "CATALOG_MANAGE"
        }
    };
    context.window.window = context.window;
    vm.createContext(context);
    vm.runInContext(read("frontend/js/commerce/pricingCalculationEngine.js"), context, { filename: "pricingCalculationEngine.js" });
    vm.runInContext(read("frontend/js/admin-pricing-engine.js"), context, { filename: "admin-pricing-engine.js" });
    document.dispatchEvent(createEvent("DOMContentLoaded", document));
    return { context, document, section };
}

async function verifyFallbackInteractionBeforeApi() {
    let resolveFetch;
    const fetchCalls = [];
    const harness = createHarness((url, options = {}) => {
        fetchCalls.push({ url, options });
        return new Promise(resolve => { resolveFetch = resolve; });
    });
    await Promise.resolve();
    const { section, context } = harness;
    assert.strictEqual(section.listeners.click.length, 1, "Pricing Engine must have exactly one delegated section click handler.");
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE._state.productSource, "fallback", "Static DOM cards must hydrate fallback products before API resolves.");
    assert.ok(context.window.AZIEL_ADMIN_PRICING_ENGINE._state.preview, "Fallback products must produce a local preview before API resolves.");

    const pubgLabel = section.querySelector('[data-pricing-product-id]').parentNode
        .querySelectorAll("[data-pricing-product-id]")
        .find(row => row.dataset.pricingProductId === "pubg")
        .querySelector("strong");
    section.dispatchEvent(createEvent("click", pubgLabel));
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE._state.selectedProductId, "pubg", "Nested product card clicks must select the product synchronously.");

    context.window.prompt = () => "125";
    section.dispatchEvent(createEvent("click", section.querySelector('[data-pricing-edit]')));
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE._state.dirty, true, "Edit buttons must mutate local draft state.");

    section.dispatchEvent(createEvent("click", section.querySelectorAll("[data-pricing-product-id]").find(row => row.dataset.pricingProductId === "free-fire").querySelector("small")));
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE._state.selectedProductId, "free-fire", "Product selection must remain usable while initial API request is pending.");
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE.canPersistPricing(), false, "Persistence must remain disabled before trusted API state loads.");

    resolveFetch(jsonResponse(serverState()));
    await context.window.AZIEL_ADMIN_PRICING_ENGINE._state.loadPromise;
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE._state.apiReady, true, "API success must mark Pricing Engine state ready.");
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE._state.productSource, "server", "API success must replace fallback source with server data.");
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE._state.selectedProductId, "free-fire", "Server hydration must preserve a valid current selection.");
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE.canPersistPricing(), true, "Save/Publish must unlock only after trusted API state and preview exist.");
    assert.strictEqual(fetchCalls[0].url, "/api/admin/pricing-engine", "Initial load must hit the production Pricing Engine API.");
}

async function verifySavePublishAndFailureStates() {
    const calls = [];
    const harness = createHarness((url, options = {}) => {
        calls.push({ url, options });
        if (url.endsWith("/draft")) return Promise.resolve(jsonResponse({ success: true, state: serverState() }));
        if (url.endsWith("/publish")) return Promise.resolve(jsonResponse({ success: true, version: { versionNumber: 8 }, state: serverState() }));
        return Promise.resolve(jsonResponse(serverState()));
    });
    const { context } = harness;
    await context.window.AZIEL_ADMIN_PRICING_ENGINE._state.loadPromise;
    assert.strictEqual(await context.window.AZIEL_ADMIN_PRICING_ENGINE.saveDraft(), true, "Save Draft must resolve successfully.");
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE._state.saving, false, "Save Draft must clear saving state.");
    await context.window.AZIEL_ADMIN_PRICING_ENGINE.publishDraft();
    assert.strictEqual(context.window.AZIEL_ADMIN_PRICING_ENGINE._state.publishing, false, "Publish must clear publishing state.");
    assert.ok(calls.some(call => call.url === "/api/admin/pricing-engine/draft"), "Save Draft must call the backend draft endpoint.");
    assert.ok(calls.some(call => call.url === "/api/admin/pricing-engine/publish"), "Publish must call the backend publish endpoint.");

    const failing = createHarness(() => Promise.reject(new Error("network offline")));
    await Promise.resolve();
    await failing.context.window.AZIEL_ADMIN_PRICING_ENGINE._state.loadPromise;
    assert.strictEqual(failing.context.window.AZIEL_ADMIN_PRICING_ENGINE._state.apiReady, false, "API failure must leave apiReady false.");
    assert.strictEqual(failing.context.window.AZIEL_ADMIN_PRICING_ENGINE._state.productSource, "fallback", "API failure must keep DOM fallback products usable.");
    assert.ok(failing.context.window.AZIEL_ADMIN_PRICING_ENGINE._state.preview, "API failure must not destroy local preview.");
    assert.strictEqual(failing.context.window.AZIEL_ADMIN_PRICING_ENGINE.canPersistPricing(), false, "API failure must keep Save/Publish disabled.");
}

function verifyStaticMarkupContract() {
    const adminHtml = read("frontend/admin.html");
    const rows = [...adminHtml.matchAll(/<button\b[^>]*class="[^"]*pricing-product-row[^"]*"[^>]*>/g)].map(match => match[0]);
    assert.ok(rows.length >= 5, "Admin Pricing Engine must ship static fallback product rows.");
    rows.forEach(row => {
        assert.ok(row.includes("data-pricing-product-id="), "Every static Pricing Engine product row must expose data-pricing-product-id.");
        assert.ok(row.includes("data-pricing-package-id="), "Every static Pricing Engine product row must expose data-pricing-package-id.");
    });
}

async function main() {
    verifyStaticMarkupContract();
    await verifyFallbackInteractionBeforeApi();
    await verifySavePublishAndFailureStates();
    console.log("Admin Pricing Engine controller DOM interaction verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
