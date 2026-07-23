const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

function loadAndroidHelper() {
    const sandbox = {
        window: {
            navigator: {
                userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
                platform: "Linux armv8l",
                maxTouchPoints: 5
            }
        },
        URL
    };
    vm.createContext(sandbox);
    vm.runInContext(read("frontend/js/payment/android-app-launch.js"), sandbox);
    return sandbox.window.AZIEL_ANDROID_APP_LAUNCH;
}

function createDomSandbox() {
    const elementsById = new Map();

    class FakeClassList {
        constructor() {
            this.values = new Set();
        }
        add(value) {
            this.values.add(value);
        }
        remove(value) {
            this.values.delete(value);
        }
        contains(value) {
            return this.values.has(value);
        }
        toggle(value, force) {
            const next = force === undefined ? !this.values.has(value) : Boolean(force);
            if (next) this.values.add(value);
            else this.values.delete(value);
            return next;
        }
    }

    class FakeElement {
        constructor(tagName = "div", ownerDocument = null) {
            this.tagName = tagName.toUpperCase();
            this.ownerDocument = ownerDocument;
            this.children = [];
            this.attributes = new Map();
            this.classList = new FakeClassList();
            this.dataset = {};
            this.hidden = false;
            this.disabled = false;
            this.textContent = "";
            this.value = "";
            this.onclick = null;
            this.files = [];
            this.src = "";
        }
        set id(value) {
            this._id = value;
            if (value) elementsById.set(value, this);
        }
        get id() {
            return this._id || "";
        }
        set className(value) {
            this._className = value;
            String(value || "").split(/\s+/).filter(Boolean).forEach(item => this.classList.add(item));
        }
        get className() {
            return this._className || "";
        }
        set innerHTML(value) {
            this._innerHTML = String(value || "");
            const idRegex = /<([a-z0-9-]+)([^>]*?)\sid="([^"]+)"/gi;
            let match;
            while ((match = idRegex.exec(this._innerHTML))) {
                const child = new FakeElement(match[1], this.ownerDocument);
                child.id = match[3];
                this.children.push(child);
            }
        }
        get innerHTML() {
            return this._innerHTML || "";
        }
        appendChild(child) {
            this.children.push(child);
            return child;
        }
        addEventListener() {}
        removeEventListener() {}
        focus() {
            this.focused = true;
        }
        setAttribute(name, value) {
            this.attributes.set(name, String(value));
            if (name === "id") this.id = value;
        }
        getAttribute(name) {
            return this.attributes.get(name) || "";
        }
        removeAttribute(name) {
            this.attributes.delete(name);
            if (name === "src") this.src = "";
        }
        querySelector(selector) {
            if (selector.startsWith("#")) return elementsById.get(selector.slice(1)) || null;
            return null;
        }
        querySelectorAll() {
            return [];
        }
    }

    const document = {
        body: new FakeElement("body"),
        createElement(tagName) {
            return new FakeElement(tagName, document);
        },
        getElementById(id) {
            return elementsById.get(id) || null;
        },
        addEventListener() {},
        removeEventListener() {},
        querySelector(selector) {
            if (selector.startsWith("#")) return elementsById.get(selector.slice(1)) || null;
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };
    document.body.ownerDocument = document;

    const storage = {
        store: new Map(),
        getItem(key) {
            return this.store.has(key) ? this.store.get(key) : null;
        },
        setItem(key, value) {
            this.store.set(key, String(value));
        },
        removeItem(key) {
            this.store.delete(key);
        }
    };

    const window = {
        document,
        navigator: {
            userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
            platform: "Linux armv8l",
            maxTouchPoints: 5
        },
        location: {
            hostname: "localhost",
            href: "http://localhost/checkout"
        },
        sessionStorage: storage,
        addEventListener() {},
        removeEventListener() {},
        setTimeout() {},
        AZIEL_PAYMENT_DISPLAY: {
            from(value, fallback) {
                return fallback || value;
            }
        }
    };

    return {
        window,
        document,
        sessionStorage: storage,
        URL,
        console,
        setTimeout() {}
    };
}

function verifyCheckoutDomRendersAndroidPackageOpenButton() {
    const sandbox = createDomSandbox();
    vm.createContext(sandbox);
    vm.runInContext(read("frontend/js/payment/android-app-launch.js"), sandbox);
    vm.runInContext(read("frontend/js/payment/payment-checkout-sheet.js"), sandbox);

    sandbox.window.PaymentCheckoutSheet.show({
        methodCode: "bangkok_bank",
        methodName: "Bangkok Bank",
        amount: 1490,
        currency: "THB",
        reference: "AZL-TEST-001",
        qrMode: "uploaded_static",
        requiresSlip: false,
        enableSaveQr: false,
        enableChecklist: false,
        enableOpenApp: true,
        openAppMode: "direct",
        appLaunchMode: "APP_ONLY",
        appDisplayName: "Bangkok Bank Mobile",
        androidAppLaunchUrl: "",
        androidPackageName: "com.bbl.mobilebanking",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.bbl.mobilebanking"
    });

    const button = sandbox.document.getElementById("azPaymentSheetOpenBankApp");
    assert(button, "Open App button must exist in checkout DOM.");
    assert.strictEqual(button.hidden, false, "Open App button must render for Android package + Play fallback with blank Android launch URL.");
    assert.strictEqual(button.textContent, "Open Bangkok Bank Mobile", "Generated intent path should be presented as Open App on Android.");
    assert.strictEqual(typeof button.onclick, "function", "Open App button must be clickable.");
    button.onclick();
    assert(
        sandbox.window.location.href.startsWith("intent://open#Intent;package=com.bbl.mobilebanking;"),
        "Open App click must use generated Android intent from data."
    );
    assert(
        sandbox.window.location.href.includes("S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.bbl.mobilebanking"),
        "Generated intent must include encoded Play Store fallback."
    );
}

