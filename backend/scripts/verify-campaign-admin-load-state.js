"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const admin = fs.readFileSync(path.join(root, "frontend/js/admin-campaigns.js"), "utf8");
const html = fs.readFileSync(path.join(root, "frontend/admin.html"), "utf8");

assert.ok(admin.includes('document.body.dataset.adminSection === "campaigns"'), "Controller must load an already-open Campaign section.");
assert.ok(admin.includes('classList.contains("active")'), "Active-section fallback must survive missed open events.");
assert.ok(admin.includes("campaignLoadPending && !force"), "Duplicate initial loads must be guarded.");
assert.ok(admin.includes("const requestId = ++campaignLoadSequence"), "Every authoritative load needs a sequence owner.");
assert.ok(admin.includes("campaignLoadController?.abort()"), "Forced retries must abort the previous request.");
assert.ok(admin.includes("requestId !== campaignLoadSequence"), "Stale results must not render.");
assert.ok(admin.includes('dataset.campaignState = "loading"'), "Loading state must be explicit.");
assert.ok(admin.includes('dataset.campaignState = "content"'), "Content state must be explicit.");
assert.ok(admin.includes('dataset.campaignState = "empty"'), "Empty state must be explicit.");
assert.ok(admin.includes('dataset.campaignState = "error"'), "Error state must be explicit.");
assert.ok(admin.includes("renderCampaignError"), "Failures must replace skeletons with retry UI.");
assert.ok(admin.includes("safeCampaignValue"), "Malformed optional projection values must not crash the whole list.");
assert.ok(admin.includes("Invalid date"), "Malformed schedules must render a contained fallback.");
assert.ok(html.includes("admin-campaigns.js?v=20260809-load-state"), "Admin must load the corrected controller without stale cache.");
console.log("Campaign Admin finite load-state verification passed.");
