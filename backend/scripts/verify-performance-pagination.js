const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");
const {
    applyCursorFilter,
    encodeCursor,
    pageResult,
    parseLimit
} = require("../services/paginationService");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, pattern, message) {
    assert(read(file).includes(pattern), `${file}: ${message}`);
}

function matches(file, pattern, message) {
    assert(pattern.test(read(file)), `${file}: ${message}`);
}

function verifySharedPaginationService() {
    const source = read("backend/services/paginationService.js");

    assert(source.includes("MAX_LIMIT = 100"), "Pagination helper must cap list limits at 100.");
    assert(source.includes("encodeCursor") && source.includes("decodeCursor"), "Pagination helper must own cursor encoding/decoding.");
    assert(source.includes("createdAt") && source.includes("_id"), "Cursor contract must include createdAt and _id tie-breaker.");
    assert(source.includes("$lt: decoded.createdAt") && source.includes("_id: { $lt: decoded._id }"), "Cursor filter must be deterministic.");
    assert(source.includes("legacyCreatedAt"), "Legacy timestamp wallet cursors must remain readable.");
    assert(source.includes("escapeRegex"), "Search inputs must have a shared regex escaping helper.");
    assert(source.includes("sendPaginationError"), "Pagination errors must have a clean 400 response path.");
}

function verifyCursorBoundaryBehavior() {
    const sharedCreatedAt = new Date("2026-07-15T00:00:00.000Z");
    const boundary = {
        _id: new mongoose.Types.ObjectId("666666666666666666666666"),
        createdAt: sharedCreatedAt
    };
    const cursor = encodeCursor(boundary);
    const filter = applyCursorFilter({}, cursor);
    const boundaryClause = filter.$and?.[0]?.$or || [];

    assert.strictEqual(parseLimit(999999, { defaultLimit: 50, maxLimit: 100 }), 100, "Unbounded client limits must be capped.");
    assert(cursor && typeof cursor === "string", "Cursor must be opaque encoded text.");
    assert(boundaryClause.some(clause => clause.createdAt?.$lt), "Cursor must include older-createdAt branch.");
    assert(boundaryClause.some(clause => clause.createdAt?.getTime?.() === sharedCreatedAt.getTime() && clause._id?.$lt), "Cursor must include equal-createdAt _id tie-break branch.");

    const firstPage = [
        { _id: new mongoose.Types.ObjectId("999999999999999999999999"), createdAt: sharedCreatedAt },
        boundary,
        { _id: new mongoose.Types.ObjectId("555555555555555555555555"), createdAt: sharedCreatedAt }
    ];
    const result = pageResult(firstPage, 2);
    assert.strictEqual(result.pagination.hasMore, true, "Sentinel row should expose hasMore.");
    assert.strictEqual(result.page.length, 2, "Sentinel row must not be returned in the page.");
    assert.strictEqual(String(result.page[1]._id), String(boundary._id), "Boundary row must be the final returned page row.");
}

