const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function includes(relativePath, needle, message) {
    assert.ok(read(relativePath).includes(needle), message || `${relativePath} must include ${needle}`);
}

function matches(relativePath, pattern, message) {
    assert.ok(pattern.test(read(relativePath)), message || `${relativePath} must match ${pattern}`);
}

includes("backend/models/PromoCode.js", "discountType", "PromoCode model must own discount type.");
includes("backend/models/PromoCode.js", "eligiblePackages", "PromoCode model must support package eligibility.");
includes("backend/models/PromoRedemption.js", "RESERVED", "PromoRedemption must track reserved state.");
includes("backend/models/PromoUsageState.js", "reservedCount", "Promo usage state must track reservations.");

includes("backend/services/promoCodeService.js", "resolveOrderCatalog", "Promo service must resolve catalog truth before discounting.");
includes("backend/services/commerce/promotionResolver.js", "INTERNAL_PRECISION = 6", "Promo discounts must use Commerce precision.");
includes("backend/services/promoCodeService.js", "reservePromoUse", "Promo service must own reservation logic.");
includes("backend/services/promoCodeService.js", "consumePromoRedemption", "Promo service must own consumption logic.");
includes("backend/services/promoCodeService.js", "releasePromoRedemption", "Promo service must own release logic.");

includes("backend/routes/promos.js", '"/promos/quote"', "Customer quote API must exist.");
includes("backend/routes/promos.js", '"/admin/promos"', "Admin promo API must exist.");
includes("backend/server.js", "promoRoutes", "Promo routes must be mounted.");

includes("backend/models/Order.js", "promoSnapshot", "Order must store immutable promo snapshot.");
includes("backend/models/Order.js", "originalAmount", "Order must store original amount.");
includes("backend/models/Order.js", "discountAmount", "Order must store discount amount.");
includes("backend/models/ManualPaymentAttempt.js", "promoRedemptionId", "Manual attempts must lock promo reservation.");

includes("backend/routes/payment.js", "resolvePurchasePricing", "Payment create/manual attempts must use promo pricing.");
includes("backend/routes/payment.js", "reservePromoUse", "Payment routes must reserve promo capacity.");
includes("backend/routes/payment.js", "consumePromoRedemption", "Payment routes must consume promo redemptions.");
includes("backend/routes/wallet.js", "resolvePurchasePricing", "Wallet pay must use promo pricing.");
includes("backend/services/commerce/customerWalletCheckoutService.js", "walletService", "Wallet debit must remain centralized through walletService.");

includes("frontend/js/game-flow.js", "/api/promos/quote", "Shared game flow must quote promos server-side.");
includes("frontend/js/game-flow.js", "promoCode:", "Shared game flow must send promo code intent only.");
includes("frontend/css/game/game.css", ".aziel-promo-box", "Shared game CSS must style promo apply UI.");

includes("frontend/admin.html", 'data-section="promos"', "Admin nav must expose Promo Codes.");
includes("frontend/admin.html", "admin-promos.js", "Admin page must load promo controller.");
includes("frontend/js/admin-app.js", "promos:", "Admin shell must register promo section.");
includes("frontend/js/admin-promos.js", "/api/admin/promos", "Admin promo controller must call promo API.");
includes("frontend/lang/admin/en.js", "promo_codes", "English admin i18n must include promo labels.");
includes("frontend/lang/admin/my.js", "promo_codes", "Myanmar admin i18n must include promo labels.");

matches("backend/services/promoCodeService.js", /discountAmount\s*=\s*Math\.min\([^;]+originalAmount/s, "Discount must not exceed original amount.");

console.log("✅ Admin Promo Code Phase 10 verifier passed.");
