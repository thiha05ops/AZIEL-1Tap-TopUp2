const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

function main() {
    const adminPayments = read("frontend/js/admin-payments.js");
    const checkout = read("frontend/js/payment/payment-checkout-sheet.js");
    const paymentJs = read("frontend/js/payment.js");

    includes("frontend/js/admin-payments.js", "ADMIN_DEEPLINK_TEST_PRESETS", "candidate presets must be centralized.");
    [
        "scbeasy://",
        "kplus://",
        "bangkokbankmobile://",
        "bualuang://",
        "krungsri://",
        "ktbnext://",
        "ttbtouch://",
        "uobthai://",
        "cimbthai://",
        "mymo://",
        "baacmobile://"
    ].forEach(candidate => includes("frontend/js/admin-payments.js", candidate, `candidate ${candidate} must be available.`));

    includes("frontend/js/admin-payments.js", "function isAdminOwner()", "tool must have an explicit owner role gate.");
    includes("frontend/js/admin-payments.js", 'role === "OWNER"', "tool must be OWNER-only.");
    includes("frontend/js/admin-payments.js", 'if (!isAdminOwner()) return "";', "non-owner render must omit the tester.");
    includes("frontend/js/admin-payments.js", 'tester.remove();', "non-owner runtime must remove tester markup defensively.");
    includes("frontend/js/admin-payments.js", 'showAdminToast?.("Deep Link Tester is OWNER-only."', "actions must be guarded at runtime.");

    includes("frontend/js/admin-payments.js", "validateDeepLinkCandidate", "candidate validation helper missing.");
    ["javascript", "data", "file", "blob"].forEach(scheme => {
        includes("frontend/js/admin-payments.js", `"${scheme}"`, `${scheme}: must be rejected.`);
    });
    includes("frontend/js/admin-payments.js", "Use HTTPS for universal links", "HTTP universal links must be rejected.");
    includes("frontend/js/admin-payments.js", "Candidate must not contain whitespace or control characters.", "whitespace/control character validation missing.");

    includes("frontend/js/admin-payments.js", "window.location.href = validation.value", "custom-scheme launch must require an explicit click path.");
    includes("frontend/js/admin-payments.js", 'window.open(validation.value, "_blank", "noopener,noreferrer")', "HTTPS tests must preserve editor state where possible.");
    includes("frontend/js/admin-payments.js", "Possible app handoff detected", "handoff must be treated as possible, not guaranteed.");
    notIncludes("frontend/js/admin-payments.js", ">Valid<", "tool must not auto-label candidates as valid.");
    notIncludes("frontend/js/admin-payments.js", "verified: true", "candidate presets must not be marked verified.");

    includes("frontend/js/admin-payments.js", 'data-action="confirm-deeplink-opened"', "owner confirmation button missing.");
    includes("frontend/js/admin-payments.js", "Save only populates editor fields", "confirmation messaging must clarify no direct database save.");
    includes("frontend/js/admin-payments.js", "selectedDeepLinkTargets", "save target handling must be centralized.");
    includes("frontend/js/admin-payments.js", ".pm-deeplink", "official deeplink target must remain available.");
    includes("frontend/js/admin-payments.js", ".pm-ios-app-launch", "iOS launch target must remain available.");
    includes("frontend/js/admin-payments.js", ".pm-android-app-launch", "Android launch target must remain available.");
    includes("frontend/js/admin-payments.js", "confirmDeepLinkOverwrite", "existing launch URLs must require overwrite confirmation.");
    includes("frontend/js/admin-payments.js", "Save the payment method to publish it", "normal Payment Method Save must remain final DB write.");

    assert(!/testDeepLinkLaunch[\s\S]{0,1800}adminFetch\(/.test(adminPayments), "test launch must not call Admin/payment APIs.");
    assert(!/saveTestedDeepLinkToEditor[\s\S]{0,2200}adminFetch\(/.test(adminPayments), "save-to-editor must not write directly to backend.");
    assert(!/saveTestedDeepLinkToEditor[\s\S]{0,2200}qrMode/.test(adminPayments), "save-to-editor must not modify qrMode.");
    assert(!/saveTestedDeepLinkToEditor[\s\S]{0,2200}confirmationMode/.test(adminPayments), "save-to-editor must not modify confirmationMode.");

    notIncludes("frontend/js/payment.js", "pm-deeplink-tester", "public payment runtime must not expose admin tester.");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", "pm-deeplink-tester", "checkout sheet must not expose admin tester.");
    assert(!checkout.includes("ADMIN_DEEPLINK_TEST_PRESETS") && !paymentJs.includes("ADMIN_DEEPLINK_TEST_PRESETS"), "public checkout must not load tester presets.");

    includes("frontend/css/admin/admin.css", ".pm-deeplink-tester", "tester styles must be scoped to Admin Payment Methods.");

    console.log("Admin Payment Deep Link Tester verification passed.");
}

main();
