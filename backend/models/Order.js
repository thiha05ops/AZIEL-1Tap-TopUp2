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