function main() {
    const helper = loadAndroidHelper();
    assert(helper, "Android launch helper must register globally.");

    assert.strictEqual(helper.isAndroidPackageName("com.kasikorn.retail.mbanking.wap"), true, "K PLUS package must validate.");
    assert.strictEqual(helper.isAndroidPackageName("com.bbl.mobilebanking"), true, "Bangkok Bank package must validate.");
    assert.strictEqual(helper.isAndroidPackageName("ktbcs.netbank"), true, "Krungthai package must validate.");
    assert.strictEqual(helper.isAndroidPackageName("kplus://"), false, "URL schemes must not validate as package names.");
    assert.strictEqual(helper.isAndroidPackageName("bad package"), false, "Malformed package names must be rejected.");
    assert.strictEqual(helper.isHttpsUrl("https://play.google.com/store/apps/details?id=com.bbl.mobilebanking"), true, "Play Store HTTPS fallback must validate.");
    assert.strictEqual(helper.isHttpsUrl("javascript:alert(1)"), false, "Unsafe fallback URLs must be rejected.");
    assert.strictEqual(helper.hasAndroidLaunchCapability({
        androidPackageName: "com.bbl.mobilebanking",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.bbl.mobilebanking"
    }), true, "Android package plus Play Store fallback must create launch capability with blank explicit launch URL.");
    assert.strictEqual(helper.hasAndroidLaunchCapability({
        androidAppLaunchUrl: "ktbnext://"
    }), true, "Explicit Android launch URL must create launch capability without a package.");
    assert.strictEqual(helper.hasAndroidLaunchCapability({
        androidPackageName: "bad package",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.bbl.mobilebanking"
    }), false, "Invalid package must not create Android launch capability.");
    assert.strictEqual(helper.hasAndroidLaunchCapability({}), false, "Missing package and explicit URL must not create Android launch capability.");

    const intent = helper.buildAndroidIntentUrl({
        androidPackageName: "com.bbl.mobilebanking",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.bbl.mobilebanking"
    });
    assert(intent.startsWith("intent://open#Intent;"), "Package-only Android intent should use Chrome intent URI format.");
    assert(intent.includes("package=com.bbl.mobilebanking"), "Intent must include package name.");
    assert(intent.includes("S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.bbl.mobilebanking"), "Fallback URL must be URL-encoded.");
    assert(intent.endsWith(";end"), "Intent must terminate with ;end.");

    const schemeIntent = helper.buildAndroidIntentUrl({
        androidPackageName: "ktbcs.netbank",
        androidAppLaunchUrl: "ktbnext://",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=ktbcs.netbank"
    });
    assert(schemeIntent.includes("scheme=ktbnext"), "Scheme-backed intent must preserve verified Krungthai scheme.");
    assert(schemeIntent.includes("package=ktbcs.netbank"), "Scheme-backed intent must include package.");
    verifyCheckoutDomRendersAndroidPackageOpenButton();

    includes("backend/models/PaymentMethod.js", "androidPackageName", "PaymentMethod must store Android package identity.");
    includes("backend/models/ManualPaymentAttempt.js", "androidPackageName", "Manual attempt instructions must snapshot Android package identity.");
    includes("backend/routes/paymentMethods.js", "safeAndroidPackageName", "Admin writes must validate Android package names.");
    includes("backend/routes/paymentMethods.js", "com.kasikorn.retail.mbanking.wap", "K PLUS package default missing.");
    includes("backend/routes/paymentMethods.js", "com.bbl.mobilebanking", "Bangkok Bank package default missing.");
    includes("backend/routes/paymentMethods.js", "com.krungsri.kma", "Krungsri package default missing.");
    includes("backend/routes/paymentMethods.js", "ktbcs.netbank", "Krungthai package default missing.");
    includes("backend/routes/paymentMethods.js", "Android app opening requires a Play Store fallback URL.", "Android direct mode must require Play Store fallback when Android config is present.");
    includes("backend/services/paymentProviderRegistry.js", "hasAndroidLaunchCapability", "Readiness must use the Android launch capability rule.");
    includes("backend/services/paymentProviderRegistry.js", "Play Store fallback URL", "Readiness must report missing Play Store fallback.");

    includes("frontend/js/admin-payments.js", "pm-android-package-name", "Admin editor must expose Android package field.");
    includes("frontend/js/admin-payments.js", "pm-android-intent-preview", "Admin editor must expose generated intent preview.");
    includes("frontend/js/admin-payments.js", "hasAdminAndroidLaunchCapability", "Admin live preview must use shared Android capability rule.");
    includes("frontend/js/payment.js", "androidPackageName", "Public payment selection must preserve Android package identity.");
    includes("frontend/js/region-payment.js", "androidPackageName", "Region payment selection must preserve Android package identity.");
    includes("frontend/js/payment/payment-manual.js", "androidPackageName", "Manual checkout session must preserve Android package identity.");
    includes("frontend/js/payment/payment-deeplink.js", "androidPackageName", "Deeplink checkout session must preserve Android package identity.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "AZIEL_ANDROID_APP_LAUNCH", "Checkout must use the shared Android launch helper.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "hasAndroidLaunchCapability(options)", "Checkout Open App visibility must use Android package capability.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "androidExplicitUrl || androidIntentUrl", "Explicit Android launch URL must take precedence over generated intent.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "android_intent", "Checkout must classify Android intent launch source.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "data-mobile-bank-key", "mobile bank rows must bind by stable launcher key.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "profile.appLaunchMode || \"APP_ONLY\"", "bank launchers must default to app-only mode so iOS URLs are not ignored.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "const launcherByKey = new Map();", "mobile bank chooser must resolve launchers from an in-memory map.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "attachMobileChooserTapDiagnostics", "mobile chooser must include temporary dev-only hit-test diagnostics.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "elementFromPoint", "mobile chooser diagnostics must identify hit-test blockers.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "event.preventDefault();", "mobile bank row click must preserve a controlled gesture handler.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "event.stopPropagation();", "mobile bank row click must not bubble into chooser/backdrop handlers.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "launchBankProfileFromGesture", "mobile bank row must use a gesture-safe launch path.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "window.location.href = iosUrl;", "iOS custom-scheme navigation must be synchronous in the row click path.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "setTimeout(() => {\n                updateChecklist(\"open_app\");", "iOS post-launch bookkeeping must be deferred until after scheme navigation.");
    includes("frontend/js/payment-trust-display.js", "appLaunchMode: item.appLaunchMode || \"APP_ONLY\"", "shared launcher normalization must preserve app-only bank-launch semantics.");
    includes("frontend/css/payment/payment-checkout-sheet.css", "position: fixed;", "mobile chooser layer must be fixed above the payment sheet.");
    includes("frontend/css/payment/payment-checkout-sheet.css", ".az-payment-sheet__mobile-chooser-backdrop", "mobile chooser must use a separate backdrop behind the panel.");
    includes("frontend/css/payment/payment-checkout-sheet.css", "z-index: 2;", "mobile chooser panel must sit above backdrop.");
    includes("frontend/css/payment/payment-checkout-sheet.css", "touch-action: manipulation;", "mobile bank rows must use direct tap handling.");
    includes("frontend/css/payment/payment-checkout-sheet.css", "pointer-events: none;", "mobile bank row children must not absorb taps.");
    assert(!read("frontend/js/payment/payment-checkout-sheet.js").includes("pm-android-intent-preview"), "Checkout must not read Admin generated intent preview DOM text.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "Open / Install", "Store-only iOS behavior must not claim direct open.");
    includes("frontend/js/payment/payment-checkout-sheet.js", ': "";', "Desktop launch resolution must not pretend to be Android.");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", "paymentStatus", "Open app checkout logic must not mutate payment status.");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", "markWalletTopupPaid", "Open app checkout logic must not mark wallet top-ups paid.");
    notIncludes("frontend/js/payment/android-app-launch.js", "kplus://", "Shared Android helper must not invent bank schemes.");
    notIncludes("frontend/js/payment/android-app-launch.js", "bangkokbank://", "Shared Android helper must not invent Bangkok Bank schemes.");

    [
        "frontend/mlbb.html",
        "frontend/pubg.html",
        "frontend/freefire.html",
        "frontend/hok.html",
        "frontend/aov-id.html",
        "frontend/pubg-rp.html",
        "frontend/telegram.html",
        "frontend/genshin.html",
        "frontend/roblox.html",
        "frontend/wallet.html"
    ].forEach(file => {
        includes(file, "/js/payment/android-app-launch.js", "shared Android launch helper must be loaded.");
        includes(file, "/js/payment/payment-checkout-sheet.js?v=20260723-context-bank-runtime", "public checkout pages must cache-bust the fixed checkout sheet.");
        includes(file, "/js/payment/android-app-launch.js?v=20260722-open-app", "public checkout pages must cache-bust the Android launch helper.");
    });

    includes("frontend/admin.html", "/js/payment/android-app-launch.js", "Admin must load shared Android launch helper.");

    console.log("Android bank app launch verification passed.");
}

main();
