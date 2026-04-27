const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
    {
        username: String,
        userId: String,
        serverId: String,
        packageName: String,
        paymentMethod: String,
        status: {
            type: String,
            default: "Pending"
        },
        note: {
            type: String,
            default: ""
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
// backend/routes/order.js

const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const filePath = path.join(__dirname, "../data/orders.json");

// create file if not exist
if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]");
}

// POST /api/order
router.post("/", (req, res) => {

    const { game, userId, zoneId, packageName, username } = req.body;

    if (!game || !userId || !packageName) {
        return res.json({
            success: false,
            message: "Missing data"
        });
    }

    const orders = JSON.parse(fs.readFileSync(filePath));

    const newOrder = {
        id: Date.now(),
        username: username || "guest",
        game,
        userId,
        zoneId: zoneId || "",
        packageName,
        status: "pending",
        time: new Date().toLocaleString()
    };

    orders.push(newOrder);

    fs.writeFileSync(filePath, JSON.stringify(orders, null, 2));

    res.json({
        success: true,
        message: "Order success",
        order: newOrder
    });

});

module.exports = router;