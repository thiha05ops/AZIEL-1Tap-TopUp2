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

function qrModeOptions(adminPaymentsJs) {
    const selectMatch = adminPaymentsJs.match(/<select class="pm-qr-mode">([\s\S]*?)<\/select>/);
    assert(selectMatch, "Admin QR Mode select must exist.");
    return Array.from(selectMatch[1].matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g))
        .map(match => ({ value: match[1], label: match[2].trim() }));
}

function main() {
    const adminPayments = read("frontend/js/admin-payments.js");
    const checkout = read("frontend/js/payment/payment-checkout-sheet.js");
    const paymentMethodsRoute = read("backend/routes/paymentMethods.js");
    const paymentMethodModel = read("backend/models/PaymentMethod.js");

    assert.deepStrictEqual(qrModeOptions(adminPayments), [
        { value: "provider_generated", label: "Provider Generated Dynamic QR" },
        { value: "aziel_promptpay_dynamic", label: "AZIEL Generated PromptPay QR" },
        { value: "uploaded_static", label: "Uploaded Static QR" },
        { value: "none", label: "No QR" }
    ], "Admin QR Mode dropdown must expose the exact canonical options in order.");

    includes("backend/models/PaymentMethod.js", 'enum: ["provider_generated", "uploaded_static", "aziel_promptpay_dynamic", "none"]', "PaymentMethod schema must preserve aziel_promptpay_dynamic enum value.");
    includes("backend/routes/paymentMethods.js", '["provider_generated", "uploaded_static", "aziel_promptpay_dynamic", "none"].includes(String(body.qrMode))', "Admin update route must accept aziel_promptpay_dynamic.");
    includes("backend/routes/paymentMethods.js", 'qrMode: obj.qrMode || "uploaded_static"', "Public/admin projections must return saved qrMode.");
    includes("backend/routes/paymentMethods.js", 'key === "promptpay" && method.qrMode !== "aziel_promptpay_dynamic"', "Compatibility mode must not overwrite explicit dynamic PromptPay QR mode.");
    assert(!/method\.qrMode\s*=\s*"provider_generated";[\s\S]{0,160}method\.qrMode\s*=\s*"aziel_promptpay_dynamic"/.test(paymentMethodsRoute), "Backend must not normalize dynamic QR mode into provider generated mode.");

    includes("frontend/js/admin-payments.js", 'payload.qrMode = "aziel_promptpay_dynamic"', "Admin save must preserve PromptPay as dynamic QR mode.");
    includes("frontend/js/admin-payments.js", 'payload.paymentType = "manual"', "Admin save must keep PromptPay on manual attempt flow.");
    includes("frontend/js/admin-payments.js", 'payload.openAppMode = "bank_chooser"', "Admin save must keep PromptPay on bank chooser mode.");
    includes("frontend/js/admin-payments.js", 'qrMode: card.querySelector(".pm-qr-mode")?.value || "uploaded_static"', "Admin save payload must send selected qrMode.");

    includes("frontend/js/payment/payment-checkout-sheet.js", 'function isDynamicPromptPayMode', "Checkout must have explicit dynamic QR mode ownership.");
    includes(
        "frontend/js/payment/payment-checkout-sheet.js",
        'return options.qrMode === "aziel_promptpay_dynamic";',
        "Dynamic PromptPay mode ownership must be driven directly by qrMode."
    );
    includes(
        "frontend/js/payment/payment-checkout-sheet.js",
        'return isDynamicPromptPayMode(options) && !isRecoveryMode(options) &&',
        "Dynamic QR generation eligibility must begin from explicit dynamic PromptPay mode ownership."
    );
    includes("frontend/js/payment/payment-checkout-sheet.js", 'setQrImage(data.qrImage, "dynamic_response", data.qrPayload)', "Dynamic endpoint response image must be the rendered QR image.");
    includes("frontend/js/payment/payment-checkout-sheet.js", 'renderedQrSourceType(options, qr)', "Checkout must track rendered QR source type.");
    assert(!checkout.includes('dev: qrMode=${options.qrMode || "unknown"}; source=${sourceType || "none"}'), "Checkout must not expose QR diagnostics in customer UI.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "el.hidden = true;", "QR diagnostic element must remain hidden.");
    const qrSelection = checkout.match(/const qr = dynamicQr\s*\?\s*([\s\S]*?)\s*:\s*([\s\S]*?);/);
    assert(qrSelection, "Checkout must have an explicit dynamic/static QR selection branch.");
    assert.strictEqual(qrSelection[1].trim(), '""', "Dynamic checkout must start empty and wait for the latest generated QR response.");
    assert(!qrSelection[1].includes("options.qrImageUrl") && !qrSelection[1].includes("options.qrImage"), "Dynamic QR branch must not fall back to uploaded static qrImageUrl.");
    assert(qrSelection[2].includes("options.qrImageUrl || options.qrImage"), "Static/provider QR branch must continue to support configured QR images.");
    includes("frontend/js/payment/payment-checkout-sheet.js", 'setQrLoading(false, error.message || "Could not generate PromptPay QR.")', "Dynamic QR failure must show retry/error state.");
    includes("frontend/js/payment/payment-checkout-sheet.js", 'if (retry) retry.hidden = isLoading;', "Retry button must be visible after dynamic QR generation failure.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "sameCheckoutIdentity", "Session restore must validate checkout identity.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "DYNAMIC_PROMPTPAY_QR_VERSION", "Session restore must invalidate stale dynamic QR schema.");
    includes("frontend/js/payment/payment-checkout-sheet.js", 'String(snapshot.qrMode || "") === String(options.qrMode || "")', "Session restore must invalidate when qrMode differs.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "normalizedComparableAmount(snapshot.amount) === normalizedComparableAmount(options.amount)", "Session restore must invalidate when amount differs.");

    includes("frontend/js/payment/payment-checkout-sheet.js", 'options.qrMode === "uploaded_static" && qr', "Uploaded static mode must remain functional.");
    includes("frontend/js/payment/payment-checkout-sheet.js", 'options.qrMode === "provider_generated" && qr', "Provider generated mode must remain functional.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "return \"\";", "No-QR and unknown modes must resolve to an empty rendered QR source.");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", "paymentStatus: \"paid\"", "Checkout sheet must not change paid/webhook behavior.");

    assert(paymentMethodModel.includes("aziel_promptpay_dynamic"), "Model must retain dynamic QR enum.");
    console.log("Payment QR mode integrity verification passed.");
}

main();