function verifyBackendListContracts() {
    const orderRoutes = read("backend/routes/order.js");
    assert(orderRoutes.includes("parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 })"), "Admin orders must use bounded limits.");
    assert(orderRoutes.includes("applyCursorFilter(query, req.query.cursor)"), "Admin orders must use cursor filtering.");
    assert(orderRoutes.includes(".sort({ createdAt: -1, _id: -1 })"), "Admin orders must use deterministic sorting.");
    assert(orderRoutes.includes(".limit(limit + 1)"), "Admin orders must fetch a sentinel row.");
    assert(orderRoutes.includes("projectAdminOrderSummary"), "Admin order list must use summary projection.");
    assert(orderRoutes.includes("orders: items"), "Admin order response must preserve legacy orders key.");

    const usersRoutes = read("backend/routes/adminUsers.js");
    assert(usersRoutes.includes("parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 })"), "Admin users must use bounded limits.");
    assert(usersRoutes.includes("applyCursorFilter(query, req.query.cursor)"), "Admin users must use cursor filtering.");
    assert(usersRoutes.includes("Order.aggregate"), "Admin users must aggregate order totals only for the visible page.");
    assert(!usersRoutes.includes("const orders = await Order.find({})"), "Admin users must not load all orders.");

    const walletRoutes = read("backend/routes/wallet.js");
    assert(walletRoutes.includes("applyCursorFilter(query, req.query.cursor)"), "Admin wallet topups must use cursor filtering.");
    assert(walletRoutes.includes("applyCursorFilter(filter, req.query.cursor)"), "Admin wallet transactions must use cursor filtering.");
    assert(walletRoutes.includes("transactions,"), "Admin wallet transactions must preserve legacy transactions key.");
    assert(walletRoutes.includes("topups,"), "Admin wallet topups must preserve legacy topups key.");

    const walletService = read("backend/services/walletService.js");
    assert(walletService.includes("applyCursorFilter(query, options.cursor)"), "Customer wallet timeline must use cursor filtering.");
    assert(walletService.includes("pagination"), "Customer wallet timeline must return pagination metadata.");

    const fulfillmentService = read("backend/services/fulfillmentService.js");
    assert(fulfillmentService.includes("parseLimit(query.limit, { defaultLimit: 50, maxLimit: 100 })"), "Fulfillment attempts must use bounded limits.");
    assert(fulfillmentService.includes("applyCursorFilter(filter, query.cursor)"), "Fulfillment attempts must use cursor filtering.");

    const supportRoutes = read("backend/routes/support.js");
    assert(supportRoutes.includes("parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 })"), "Support lists must use bounded limits.");
    assert(supportRoutes.includes("applyCursorFilter(query, req.query.cursor)"), "Admin support tickets must use cursor filtering.");

    const liveChatRoutes = read("backend/routes/liveChat.js");
    assert(liveChatRoutes.includes("parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 })"), "Admin live chat list must use bounded limits.");
    assert(liveChatRoutes.includes("messages.slice(-50)"), "Admin live chat list must not return unbounded embedded messages.");
    assert(liveChatRoutes.includes('router.get("/admin/:chatId/messages"'), "Admin live chat messages must expose a bounded history route.");
    assert(liveChatRoutes.includes("projectChatMessages"), "Live chat message history must have an explicit bounded projection.");
    assert(liveChatRoutes.includes("nextCursor"), "Admin live chat list must return pagination metadata.");

    const notificationService = read("backend/services/notificationService.js");
    assert(notificationService.includes("parseLimit(options.limit, { defaultLimit: 20, maxLimit: 50 })"), "Notifications must use bounded limits.");
    assert(notificationService.includes("applyCursorFilter(filter, cursor)"), "Notifications must accept deterministic cursors.");

    const auditService = read("backend/services/adminAuditService.js");
    assert(auditService.includes("parseLimit(query.limit, { defaultLimit: 25, maxLimit: 100 })"), "Admin audit logs must use bounded limits.");
    assert(auditService.includes("applyCursorFilter(filter, query.cursor)"), "Admin audit logs must use cursor filtering.");
}

function verifyIndexCoverage() {
    includes("backend/models/Order.js", "orderSchema.index({ createdAt: -1, _id: -1 })", "Orders must index default list sort.");
    includes("backend/models/Order.js", "orderSchema.index({ status: 1, createdAt: -1, _id: -1 })", "Orders must index status queues.");
    includes("backend/models/User.js", "userSchema.index({ createdAt: -1, _id: -1 })", "Users must index default list sort.");
    includes("backend/models/WalletTopup.js", "walletTopupSchema.index({ status: 1, createdAt: -1, _id: -1 })", "Wallet topups must index status queues.");
    includes("backend/models/WalletTransaction.js", "walletTransactionSchema.index({ username: 1, createdAt: -1, _id: -1 })", "Wallet transactions must index user timelines.");
    includes("backend/models/FulfillmentAttempt.js", "fulfillmentAttemptSchema.index({ status: 1, createdAt: -1, _id: -1 })", "Fulfillment attempts must index status queues.");
    includes("backend/models/AdminAuditLog.js", "adminAuditLogSchema.index({ createdAt: -1, _id: -1 })", "Audit logs must index default list sort.");
    includes("backend/models/SupportTicket.js", "supportTicketSchema.index({ status: 1, createdAt: -1, _id: -1 })", "Support tickets must index status queues.");
    includes("backend/models/LiveChat.js", "liveChatSchema.index({ status: 1, lastMessageAt: -1, _id: -1 })", "Live chat must index active chat queue.");
    includes("backend/models/Notification.js", "notificationSchema.index({ userId: 1, createdAt: -1, _id: -1 })", "Notifications must index user timelines.");
    assert(!read("backend/models/ManualPaymentAttempt.js").includes("expiresAt: {\n        type: Date,\n        index: true"), "ManualPaymentAttempt must not keep duplicate expiresAt index definitions.");
}

