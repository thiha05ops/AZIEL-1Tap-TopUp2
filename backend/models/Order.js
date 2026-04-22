const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
    {
        username: String,
        userId: String,
        serverId: String,
        packageName: String,
        status: {
            type: String,
            default: "Pending"
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);