"use strict";

const {
    createManualPromptPayAdapter,
    MANUAL_PROMPTPAY_PROVIDER_ID
} = require("./providers/manualPromptPayAdapter");

function createManualPromptPayProvider(options = {}) {
    return createManualPromptPayAdapter(options);
}

function registerManualPromptPayProvider(registry, options = {}) {
    if (!registry || typeof registry.registerProvider !== "function") {
        throw new Error("A Commerce provider registry is required to register Manual PromptPay.");
    }
    const provider = createManualPromptPayProvider(options);
    registry.registerProvider(provider);
    return provider;
}

module.exports = Object.freeze({
    createManualPromptPayProvider,
    registerManualPromptPayProvider,
    MANUAL_PROMPTPAY_PROVIDER_ID
});
