const express = require("express");
const jwt = require("jsonwebtoken");
const passport = require("../config/passport");

const router = express.Router();

router.get(
    "/auth/google",
    passport.authenticate("google", {
        scope: ["profile", "email"],
    })
);

router.get(
    "/auth/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/login.html",
    }),
    (req, res) => {
        const token = jwt.sign(
            { id: req.user._id, username: req.user.username },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.redirect(
            `/google-success.html?token=${token}&username=${encodeURIComponent(req.user.username)}`
        );
    }
);

module.exports = router;