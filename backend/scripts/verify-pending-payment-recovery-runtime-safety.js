const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

function verifyNoPageReloads() {
    [
        "frontend/js/pwa-fix.js",
        "frontend/js/payment/pending-payment-recovery.js"
    ].forEach(file => {
        const source = read(file);
        assert(!/location\.reload\s*\(/.test(source), `${file}: recovery runtime must not reload the page.`);
        assert(!/location\.replace\s*\(/.test(source), `${file}: recovery runtime must not replace the page.`);
        assert(!/location\.assign\s*\(/.test(source), `${file}: recovery runtime must not assign navigation.`);
    });

    notIncludes("frontend/js/pwa-fix.js", "controllerchange", "PWA fix must not auto-reload on service worker controller changes.");
    notIncludes("frontend/js/pwa-fix.js", "pwaUpdateReady\"), () => location.reload", "PWA update readiness must not reload automatically.");
}

function verifyOneTimeOwnership() {
    includes("frontend/js/pwa-fix.js", "__AZIEL_PWA_FIX_INITIALIZED__", "PWA fix must have a strict global one-time guard.");
    includes("frontend/js/pwa-fix.js", "__AZIEL_PENDING_PAYMENT_RECOVERY_LOADER__", "recovery loader must have shared loading state.");
    includes("frontend/js/pwa-fix.js", "loaderState.loaded || loaderState.loading", "recovery loader must prevent duplicate injection.");
    includes("frontend/js/pwa-fix.js", "script.onload = () =>", "recovery loader must mark script as loaded.");
    includes("frontend/js/pwa-fix.js", "script.onerror = () =>", "recovery loader must clear loading state on failure.");

    includes("frontend/js/payment/pending-payment-recovery.js", "__AZIEL_PENDING_PAYMENT_RECOVERY_INITIALIZED__", "recovery module must have a strict global one-time guard.");
    includes("frontend/js/payment/pending-payment-recovery.js", "if (state.fetching) return;", "recovery fetches must not overlap, even when forced.");
    includes("frontend/js/payment/pending-payment-recovery.js", "runtimePromise", "checkout runtime injection must share one in-flight promise.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "__AZIEL_PAYMENT_CHECKOUT_RECOVERY_LISTENER__", "recovery checkout event listener must be registered once.");
}

function verifyNoRecursiveRecoveryFetch() {
    const overlay = read("frontend/js/payment/pending-payment-recovery.js");
    const renderBlock = overlay.match(/function renderOverlay\(\) \{[\s\S]*?\n    function startCountdown/)?.[0] || "";
    const observerBlock = overlay.match(/function watchCheckoutSheet\(\) \{[\s\S]*?\n    function init/)?.[0] || "";
    assert(renderBlock, "pending-payment-recovery.js: renderOverlay block must be detectable.");
    assert(observerBlock, "pending-payment-recovery.js: watchCheckoutSheet block must be detectable.");
    assert(!renderBlock.includes("fetchRecoverable({ force: true });"), "render/countdown expiry must not recursively refetch recoverable attempts.");
    assert(!observerBlock.includes("renderOverlay();"), "checkout MutationObserver must not rerender overlay in response to its own DOM mutations.");
}

function verifyRecoveryCheckoutDoesNotPersistQrSnapshots() {
    includes("frontend/js/payment/payment-checkout-sheet.js", "if (isRecoveryMode(options)) return;", "recovery checkout must bypass synchronous session persistence.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "if (isRecoveryMode(options)) return {};", "recovery checkout must bypass restored checkout snapshots.");
}

verifyNoPageReloads();
verifyOneTimeOwnership();
verifyNoRecursiveRecoveryFetch();
verifyRecoveryCheckoutDoesNotPersistQrSnapshots();

console.log("Pending payment recovery runtime safety verifier passed.");
