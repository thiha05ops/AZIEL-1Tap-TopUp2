// backend/config/passport.js

const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const User = require("../models/User");
const { fingerprint, logGoogleOAuthDiagnostic } = require("../utils/googleOAuthDiagnostics");

async function makeUniqueUsername(email, displayName) {
    const emailName = String(email || "")
        .split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");

    const nameBase = String(displayName || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");

    let base = emailName || nameBase || "googleuser";

    if (base.length < 3) {
        base = `user${base}`;
    }

    let username = base;
    let count = 1;

    while (await User.findOne({ username })) {
        username = `${base}${count}`;
        count++;
    }

    return username;
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL:
                    process.env.GOOGLE_CALLBACK_URL ||
                    "/api/auth/google/callback",
                passReqToCallback: true
            },
            async (req, accessToken, refreshToken, profile, done) => {
                let googleOAuthStage = "profile";
                try {
                    const diagnostic = req.googleOAuthDiagnostic || {};
                    logGoogleOAuthDiagnostic(console, "GOOGLE_OAUTH_PROFILE_RECEIVED", { ...diagnostic, profileTag: fingerprint(profile?.id) });
                    const email =
                        profile.emails?.[0]?.value?.toLowerCase() || "";

                    if (!email) {
                        return done(null, false);
                    }

                    googleOAuthStage = "user_resolution";
                    let user =
                        await User.findOne({ googleId: profile.id }) ||
                        await User.findOne({ email });

                    const created = !user;
                    const previouslyLinked = Boolean(user?.googleId);
                    if (!user) {
                        const username = await makeUniqueUsername(
                            email,
                            profile.displayName
                        );

                        const hashedPassword = await bcrypt.hash(
                            crypto.randomBytes(24).toString("hex"),
                            10
                        );

                        user = await User.create({
                            username,
                            email,
                            googleId: profile.id,
                            displayName: profile.displayName || username,
                            photo: profile.photos?.[0]?.value || "",
                            password: hashedPassword,
                            authProvider: "google",
                            isVerified: true,
                            emailVerified: true,
                            emailVerifiedAt: new Date(),
                            region: "MM",
                            wallet: {
                                MMK: 0,
                                THB: 0
                            },
                            currentSessionToken: "",
                            sessionUpdatedAt: null,
                            lastActiveAt: new Date()
                        });
                    } else {
                        user.googleId = user.googleId || profile.id;
                        user.authProvider = user.authProvider === "local" ? "hybrid" : (user.authProvider || "google");
                        user.emailVerified = true;
                        user.isVerified = true;
                        user.emailVerifiedAt = user.emailVerifiedAt || new Date();
                        user.lastActiveAt = new Date();

                        await user.save();
                    }

                    logGoogleOAuthDiagnostic(console, "GOOGLE_OAUTH_USER_RESOLVED", { ...diagnostic, userTag: fingerprint(user?._id), created, linked: previouslyLinked || Boolean(user?.googleId) });

                    return done(null, user);
                } catch (error) {
                    try { error.googleOAuthStage = googleOAuthStage; } catch (_) { /* Diagnostic annotation only. */ }
                    return done(error, null);
                }
            }
        )
    );
}

module.exports = passport;
