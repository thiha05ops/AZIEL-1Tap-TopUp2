const express = require("express");
const jwt = require("jsonwebtoken");
const passport = require("../config/passport");

const router = express.Router();

router.get(
    "/auth/google",
    passport.authenticate("google", {
        scope: ["profile", "email"],
        prompt: "consent select_account",
        session: false
    })
);

router.get(
    "/auth/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/login.html",
        session: false
    }),
    (req, res) => {
        const token = jwt.sign(
            {
                id: req.user._id,
                username: req.user.username,
                role: req.user.role || "user"
            },
            process.env.JWT_SECRET,
            { expiresIn: "15d" }
        );

        const frontendUrl =
            process.env.FRONTEND_URL ||
            "https://aziel-1tap-topup2.onrender.com";

        const params = new URLSearchParams({
            token,
            username: req.user.username || "",
            displayName: req.user.displayName || req.user.username || "",
            email: req.user.email || "",
            region: req.user.region || "MM",
            role: req.user.role || "user"
        });

        res.redirect(`${frontendUrl}/google-success.html?${params.toString()}`);
    }
);

module.exports = router;