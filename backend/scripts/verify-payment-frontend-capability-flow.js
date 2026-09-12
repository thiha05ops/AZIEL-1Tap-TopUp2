const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function main() {
    [
        "frontend/js/payment.js",
        "frontend/js/region-payment.js"
    ].forEach(file => {
        includes(file, ".__paymentMethod", "payment card must retain full PaymentMethod object");
        includes(file, "...originalMethod", "selected payment must preserve original PaymentMethod fields");
        includes(file, '"thunderpromptpay"', "Thunder PromptPay must be recognized by public payment eligibility");
        includes(file, 'provider: originalMethod.provider ||', "selected payment must preserve the Thunder provider identity");
        includes(file, "receiptUploadEnabled", "selected payment must preserve receiptUploadEnabled");
        includes(file, "galleryScanSupported", "selected payment must preserve galleryScanSupported");
        includes(file, "checklistSteps: Array.isArray(originalMethod.checklistSteps)", "selected payment must preserve checklistSteps array");
    });

    includes("frontend/js/payment/payment-engine.js", "attemptSession.selectedPaymentMethod = selectedPayment", "manual attempt session must carry selected PaymentMethod");
    includes("frontend/js/payment/payment-engine.js", "paymentSession.selectedPaymentMethod = selectedPayment", "auto session must carry selected PaymentMethod");

    [
        "frontend/js/payment/payment-manual.js",
        "frontend/js/payment/payment-deeplink.js"
    ].forEach(file => {
        includes(file, "paymentSession.selectedPaymentMethod", "payment module must read selected PaymentMethod from session");
        includes(file, "...payment", "PaymentCheckoutSheet options must include full selected PaymentMethod object");
        includes(file, "enableSaveQr", "PaymentCheckoutSheet options must preserve enableSaveQr");
        includes(file, "enableOpenApp", "PaymentCheckoutSheet options must preserve enableOpenApp");
        includes(file, "enableChecklist", "PaymentCheckoutSheet options must preserve enableChecklist");
        includes(file, "appDisplayName", "PaymentCheckoutSheet options must preserve appDisplayName");
        includes(file, "deepLinkUrl", "PaymentCheckoutSheet options must preserve deepLinkUrl");
        includes(file, "galleryScanSupported", "PaymentCheckoutSheet options must preserve galleryScanSupported");
        includes(file, "receiptUploadEnabled", "PaymentCheckoutSheet options must preserve receiptUploadEnabled");
        includes(file, "checklistSteps", "PaymentCheckoutSheet options must preserve checklistSteps");
    });

    const sheet = read("frontend/js/payment/payment-checkout-sheet.js");
    [
        "options.enableSaveQr",
        "options.enableOpenApp",
        "options.deepLink",
        "options.appDisplayName",
        "options.checklistSteps",
        "renderChecklist",
        "updateChecklist(\"upload_receipt\")"
    ].forEach(snippet => assert(sheet.includes(snippet), `payment checkout sheet must consume ${snippet}`));

    const manual = read("frontend/js/payment/payment-manual.js");
    assert(manual.includes("autoSubmitReceipt: thunderVerified"), "only Thunder checkout must opt into receipt auto-submit");
    assert(sheet.includes('transferComplete.hidden = options.autoSubmitReceipt === true'), "Thunder must skip the transfer-complete gate");
    assert(sheet.includes('activeState?.autoSubmitReceipt === true) await activeState.submitSelectedReceipt?.()'), "Thunder file selection must auto-start the existing submission callback");
    assert(sheet.includes("activeState.submitting === true"), "receipt auto-submit must reject duplicate in-flight requests");
    assert(sheet.includes('input.value = ""'), "failed receipt verification must allow the same file to be selected again");
    assert(sheet.includes('submit.textContent = "Retry Verification"'), "pending Thunder verification must remain retryable with its bound receipt");
    assert(sheet.includes('setMessage("", "Payment verification is still pending. Please wait, then retry verification.")'), "Thunder pending state must use neutral styling");
    assert(manual.includes('["paid", "processing", "completed"].includes(orderStatus)'), "Thunder success must require an authoritative paid order response");
    assert(manual.includes("if (thunderVerified && !verified && pending) return { status: \"pending\" }"), "only explicit non-paid Thunder pending responses may use pending semantics");
    assert(manual.includes("if (thunderVerified && !verified) return { status: \"unconfirmed\" }"), "non-paid non-pending Thunder responses must remain distinctly unconfirmed");
    assert(sheet.includes('result?.status === "unconfirmed"'), "unexpected successful Thunder responses must use retryable unconfirmed UX");
    assert(manual.includes("if (authoritativePaid)"), "Thunder success messaging must require authoritative payment");
    assert(manual.includes('setMessage?.("", "Payment verification is still pending. Please wait, then retry.")'), "explicit Thunder pending messaging must be neutral");
    assert(manual.includes('setMessage?.("success", result.message || "Payment is still being verified. Please retry shortly.")'), "Manual PromptPay submitted messaging must remain unchanged");
    assert(sheet.includes("isDefinitiveReceiptRejection(error)"), "Thunder failures must use the existing backend error contract");
    assert(sheet.includes("We couldn't verify your payment right now. Please try again."), "technical Thunder failures must retain retry UX");
    assert(sheet.includes("Payment could not be verified. Please upload the correct payment slip for this order."), "definitive Thunder rejection must request another slip");
    assert(sheet.includes('options.autoSubmitReceipt !== true && requiresSlip'), "manual receipt flow must retain its transfer-complete gate");
    assert(manual.includes('data.payment?.code === "SLIP_PENDING"'), "Thunder SLIP_PENDING must remain pending rather than failing");
    assert(manual.includes("if (!pending && (!thunderVerified || authoritativePaid))"), "Thunder recovery marker must clear only after authoritative payment");
    assert(!sheet.includes('paymentStatus: "paid"'), "frontend checkout must never assign paid authority");

    console.log("Payment frontend capability flow verification passed.");
}

main();
