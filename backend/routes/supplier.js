const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const adminMiddleware = require("../middleware/adminMiddleware");
const { ORDER_STATES, transitionOrder } = require("../services/orderStateService");

// POST /api/supplier/mock-topup/:id
router.post("/supplier/mock-topup/:id", adminMiddleware, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.json({ success: false, message: "Order not found" });
        }

        const processing = await transitionOrder(order, ORDER_STATES.PROCESSING, {
            source: "admin",
            actorType: "admin",
            actor: req.admin?.username || req.user?.username || "admin",
            reason: "Mock supplier top-up started",
            idempotencyKey: `supplier:mock:processing:${order.orderId}`
        });

        // Step 2: simulate delay
        setTimeout(async () => {
            try {
                await transitionOrder(processing.order, ORDER_STATES.COMPLETED, {
                    source: "admin",
                    actorType: "admin",
                    actor: req.admin?.username || req.user?.username || "admin",
                    reason: "Mock supplier top-up completed",
                    idempotencyKey: `supplier:mock:completed:${order.orderId}`
                });
                console.log("Auto topup completed:", order.orderId);
            } catch (error) {
                console.log("Auto topup completion skipped:", error.message);
            }
        }, 3000);

        res.json({ success: true, message: "TopUp started" });

    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

module.exports = router;
