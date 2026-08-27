"use strict";

const FULFILLMENT_ROUTING_MODES = Object.freeze({
    LEGACY_REGION: "LEGACY_REGION",
    DUAL_READ: "DUAL_READ",
    ELIGIBILITY_PRIMARY: "ELIGIBILITY_PRIMARY"
});

function resolveFulfillmentRoutingMode(env = process.env) {
    const configured = String(env.AZIEL_FULFILLMENT_ROUTING_MODE || "").trim().toUpperCase();
    if (!configured) return FULFILLMENT_ROUTING_MODES.LEGACY_REGION;
    if (!Object.values(FULFILLMENT_ROUTING_MODES).includes(configured)) {
        const error = new Error(`Unsupported fulfillment routing mode: ${configured}`);
        error.code = "FULFILLMENT_ROUTING_MODE_INVALID";
        throw error;
    }
    return configured;
}

module.exports = Object.freeze({ FULFILLMENT_ROUTING_MODES, resolveFulfillmentRoutingMode });
