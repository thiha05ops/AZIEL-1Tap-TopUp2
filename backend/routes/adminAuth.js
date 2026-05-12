const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();

const ADMIN_USERNAME =
    process.env.ADMIN_USERNAME || "admin";

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || "AZIEL2026";

const JWT_SECRET =
    process.env.JWT_SECRET || "aziel_jwt_secret";


// ============================
// ADMIN LOGIN
// POST /api/admin/login
// ============================

router.post("/admin/login", async (req, res) => {

    try {

        const {
            username,
            password
        } = req.body;

        if (
            username !== ADMIN_USERNAME ||
            password !== ADMIN_PASSWORD
        ) {

            return res.status(401).json({
                success: false,
                message:
                    "Wrong admin username or password"
            });

        }

        const token = jwt.sign(

            {
                role: "admin"
            },

            JWT_SECRET,

            {
                expiresIn: "7d"
            }

        );

        res.json({

            success: true,

            token

        });

    } catch (error) {

        console.log(
            "Admin login error:",
            error
        );

        res.status(500).json({

            success: false,

            message: "Server error"

        });

    }

});

module.exports = router;