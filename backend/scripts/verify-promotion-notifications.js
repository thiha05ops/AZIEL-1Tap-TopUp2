const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function includes(file, token, message) {
    assert(read(file).includes(token), `${file}: ${message}`);
}

function main() {
    const model = read("backend/models/PromotionNotification.js");
    const service = read("backend/services/promotionNotificationService.js");
    const notificationService = read("backend/services/notificationService.js");
    const routes = read("backend/routes/notification.js");
    const adminHtml = read("frontend/admin.html");
    const adminApp = read("frontend/js/admin-app.js");
    const homeHtml = read("frontend/home.html");
    const homeRuntime = read("frontend/js/home-promotion-preview.js");
    const homePlacement = read("frontend/js/home-placement-runtime.js");
    const notificationsPage = read("frontend/js/notifications-page.js");
    const notificationStore = read("frontend/js/notification-store.js");
    const audit = read("backend/services/adminAuditService.js");

    [
        "title",
        "summary",
        "promoCode",
        "campaignCode",
        "startsAt",
        "endsAt",
        "enabled",
        "publishedAt",
        "audience",
        "regions"
    ].forEach(token => assert(model.includes(token), `PromotionNotification model missing ${token}`));

    assert(service.includes("materializePromotionForEligibleUsers"), "Promotion publishing must materialize into existing Notification inbox records.");
    assert(service.includes("Notification.findOne") && service.includes("metadata.promotionNotificationId"), "Promotion publishing must suppress duplicate inbox sends.");
    assert(service.includes("listActivePromotionPreview"), "Home preview must be server-owned.");
    assert(service.includes("audience === \"GUESTS\" ? false : true"), "Guest-only promotions must not materialize to registered-user inboxes.");
    assert(service.includes("getUnreadCount") && service.includes("realtime.emitNotification"), "Published promotions must preserve unread badge/realtime behavior.");

    assert(notificationService.includes("\"promoCode\""), "Notification metadata sanitizer must allow promo code metadata.");
    assert(notificationService.includes("\"promotionNotificationId\""), "Notification metadata sanitizer must allow promotion idempotency metadata.");
    assert(notificationService.includes("filter.category = category"), "Notification list endpoint must support server-side category filtering.");
    assert(notificationService.includes("filter.isRead = false"), "Notification list endpoint must support unread filtering.");

    assert(routes.indexOf('"/notifications/promotions/active"') > -1, "Public active promotion endpoint is required.");
    assert(routes.indexOf('"/notifications/promotions/active"') < routes.indexOf('"/notifications/:username"'), "Public active promotion route must not be shadowed by legacy username route.");
    assert(routes.includes('"/admin/promotion-notifications"'), "Admin promotion notification route is required.");
    assert(routes.includes('"/admin/promotion-notifications/:id/publish"'), "Admin publish route is required.");
    assert(routes.includes("requireAdminPermission(PERMISSIONS.SETTINGS_MANAGE)"), "Admin promotion routes must require existing Admin authorization.");

    [
        "PROMOTION_NOTIFICATION_CREATED",
        "PROMOTION_NOTIFICATION_UPDATED",
        "PROMOTION_NOTIFICATION_PUBLISHED",
        "PROMOTION_NOTIFICATION_DISABLED"
    ].forEach(action => assert(audit.includes(action), `Admin audit action missing: ${action}`));

    assert(adminHtml.includes("promotion-publish-form"), "Admin Broadcast section must include promotion workflow.");
    assert(adminHtml.includes("promotionPromoCode"), "Admin promotion workflow must allow optional promo code link.");
    assert(adminHtml.includes("promotionCampaignCode"), "Admin promotion workflow must allow optional campaign link.");
    assert(adminApp.includes("initPromotionNotificationAdmin"), "Admin app must initialize promotion workflow.");
    assert(adminApp.includes("/api/admin/promotion-notifications"), "Admin app must call canonical promotion routes.");

    assert(homeHtml.includes('id="latestPromotionsPanel"'), "Home promotions panel must be addressable.");
    assert(homeHtml.includes('/notifications.html?filter=promotions'), "Home View All must deep link to Promotions filter.");
    assert(homeHtml.includes("/js/home-promotion-preview.js"), "Home must load promotion notification preview runtime.");
    assert(!homeHtml.includes("MLBB Diamond Bonus"), "Home must not render static fake promotions.");
    assert(homeRuntime.includes("/api/notifications/promotions/active"), "Home preview must use public active promotion endpoint.");
    assert(homeRuntime.includes("No active promotions"), "Home preview must define safe empty state.");
    assert(homeRuntime.includes("target=\"_blank\" rel=\"noopener noreferrer\""), "Home external promotion CTAs must open safely.");
    assert(!homePlacement.includes("HOME_LATEST_PROMOTIONS"), "Site placement runtime must not own notification promotions.");

    assert(notificationsPage.includes("[\"promotions\", \"Promotions\"]"), "Notifications page must expose Promotions filter.");
    assert(notificationsPage.includes("readFilterFromUrl"), "Notifications page must read filter deep links.");
    assert(notificationsPage.includes("writeFilterToUrl"), "Notifications page must update URL on filter changes.");
    assert(notificationsPage.includes("filter: activeNotificationFilter"), "Notifications page must request selected server filter.");
    assert(!notificationsPage.includes("[\"system\", \"System\"],\n];") || notificationsPage.includes("[\"promotions\", \"Promotions\"]"), "Promotions filter must not be hidden under System.");
    assert(notificationStore.includes("params.set(\"category\", \"promotions\")"), "Notification store must request promotions category from server.");

    console.log("Promotion notification integration verification passed.");
}

main();