function verifyFrontendIncrementalLoading() {
    const ordersJs = read("frontend/js/admin-orders.js");
    assert(ordersJs.includes("adminOrdersPaging"), "Orders UI must own pagination state.");
    assert(ordersJs.includes("request.isCurrent()"), "Orders UI must guard stale responses.");
    assert(ordersJs.includes("adminOrdersRequestGate"), "Orders UI must use the shared request gate for request ownership.");
    assert(ordersJs.includes("coalesceKey"), "Orders UI must coalesce identical in-flight initial queries.");
    assert(ordersJs.includes("ordersLoadMoreBtn"), "Orders UI must expose Load More.");
    assert(ordersJs.includes("isSummary") && ordersJs.includes("refreshAdminOrderDetail"), "Orders summary rows must hydrate rich detail on selection.");

    const usersJs = read("frontend/js/admin-users.js");
    assert(usersJs.includes("adminUsersPaging"), "Users UI must own pagination state.");
    assert(usersJs.includes("adminUsersLoadMoreBtn"), "Users UI must expose Load More.");

    const walletJs = read("frontend/js/admin-wallet.js");
    assert(walletJs.includes("adminWalletPaging"), "Admin Wallet UI must own pagination state.");
    assert(walletJs.includes("walletTopupsLoadMoreBtn"), "Admin Wallet topups must expose Load More.");
    assert(walletJs.includes("cursorStack"), "Admin Wallet transactions must keep cursor history for previous navigation.");

    const fulfillmentJs = read("frontend/js/admin-fulfillment.js");
    assert(fulfillmentJs.includes("fulfillmentAttemptsLoadMoreBtn"), "Fulfillment attempts must expose Load More.");
    assert(fulfillmentJs.includes("mergeFulfillmentAttempts"), "Fulfillment attempts must merge pages without duplicates.");

    const accountWalletJs = read("frontend/js/wallet.js");
    assert(accountWalletJs.includes("walletHistoryPagination"), "Customer wallet history must store pagination metadata.");
    assert(accountWalletJs.includes("walletHistoryLoadMoreBtn"), "Customer wallet history must expose Load More.");

    const adminSecurityJs = read("frontend/js/admin-security.js");
    assert(adminSecurityJs.includes("adminAuditPaging"), "Audit log UI must own cursor pagination state.");
    assert(adminSecurityJs.includes("cursorStack"), "Audit log UI must preserve previous navigation.");

    const adminLiveChatJs = read("frontend/js/admin-live-chat.js");
    assert(adminLiveChatJs.includes("activeMessagePaging"), "Admin live chat must own message pagination state.");
    assert(adminLiveChatJs.includes("adminLiveChatLoadOlderBtn"), "Admin live chat must expose Load older messages.");
    assert(adminLiveChatJs.includes("mergeChatMessages"), "Admin live chat must dedupe paginated/realtime messages.");
}

function verifyNoUnsafeSearchOrScrollInterception() {
    matches("backend/routes/order.js", /orderId:\s*\{\s*\$regex:\s*`\^\$\{escaped\}`/, "Order search must use anchored escaped regex.");
    matches("backend/routes/adminUsers.js", /username:\s*\{\s*\$regex:\s*`\^\$\{escaped\}`/, "User search must use anchored escaped regex.");

    [
        "frontend/js/admin-orders.js",
        "frontend/js/admin-users.js",
        "frontend/js/admin-wallet.js",
        "frontend/js/admin-fulfillment.js",
        "frontend/js/admin-security.js"
    ].forEach(file => {
        assert(!read(file).includes("wheel"), `${file}: Phase 14 must not add JavaScript wheel interception.`);
    });
}

function main() {
    verifySharedPaginationService();
    verifyCursorBoundaryBehavior();
    verifyBackendListContracts();
    verifyIndexCoverage();
    verifyFrontendIncrementalLoading();
    verifyNoUnsafeSearchOrScrollInterception();
    console.log("Performance pagination verification checks passed.");
}

main();
