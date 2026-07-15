const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function includes(file, pattern, message) {
    assert(read(file).includes(pattern), `${file}: ${message}`);
}

function matches(file, pattern, message) {
    assert(pattern.test(read(file)), `${file}: ${message}`);
}

function verifyFoundation() {
    includes("backend/models/Campaign.js", "mongoose.model(\"Campaign\"", "Campaign model must exist.");
    includes("backend/models/Campaign.js", "campaignCode", "Campaign must have campaignCode identity.");
    includes("backend/models/Campaign.js", "unique: true", "Campaign identity must be unique.");
    includes("backend/models/Campaign.js", "immutable: true", "Campaign code must be immutable.");
    includes("backend/models/Campaign.js", "ENTRY_POPUP", "Campaign placement must include ENTRY_POPUP.");
    includes("backend/models/CampaignImpression.js", "mongoose.model(\"CampaignImpression\"", "CampaignImpression model must exist.");
    includes("backend/models/CampaignClaimState.js", "mongoose.model(\"CampaignClaimState\"", "CampaignClaimState must exist for claim frequency.");
    includes("backend/models/CampaignClaimState.js", "{ unique: true }", "Claim state must have a unique user/campaign/placement key.");
    includes("backend/services/campaignService.js", "CAMPAIGN_TYPES", "Campaign service must own type validation.");
    includes("backend/services/campaignService.js", "PROMOTION", "PROMOTION type must be supported.");
    includes("backend/services/campaignService.js", "NEW_GAME", "NEW_GAME type must be supported.");
    includes("backend/services/campaignService.js", "ANNOUNCEMENT", "ANNOUNCEMENT type must be supported.");
    includes("backend/services/campaignService.js", "IMPORTANT_UPDATE", "IMPORTANT_UPDATE type must be supported.");
    includes("backend/services/campaignService.js", "CAMPAIGN_ALREADY_EXISTS", "Duplicate campaignCode must be rejected.");
    includes("backend/services/campaignService.js", "CAMPAIGN_CODE_IMMUTABLE", "Campaign code updates must be rejected.");
}

function verifyValidationAndSafety() {
    const service = read("backend/services/campaignService.js");

    [
        "CAMPAIGN_REGION_INVALID",
        "CAMPAIGN_AUDIENCE_INVALID",
        "CAMPAIGN_FREQUENCY_INVALID",
        "CAMPAIGN_CTA_INVALID",
        "CAMPAIGN_MEDIA_CATEGORY_INVALID",
        "parseCtaTarget",
        "parseSchedule",
        "parseSortOrder",
        "Asia/Bangkok",
        "ONCE_PER_SESSION",
        "ONCE_PER_DAY",
        "ONCE_EVERY_3_DAYS",
        "ONCE_PER_CAMPAIGN",
        "priority: -1",
        "campaignCode: 1"
    ].forEach(pattern => assert(service.includes(pattern), `backend/services/campaignService.js: missing ${pattern}`));

    assert(!service.includes("VIP"), "Campaign service must not add fake VIP targeting.");
    assert(!service.includes("WHALE"), "Campaign service must not add fake behavioral targeting.");
}

function verifyRoutes() {
    const routes = read("backend/routes/campaigns.js");

    [
        "router.get(\"/admin/campaigns\", adminMiddleware",
        "router.post(\"/admin/campaigns\", adminMiddleware",
        "router.patch(\"/admin/campaigns/:campaignId\", adminMiddleware",
        "router.delete(\"/admin/campaigns/:campaignId\", adminMiddleware",
        "router.post(\"/campaigns/entry-popup/claim\", optionalAuthMiddleware"
    ].forEach(pattern => assert(routes.includes(pattern), `backend/routes/campaigns.js: missing ${pattern}`));

    includes("backend/server.js", "const campaignRoutes = require(\"./routes/campaigns\");", "Server must import Campaign routes.");
    includes("backend/server.js", "app.use(\"/api\", campaignRoutes);", "Server must mount Campaign routes.");
    includes("backend/middleware/optionalAuthMiddleware.js", "verifyUserToken", "Optional auth must verify real JWTs.");
    includes("backend/middleware/optionalAuthMiddleware.js", "req.user = auth.context", "Optional auth must attach canonical user context.");
}

function verifyMediaSafety() {
    includes("backend/services/mediaService.js", "const Campaign = require(\"../models/Campaign\");", "Media safe-delete must import Campaign.");
    includes("backend/services/mediaService.js", "Campaign.countDocuments({ mediaAssetId: assetId, archivedAt: null })", "Media safe-delete must count active Campaign references.");
    includes("backend/services/mediaService.js", "campaigns,", "Media reference projection must expose campaign reference count.");
    includes("backend/services/campaignService.js", "CAMPAIGN_MEDIA_CATEGORIES", "Campaign media compatibility must be centralized.");
    includes("backend/services/campaignService.js", "\"campaign\", \"promotion\", \"announcement\"", "Campaign media categories must be campaign/promotion/announcement.");
}

