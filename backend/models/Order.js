const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true },
    username: { type: String, default: "guest" },
    game: { type: String, required: true },
    userId: { type: String, required: true },
    zoneId: { type: String, default: "" },
    packageName: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "MMK" },
    region: { type: String, default: "MM" },
    paymentMethod: { type: String, required: true },
    status: { type: String, default: "pending_payment" }
}, { timestamps: true });

module.exports = mongoose.model("Order", orderSchema);