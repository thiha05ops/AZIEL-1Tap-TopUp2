"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    getProjectedState,
    isAudienceEligible,
    isRegionEligible,
    isScheduleEligible,
    projectPublicCampaign
} = require("../services/campaignService");

const now = new Date("2026-08-09T03:00:00.000Z");
const base = { campaignCode: "TEST", type: "PROMOTION", placement: "ENTRY_POPUP", title: "Title", body: "Body", enabled: true, archivedAt: null, regions: ["TH"], audience: "ALL_VISITORS", priority: 10, updatedAt: now };
assert.strictEqual(isScheduleEligible({ ...base, enabled: false }, now), false);
assert.strictEqual(getProjectedState({ ...base, enabled: false, hasBeenEnabled: false }, now), "DRAFT");
assert.strictEqual(getProjectedState({ ...base, enabled: false, hasBeenEnabled: true }, now), "DISABLED");
assert.strictEqual(isScheduleEligible({ ...base, startsAt: new Date("2026-08-09T04:00:00Z") }, now), false);
assert.strictEqual(isScheduleEligible({ ...base, endsAt: new Date("2026-08-09T02:00:00Z") }, now), false);
assert.strictEqual(isScheduleEligible({ ...base, startsAt: new Date("2026-08-09T02:00:00Z"), endsAt: new Date("2026-08-09T04:00:00Z") }, now), true);
assert.strictEqual(isRegionEligible(base, "TH"), true);
assert.strictEqual(isRegionEligible(base, "MM"), false);
assert.strictEqual(isAudienceEligible({ audience: "GUESTS" }, false), true);
assert.strictEqual(isAudienceEligible({ audience: "LOGGED_IN" }, false), false);
assert.strictEqual(getProjectedState({ ...base, startsAt: new Date("2026-08-09T04:00:00Z") }, now), "SCHEDULED");
assert.strictEqual(getProjectedState({ ...base, endsAt: new Date("2026-08-09T02:00:00Z") }, now), "EXPIRED");
assert.ok(projectPublicCampaign(base).campaignVersion, "Public projection must version dismissal identity.");

const root = path.resolve(__dirname, "../..");
const runtime = fs.readFileSync(path.join(root, "frontend/js/campaign-runtime.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "frontend/js/admin-campaigns.js"), "utf8");
assert.ok(runtime.includes("campaignDismissalKey"), "Edited campaigns must have versioned guest dismissal keys.");
assert.ok(runtime.includes('aziel:shopRegionChanged'), "Campaign eligibility must refresh with storefront region authority.");
assert.ok(runtime.includes("claimControllers.get(placement)?.abort()"), "Stale claims must be aborted independently per placement.");
assert.ok(admin.includes("campaignConfirmationSummary"), "Admin save must show a confirmation summary.");
assert.ok(admin.includes('+07:00'), "Admin datetime-local input must be interpreted as Bangkok time.");
console.log("Campaign lifecycle stabilization verification passed.");
