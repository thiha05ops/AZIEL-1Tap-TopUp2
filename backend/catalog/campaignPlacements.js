"use strict";

const CAMPAIGN_PLACEMENT_DEFINITIONS = Object.freeze({
    ENTRY_POPUP: Object.freeze({ code: "ENTRY_POPUP", label: "Entry Popup", requiresProductTarget: false, supportsMedia: true, supportsCTA: true, modal: true, maxVisible: 1 }),
    TOP_NOTICE: Object.freeze({ code: "TOP_NOTICE", label: "Top Notice", requiresProductTarget: false, supportsMedia: true, supportsCTA: true, modal: false, maxVisible: 1 }),
    PRODUCT_NOTICE: Object.freeze({ code: "PRODUCT_NOTICE", label: "Product Notice", requiresProductTarget: true, supportsMedia: true, supportsCTA: true, modal: false, maxVisible: 1 })
});

const CAMPAIGN_PLACEMENTS = Object.freeze(Object.keys(CAMPAIGN_PLACEMENT_DEFINITIONS));

function getCampaignPlacementDefinition(value = "") {
    return CAMPAIGN_PLACEMENT_DEFINITIONS[String(value || "").trim().toUpperCase()] || null;
}

module.exports = Object.freeze({ CAMPAIGN_PLACEMENT_DEFINITIONS, CAMPAIGN_PLACEMENTS, getCampaignPlacementDefinition });