function verifyAdminUi() {
    includes("frontend/admin.html", "data-section=\"campaigns\"", "Admin nav must expose Campaigns.");
    includes("frontend/admin.html", "id=\"section-campaigns\"", "Admin Campaign section must exist.");
    includes("frontend/admin.html", "/js/admin-campaigns.js", "Admin page must load Campaign controller.");
    includes("frontend/js/admin-app.js", "campaigns:", "Admin section titles must register campaigns.");
    includes("frontend/js/admin-campaigns.js", "/api/admin/campaigns", "Admin Campaign controller must use backend truth.");
    includes("frontend/js/admin-campaigns.js", "ENTRY_POPUP", "Admin placement must be ENTRY_POPUP.");
    includes("frontend/js/admin-campaigns.js", "categories: CAMPAIGN_MEDIA_CATEGORIES", "Admin media selector must filter compatible categories.");
    includes("frontend/js/admin-campaigns.js", "campaignSavePending", "Admin save must prevent duplicate submits.");
    includes("frontend/js/admin-campaigns.js", "previewCampaign", "Admin preview must exist.");
    assert(!read("frontend/admin.html").includes("/js/campaign-runtime.js"), "Customer campaign runtime must not be loaded in Admin.");
    matches("frontend/css/admin/admin-design-system.css", /@media\s*\(max-width:\s*768px\)[\s\S]*\.campaign-row/, "Campaign mobile UI must use existing max-width: 768px breakpoint.");
}

function verifyRuntime() {
    includes("frontend/js/campaign-runtime.js", "/api/campaigns/entry-popup/claim", "Runtime must claim ENTRY_POPUP campaigns.");
    includes("frontend/js/campaign-runtime.js", "AZIEL_CAMPAIGNS", "Runtime global must exist.");
    includes("frontend/js/campaign-runtime.js", "AZIEL?.getShopRegion", "Runtime must use existing shop region owner.");
    includes("frontend/js/campaign-runtime.js", "aziel_campaign_frequency_v1", "Guest frequency key must be namespaced/versioned.");
    includes("frontend/js/campaign-runtime.js", "sessionStorage", "ONCE_PER_SESSION must use session scoped state.");
    includes("frontend/js/campaign-runtime.js", "textContent", "Popup must render Admin-authored text safely.");
    includes("frontend/js/campaign-runtime.js", "role\", \"dialog\"", "Popup must expose dialog semantics.");
    includes("frontend/js/campaign-runtime.js", "aria-modal", "Popup must be modal for accessibility.");
    includes("frontend/js/campaign-runtime.js", "Escape", "Popup must support Escape close.");
    includes("frontend/js/campaign-runtime.js", "az-campaign-lock", "Popup must lock body scroll.");
    includes("frontend/js/campaign-runtime.js", "isAdminPage", "Runtime must skip Admin pages.");
    assert(!read("frontend/js/campaign-runtime.js").includes("geolocation"), "Runtime must not use geolocation.");
    assert(!read("frontend/js/campaign-runtime.js").includes("fingerprint"), "Runtime must not fingerprint users.");
}

function verifyCustomerPages() {
    [
        "frontend/home.html",
        "frontend/mlbb.html",
        "frontend/pubg.html",
        "frontend/freefire.html",
        "frontend/hok.html",
        "frontend/aov-id.html",
        "frontend/pubg-rp.html",
        "frontend/telegram.html",
        "frontend/wallet.html"
    ].forEach(file => includes(file, "/js/campaign-runtime.js", "Customer page must load Campaign runtime."));
}

function verifyI18n() {
    [
        "campaigns",
        "add_campaign",
        "campaign_name",
        "campaign_code",
        "campaign_type",
        "entry_popup",
        "all_regions",
        "all_visitors",
        "once_per_session",
        "once_per_day",
        "once_every_3_days",
        "once_per_campaign",
        "save_campaign"
    ].forEach(key => {
        includes("frontend/lang/admin/en.js", `${key}:`, `English i18n missing ${key}.`);
        includes("frontend/lang/admin/my.js", `${key}:`, `Myanmar i18n missing ${key}.`);
    });
}

function verifyNoScopeExpansion() {
    const admin = read("frontend/js/admin-campaigns.js");
    const service = read("backend/services/campaignService.js");

    ["HOME_BANNER", "GAME_BANNER", "DISCOUNT", "SUPPLIER"].forEach(term => {
        assert(!admin.includes(term), `Admin Campaigns must not expose ${term}.`);
        assert(!service.includes(term), `Campaign service must not implement ${term}.`);
    });
}

function main() {
    verifyFoundation();
    verifyValidationAndSafety();
    verifyRoutes();
    verifyMediaSafety();
    verifyAdminUi();
    verifyRuntime();
    verifyCustomerPages();
    verifyI18n();
    verifyNoScopeExpansion();
    console.log("Admin Campaigns verification passed.");
}

main();
