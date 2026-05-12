const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
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

        photo: {
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

        role: {
            type: String,
            default: "user"
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("User", userSchema);