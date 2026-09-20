"use strict";

const path = require("path");

const FRONTEND_ROOT = path.resolve(__dirname, "../../frontend");

const PAGE_ROUTES = Object.freeze([
    ["/", "home.html", "public"],
    ["/explore", "explore.html", "public"],
    ["/mobile-games", "mobile-games.html", "public"],
    ["/pc-games", "pc-games.html", "public"],
    ["/gift-cards", "gift-cards.html", "public"],
    ["/social-topup", "social-topup.html", "public"],
    ["/entertainment", "entertainment.html", "public"],
    ["/mobile-recharge", "mobile-recharge.html", "public"],
    ["/about", "about.html", "public"],
    ["/contact", "contact.html", "public"],
    ["/faq", "faq.html", "public"],
    ["/help", "help.html", "public"],
    ["/coming-soon", "coming-soon.html", "public"],
    ["/live-chat", "live-chat.html", "customer"],
    ["/support", "support.html", "customer"],
    ["/login", "login.html", "auth"],
    ["/register", "register.html", "auth"],
    ["/forgot-password", "forgot-password.html", "auth"],
    ["/verify-email", "verify-email.html", "auth"],
    ["/verify-otp", "verify-otp.html", "auth"],
    ["/reset-password", "reset-password.html", "auth"],
    ["/auth/google/success", "google-success.html", "auth"],
    ["/account", "account.html", "customer"],
    ["/wallet", "wallet.html", "customer"],
    ["/orders", "tracking.html", "customer"],
    ["/notifications", "notifications.html", "customer"],
    ["/checkout", "checkout.html", "commerce"],
    ["/payment-method", "payment-method.html", "commerce"],
    ["/payment", "payment.html", "commerce"],
    ["/policies/privacy", "policies/privacy.html", "legal"],
    ["/policies/terms", "policies/terms.html", "legal"],
    ["/policies/payment", "policies/payment.html", "legal"],
    ["/policies/refund", "policies/refund.html", "legal"],
    ["/policies/support", "policies/support.html", "legal"],
    ["/games/mlbb", "mlbb.html", "product"],
    ["/games/pubg", "pubg.html", "product"],
    ["/games/freefire", "freefire.html", "product"],
    ["/games/hok", "hok.html", "product"],
    ["/games/pubg-rp", "pubg-rp.html", "product"],
    ["/games/aov-id", "aov-id.html", "product"],
    ["/games/genshin", "genshin.html", "product"],
    ["/games/roblox", "roblox.html", "product"],
    ["/products/telegram", "telegram.html", "product"]
].map(([route, file, group]) => Object.freeze({ route, file, group })));

const LEGACY_ALIASES = Object.freeze({
    "/home.html": "/",
    "/all-games.html": "/explore",
    "/explore.html": "/explore",
    "/mobile-games.html": "/mobile-games",
    "/pc-games.html": "/pc-games",
    "/gift-cards.html": "/gift-cards",
    "/social-topup.html": "/social-topup",
    "/entertainment.html": "/entertainment",
    "/mobile-recharge.html": "/mobile-recharge",
    "/about.html": "/about",
    "/contact.html": "/contact",
    "/faq.html": "/faq",
    "/help.html": "/help",
    "/coming-soon.html": "/coming-soon",
    "/live-chat.html": "/live-chat",
    "/support.html": "/support",
    "/login.html": "/login",
    "/register.html": "/register",
    "/forgot-password.html": "/forgot-password",
    "/verify-email.html": "/verify-email",
    "/verify-otp.html": "/verify-otp",
    "/reset-password.html": "/reset-password",
    "/google-success.html": "/auth/google/success",
    "/account.html": "/account",
    "/wallet.html": "/wallet",
    "/tracking.html": "/orders",
    "/notifications.html": "/notifications",
    "/checkout.html": "/checkout",
    "/payment-method.html": "/payment-method",
    "/payment.html": "/payment",
    "/policies/privacy.html": "/policies/privacy",
    "/policies/terms.html": "/policies/terms",
    "/policies/payment.html": "/policies/payment",
    "/policies/refund.html": "/policies/refund",
    "/policies/support.html": "/policies/support",
    "/mlbb.html": "/games/mlbb",
    "/pubg.html": "/games/pubg",
    "/freefire.html": "/games/freefire",
    "/hok.html": "/games/hok",
    "/pubg-rp.html": "/games/pubg-rp",
    "/aov-id.html": "/games/aov-id",
    "/genshin.html": "/games/genshin",
    "/roblox.html": "/games/roblox",
    "/telegram.html": "/products/telegram"
});

const PRODUCT_RENDERERS = Object.freeze({
    "mlbb-twilight-weekly-pass": "mlbb.html",
    "freefire-pass-membership": "freefire.html"
});

function preserveQuery(req, destination, omitted = []) {
    const params = new URLSearchParams();
    Object.entries(req.query || {}).forEach(([key, value]) => {
        if (omitted.includes(key)) return;
        (Array.isArray(value) ? value : [value]).forEach(item => params.append(key, String(item)));
    });
    const query = params.toString();
    return query ? `${destination}?${query}` : destination;
}

function frontendFile(file) {
    return path.join(FRONTEND_ROOT, file);
}

module.exports = Object.freeze({ FRONTEND_ROOT, LEGACY_ALIASES, PAGE_ROUTES, PRODUCT_RENDERERS, frontendFile, preserveQuery });
