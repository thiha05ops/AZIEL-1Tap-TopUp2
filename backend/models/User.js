const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(

    {
        email: { type: String, default: "" },
        googleId: { type: String, default: "" },
        authProvider: { type: String, default: "local" },
        resetToken: { type: String, default: "" },
        resetTokenExpire: { type: Date },
        username: {
            type: String,
            required: true,
            trim: true,
            unique: true
        },
        password: {
            type: String,
            required: true
        },
        displayName: {
            type: String,
            default: ""
        },
        telegram: {
            type: String,
            default: ""
        },
        phone: {
            type: String,
            default: ""
        },
        region: {
            type: String,
            default: "MM"
        },
        mlbbUserId: {
            type: String,
            default: ""
        },
        mlbbServerId: {
            type: String,
            default: ""
        },
        photo: {
            type: String,
            default: ""
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
