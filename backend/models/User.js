// backend/models/User.js

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({

    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },

    email: {
        type: String,
        default: "",
        trim: true
    },

    password: {
        type: String,
        required: true
    },

    displayName: {
        type: String,
        default: ""
    },

    region: {
        type: String,
        default: "MM"
    },

    walletBalance: {
        type: Number,
        default: 0
    },
    wallet: {
        MMK: {
            type: Number,
            default: 0
        },
        THB: {
            type: Number,
            default: 0
        }
    },

    avatar: {
        type: String,
        default: ""
    },

    role: {
        type: String,
        enum: ["user", "admin"],
        default: "user"
    },

    isVerified: {
        type: Boolean,
        default: false
    }

}, {
    timestamps: true
});

module.exports = mongoose.model(
    "User",
    userSchema
);