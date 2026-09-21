"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function storage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key)
    };
}

function baseContext(overrides = {}) {
    const listeners = {};
    const document = {
        readyState: "loading",
        hidden: false,
        visibilityState: "visible",
        addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
        dispatchEvent() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() { return { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {}, addEventListener() {}, append() {}, remove() {}, setAttribute() {}, removeAttribute() {} }; },
        body: { appendChild() {} }
    };
    const location = { port: "", protocol: "https:", hostname: "azielplay.com", origin: "https://azielplay.com", pathname: "/", href: "https://azielplay.com/" };
    const window = { location, addEventListener() {}, dispatchEvent() {}, setTimeout, clearTimeout };
    const context = {
        assert, console, URL, URLSearchParams, Promise, Date, Math, JSON,
        setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
        requestAnimationFrame: callback => callback(),
        CustomEvent: function CustomEvent(type, options) { this.type = type; this.detail = options?.detail; },
        Event: function Event(type) { this.type = type; },
        Element: function Element() {},
        document, location, window,
        localStorage: storage(), sessionStorage: storage(), history: { replaceState() {} },
        ...overrides
    };
    context.window.window = context.window;
    context.window.document = document;
    context.window.localStorage = context.localStorage;
    context.window.sessionStorage = context.sessionStorage;
    Object.assign(context.window, overrides.window || {});
    context.globalThis = context;
    return { context: vm.createContext(context), listeners };
}

async function verifyWallet() {
    const { context, listeners } = baseContext();
    let identityLoads = 0; let walletApiLoads = 0;
    context.window.AZIEL = context.AZIEL = {
        user: null, wallet: null,
        async loadUser() { identityLoads += 1; this.user = { username: "cookie-user" }; return this.user; },
        async loadWallet() { this.wallet = { balance: 10 }; return this.wallet; }
    };
    vm.runInContext(read("frontend/js/wallet.js"), context, { filename: "wallet.js" });
    context.initQuickAmounts = () => {};
    context.loadWalletPaymentMethods = async () => { walletApiLoads += 1; };
    context.initWalletTopup = context.initWalletSocket = context.bindWalletEvents = context.bindPaymentMethodUI = context.renderWalletFromState = () => {};
    context.loadWallet = async () => { walletApiLoads += 1; };
    await listeners.DOMContentLoaded[0]();
    assert.strictEqual(identityLoads, 1);
    assert.strictEqual(context.location.href, "https://azielplay.com/");
    assert(walletApiLoads >= 2, "cookie-only wallet must load wallet APIs");
}

async function verifyGameFlow() {
    const { context } = baseContext();
    context.window.AZIEL = { user: { username: "cookie-user" }, getShopRegion: () => "TH", getShopCurrency: () => "THB" };
    context.window.selectedPackage = { productCode: "mlbb", packageCode: "PKG", name: "Pack", price: 100, region: "TH", currency: "THB" };
    context.window.AZIEL_PURCHASE_TRANSITION = { acquire: () => ({ release() {} }) };
    let couponRequests = 0;
    context.fetch = async url => { if (String(url).includes("/api/coupons/mine")) couponRequests += 1; return { json: async () => ({ success: true, coupons: [] }) }; };
    const source = read("frontend/js/game-flow.js").replace("window.AZIEL_GAME_FLOW = {", "window.AZIEL_GAME_FLOW = { submitOrder, loadOwnedCoupons,");
    vm.runInContext(source, context, { filename: "game-flow.js" });
    const flow = { config: { paymentSelectionStage: "checkout", checkoutUrl: "/checkout", productCode: "mlbb", gameKey: "mlbb", game: "MLBB", accountFields: [], userIdSelector: "", zoneIdSelector: "" }, promo: {} };
    await context.window.AZIEL_GAME_FLOW.submitOrder(flow);
    assert.strictEqual(context.location.href, "/checkout");
    assert(context.sessionStorage.getItem("azielProductCheckoutDraft"), "checkout draft must be staged");

    const select = { value: "", replaceChildren() {}, appendChild() {} };
    context.document.getElementById = id => id === "userCouponSelect" ? select : null;
    await context.window.AZIEL_GAME_FLOW.loadOwnedCoupons(flow);
    assert.strictEqual(couponRequests, 1, "cookie-only coupon loading must reach the API");
}

async function verifyLiveChat() {
    const { context } = baseContext();
    context.window.AZIEL = { user: { username: "cookie-user" }, realtime: { on() {} } };
    vm.runInContext(read("frontend/js/live-chat.js"), context, { filename: "live-chat.js" });
    const messages = []; let historyLoads = 0;
    context.addChatMessage = (kind, message) => messages.push(message);
    context.loadLiveChatHistory = async () => { historyLoads += 1; };
    context.loadUnreadCount = async () => {};
    context.initLiveChatRealtimeAssist = () => {};
    vm.runInContext("AZIEL_CHAT.authorityEnabled = true", context);
    await context.initLiveChatSystem();
    assert.strictEqual(historyLoads, 1);
    assert(!messages.some(message => /login/i.test(message)), "cookie-only chat must not show login required");
}

async function verifyAccount() {
    const { context } = baseContext();
    const requests = [];
    context.window.AZIEL = {
        user: { username: "cookie-user" },
        async authFetch(url) {
            requests.push(url);
            if (url.includes("overview")) return { status: 200, json: async () => ({ success: true, overview: {} }) };
            if (url.includes("sessions")) return { status: 200, json: async () => ({ success: true, sessions: [] }) };
            return { status: 200, json: async () => ({ success: true, events: [] }) };
        }
    };
    vm.runInContext(read("frontend/js/account.js"), context, { filename: "account.js" });
    let refreshes = 0;
    context.loadBellOrders = async () => { refreshes += 1; };
    await context.refreshAccountData();
    await context.loadSecurityData();
    assert.strictEqual(refreshes, 1);
    assert.deepStrictEqual(requests, ["/api/security/overview", "/api/security/sessions", "/api/security/events?limit=20"]);
}

