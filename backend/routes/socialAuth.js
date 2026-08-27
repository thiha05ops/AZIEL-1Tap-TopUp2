const express = require("express");
const crypto = require("crypto");
const passport = require("../config/passport");
const { issueUserSession } = require("../services/authSessionService");

const router = express.Router();

const googleCallbackFlights = new Map();
const GOOGLE_CALLBACK_RESULT_TTL_MS = 15_000;

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

function hashAuthorizationCode(code) {
    return crypto
        .createHash("sha256")
        .update(String(code))
        .digest("hex");
}

function authenticateGoogleCallback(req, res) {
    return new Promise((resolve, reject) => {
        const middleware = passport.authenticate(
            "google",
            {
                session: false
            },
            (error, user, info) => {
                if (error) {
                    return reject(error);
                }

                return resolve({
                    user: user || null,
                    info: info || null
                });
            }
        );

        middleware(req, res, error => {
            if (error) {
                reject(error);
            }
        });
    });
}

async function completeGoogleCallback(req, res) {
    const { user } = await authenticateGoogleCallback(req, res);

    if (!user) {
        return `${getFrontendUrl()}/login.html`;
    }

    const issued = await issueUserSession(user, req, {
        provider: "google",
        eventType: "google.login",
        eventTitle: "Google sign-in"
    });

    const params = new URLSearchParams({
        token: issued.token,
        username: user.username || "",
        displayName: user.displayName || user.username || "",
        email: user.email || "",
        region: user.region || "MM",
        role: user.role || "user"
    });

    return `${getFrontendUrl()}/google-success.html?${params.toString()}`;
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
    googleConfigured,
    async (req, res) => {
        const authorizationCode = String(req.query.code || "").trim();

        if (!authorizationCode) {
            return res.redirect(`${getFrontendUrl()}/login.html`);
        }

        const callbackKey = hashAuthorizationCode(authorizationCode);

        let flight = googleCallbackFlights.get(callbackKey);

        if (!flight) {
            flight = {
                promise: completeGoogleCallback(req, res)
            };

            googleCallbackFlights.set(callbackKey, flight);

            const cleanupTimer = setTimeout(() => {
                if (googleCallbackFlights.get(callbackKey) === flight) {
                    googleCallbackFlights.delete(callbackKey);
                }
            }, GOOGLE_CALLBACK_RESULT_TTL_MS);

            if (typeof cleanupTimer.unref === "function") {
                cleanupTimer.unref();
            }
        }

        try {
            const redirectUrl = await flight.promise;
            return res.redirect(redirectUrl);
        } catch (error) {
            console.log(
                "Google callback error:",
                error?.code ||
                error?.message ||
                "unknown_google_oauth_error"
            );

            return res.redirect(`${getFrontendUrl()}/login.html`);
        }
    }
);

module.exports = router;