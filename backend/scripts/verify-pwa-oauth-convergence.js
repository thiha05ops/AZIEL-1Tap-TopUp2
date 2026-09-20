const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");
const pwaSource = fs.readFileSync(path.join(root, "frontend/js/pwa-fix.js"), "utf8");
const oauthRuntime = pwaSource.slice(pwaSource.indexOf("const AZIEL_OAUTH_WORKER_CAPABILITY"));

class EventTargetStub {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(handler);
    }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    dispatch(type) { this.listeners.get(type)?.forEach(handler => handler()); }
}

function capableWorker(capability = 1) {
    return {
        postMessage(message, ports) {
            if (message.type !== "CHECK_WORKER_CAPABILITY") return;
            ports[0].postMessage({
                type: "WORKER_CAPABILITY_STATUS",
                workerRevision: capability ? "oauth-navigation-bypass-v1" : "legacy",
                capabilities: { oauthNavigationBypass: capability }
            });
        }
    };
}

function makeRuntime({ controller = null, update } = {}) {
    const serviceWorker = new EventTargetStub();
    serviceWorker.controller = controller;
    const controls = [{ disabled: false, attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); } }];
    const document = new EventTargetStub();
    document.querySelectorAll = () => controls;
    document.getElementById = () => null;
    const navigations = [];
    const registration = { update: update || (() => Promise.resolve()) };
    const window = {
        isSecureContext: true,
        location: { assign(url) { navigations.push(url); } },
        __AZIEL_SW_REGISTRATION_PROMISE__: Promise.resolve(registration)
    };

    class MessageChannelStub {
        constructor() {
            this.port1 = { onmessage: null, close() {} };
            this.port2 = { postMessage: data => queueMicrotask(() => this.port1.onmessage?.({ data })) };
        }
    }

    const context = {
        window,
        document,
        navigator: { serviceWorker },
        location: { hostname: "aziel.test" },
        MessageChannel: MessageChannelStub,
        CustomEvent: class CustomEvent {},
        Promise,
        Object,
        Number,
        setTimeout,
        clearTimeout,
        queueMicrotask,
        console,
        sessionStorage: { getItem: () => null, setItem() {} }
    };
    vm.runInNewContext(oauthRuntime, context, { filename: "pwa-oauth-runtime.js" });
    context.initAzielOAuthReadiness();
    return { context, serviceWorker, registration, controls, navigations, start: () => window.AZIEL_PWA_OAUTH.startGoogleOAuth() };
}

(async () => {
    const noController = makeRuntime();
    assert.strictEqual(await noController.start(), true);
    assert.deepStrictEqual(noController.navigations, ["/api/auth/google"]);

    const current = makeRuntime({ controller: capableWorker(1) });
    assert.strictEqual(await current.start(), true);
    assert.deepStrictEqual(current.navigations, ["/api/auth/google"]);

    let releaseUpdate;
    const oldThenCurrent = makeRuntime({
        controller: capableWorker(0),
        update: () => new Promise(resolve => { releaseUpdate = resolve; })
    });
    const firstClick = oldThenCurrent.start();
    const secondClick = oldThenCurrent.start();
    assert.strictEqual(firstClick, secondClick, "double click must share one pending OAuth action");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual(oldThenCurrent.navigations, [], "old controller must not start OAuth");
    oldThenCurrent.serviceWorker.controller = capableWorker(1);
    oldThenCurrent.serviceWorker.dispatch("controllerchange");
    releaseUpdate();
    assert.strictEqual(await firstClick, true);
    assert.deepStrictEqual(oldThenCurrent.navigations, ["/api/auth/google"], "original OAuth action must resume exactly once");

    let failedUpdates = 0;
    const failed = makeRuntime({
        controller: capableWorker(0),
        update: () => { failedUpdates += 1; return Promise.reject(new Error("offline")); }
    });
    assert.strictEqual(await failed.start(), false);
    assert.deepStrictEqual(failed.navigations, [], "failed convergence must not navigate through the old worker");
    assert.strictEqual(failed.controls[0].disabled, false, "failed convergence must restore a retryable control");
    assert.strictEqual(await failed.start(), false);
    assert.strictEqual(failedUpdates, 2, "a failed action must be retryable");

    const loginHtml = fs.readFileSync(path.join(root, "frontend/login.html"), "utf8");
    const registerHtml = fs.readFileSync(path.join(root, "frontend/register.html"), "utf8");
    const loginJs = fs.readFileSync(path.join(root, "frontend/js/login.js"), "utf8");
    [loginHtml, registerHtml].forEach(source => {
        assert(source.includes("data-aziel-google-oauth"));
        assert(!source.includes('href="/api/auth/google"'), "static OAuth controls must be inert before the gate loads");
    });
    assert(!loginJs.includes('window.location.href = apiUrl("/api/auth/google")'));
    assert(!/controllerchange[\s\S]{0,500}(?:location\.reload|location\.replace)/.test(pwaSource));

    console.log("PWA OAuth convergence verification passed.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