async function verifyServerRejectionWinsOverCache() {
    const { context } = baseContext({ localStorage: storage({ user: JSON.stringify({ username: "cached-attacker" }), azielUser: JSON.stringify({ username: "cached-attacker" }) }) });
    context.AZIEL = context.window.AZIEL = {};
    context.fetch = async () => ({ status: 401, json: async () => ({ success: false, forceLogout: true }) });
    context.window.fetch = context.fetch;
    vm.runInContext(read("frontend/js/user-state.js"), context, { filename: "user-state.js" });
    const user = await context.window.AZIEL.loadUser();
    assert.strictEqual(user, null);
    assert.strictEqual(context.window.AZIEL.user, null);
    assert.strictEqual(context.location.href, "https://azielplay.com/", "passive identity rejection must remain on the public page");
    assert.strictEqual(context.localStorage.getItem("user"), null, "server rejection must clear cached identity");
    assert.strictEqual(context.localStorage.getItem("azielUser"), null, "server rejection must clear alternate cached identity");
}

async function verifyAuthenticatedIdentityProbe() {
    const { context } = baseContext();
    const authenticatedUser = { username: "cookie-user", displayName: "Cookie User", role: "user" };
    context.AZIEL = context.window.AZIEL = {};
    context.fetch = async url => {
        assert.strictEqual(String(url), "/api/auth/me");
        return { status: 200, json: async () => ({ success: true, user: authenticatedUser }) };
    };
    context.window.fetch = context.fetch;
    vm.runInContext(read("frontend/js/user-state.js"), context, { filename: "user-state.js" });
    const user = await context.window.AZIEL.loadUser();
    assert.strictEqual(user.username, "cookie-user");
    assert.strictEqual(context.window.AZIEL.user.username, "cookie-user");
    assert.strictEqual(context.window.AZIEL.identityResolved, true);
    assert.strictEqual(context.location.href, "https://azielplay.com/");
}

async function verifyPublicBootstrapRemainsGuestSafe() {
    const { context, listeners } = baseContext();
    let identityRequests = 0;
    context.AZIEL = context.window.AZIEL = {};
    context.fetch = async url => {
        if (String(url) === "/api/auth/me") identityRequests += 1;
        return { status: 401, json: async () => ({ success: false, forceLogout: true, message: "Authentication required" }) };
    };
    context.window.fetch = context.fetch;
    vm.runInContext(read("frontend/js/user-state.js"), context, { filename: "user-state.js" });
    await listeners.DOMContentLoaded[0]();
    assert.strictEqual(identityRequests, 1, "guest bootstrap must not repeat the identity probe from loadWallet");
    assert.strictEqual(context.window.AZIEL.user, null);
    assert.strictEqual(context.location.href, "https://azielplay.com/", "public bootstrap must not navigate to login");
}

async function verifyProtectedAuthFailureStillRedirects() {
    const { context } = baseContext({ localStorage: storage({ user: JSON.stringify({ username: "expired-user" }) }) });
    context.AZIEL = context.window.AZIEL = {};
    context.fetch = async () => ({
        status: 401,
        clone() { return this; },
        json: async () => ({ success: false, message: "Session expired" })
    });
    context.window.fetch = context.fetch;
    vm.runInContext(read("frontend/js/user-state.js"), context, { filename: "user-state.js" });
    await context.window.AZIEL.authFetch("/api/security/overview");
    assert.strictEqual(context.window.AZIEL.user, null);
    assert.strictEqual(context.localStorage.getItem("user"), null);
    assert.strictEqual(context.location.href, "/login", "protected authFetch rejection must retain login handling");
}

async function verifyProtectedPageGuard() {
    const { context, listeners } = baseContext();
    context.location.pathname = "/account";
    context.location.href = "https://azielplay.com/account";
    context.window.AZIEL = context.AZIEL = { user: null, async loadUser() { return null; } };
    vm.runInContext(read("frontend/js/auth-check.js"), context, { filename: "auth-check.js" });
    await listeners.DOMContentLoaded[0]();
    assert.strictEqual(context.location.href, "/login");
    assert.strictEqual(context.localStorage.getItem("redirectAfterLogin"), "https://azielplay.com/account");
}

function verifyRedirectSafety() {
    const { context } = baseContext();
    vm.runInContext(read("frontend/js/login.js"), context, { filename: "login.js" });
    const resolve = context.resolveRedirectAfterLogin;
    assert.strictEqual(resolve("/wallet"), "/wallet");
    assert.strictEqual(resolve("https://azielplay.com/account?tab=security#sessions"), "/account?tab=security#sessions");
    assert.strictEqual(resolve("https://evil.example/phish"), "/");
    assert.strictEqual(resolve("http://["), "/");
    assert.strictEqual(resolve(""), "/");
}

(async () => {
    await verifyWallet();
    await verifyGameFlow();
    await verifyLiveChat();
    await verifyAccount();
    await verifyServerRejectionWinsOverCache();
    await verifyAuthenticatedIdentityProbe();
    await verifyPublicBootstrapRemainsGuestSafe();
    await verifyProtectedAuthFailureStillRedirects();
    await verifyProtectedPageGuard();
    verifyRedirectSafety();
    console.log("Cookie-only frontend authentication flows passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
