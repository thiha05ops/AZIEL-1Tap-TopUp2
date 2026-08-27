const express = require("express");
const passport = require("../config/passport");
const { issueUserSession } = require("../services/authSessionService");

const router = express.Router();

function googleConfigured(req, res, next) {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        return next();
    }

    return res.redirect(`${getFrontendUrl()}/login.html`);
}

function getFrontendUrl() {
    return (
        process.env.FRONTEND_URL ||
        process.env.CLIENT_URL ||
        "http://127.0.0.1:5500/frontend"
    ).replace(/\/$/, "");
}

router.get(
    "/auth/google",
    googleConfigured,
    passport.authenticate("google", {
        scope: ["profile", "email"],
        prompt: "consent select_account",
        session: false
    })
);

router.get(
    "/auth/google/callback",

    (req, res, next) => {
        console.log("Google callback request:", {
            method: req.method,
            path: req.path,
            host: req.get("host"),
            protocol: req.protocol,
            hasCode: Boolean(req.query.code),
            codeSuffix: req.query.code
                ? String(req.query.code).slice(-8)
                : null,
            error: req.query.error || null,
            userAgent: req.get("user-agent") || null
        });

        next();
    },

    googleConfigured,

    passport.authenticate("google", {
        failureRedirect: `${getFrontendUrl()}/login.html`,
        session: false
    }),

    async (req, res) => {
        try {
            if (!req.user) {
                return res.redirect(`${getFrontendUrl()}/login.html`);
            }

            const issued = await issueUserSession(req.user, req, {
                provider: "google",
                eventType: "google.login",
                eventTitle: "Google sign-in"
            });

            const params = new URLSearchParams({
                token: issued.token,
                username: req.user.username || "",
                displayName:
                    req.user.displayName ||
                    req.user.username ||
                    "",
                email: req.user.email || "",
                region: req.user.region || "MM",
                role: req.user.role || "user"
            });

            return res.redirect(
                `${getFrontendUrl()}/google-success.html?${params.toString()}`
            );
        } catch (error) {
            console.log(
                "Google callback error:",
                error?.message || error
            );

            return res.redirect(`${getFrontendUrl()}/login.html`);
        }
    }
);

module.exports = router;