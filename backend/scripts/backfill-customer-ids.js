require("dotenv").config();

const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/User");

const APPLY = process.argv.includes("--apply");
const CUSTOMER_ID_PATTERN = /^AZU-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;

function generateCustomerId() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.randomBytes(10);

    let value = "";

    for (let index = 0; index < 10; index += 1) {
        value += alphabet[bytes[index] % alphabet.length];
    }

    return `AZU-${value}`;
}

async function generateUniqueCustomerId() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const customerId = generateCustomerId();

        const exists = await User.exists({ customerId });

        if (!exists) {
            return customerId;
        }
    }

    throw new Error("Unable to generate unique customerId after 50 attempts");
}

async function main() {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is not configured");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const missingQuery = {
        $or: [
            { customerId: { $exists: false } },
            { customerId: null },
            { customerId: "" }
        ]
    };

    const users = await User.find(missingQuery)
        .select("_id username customerId")
        .sort({ createdAt: 1, _id: 1 })
        .lean();

    console.log("===== AZIEL CUSTOMER ID BACKFILL =====");
    console.log("Mode:", APPLY ? "APPLY" : "DRY RUN");
    console.log("Users missing customerId:", users.length);
    console.log("");

    let updated = 0;

    for (const user of users) {
        const customerId = await generateUniqueCustomerId();

        console.log(
            `${String(user._id)} | ${user.username} | ${customerId}`
        );

        if (!APPLY) {
            continue;
        }

        const result = await User.collection.updateOne(
            {
                _id: user._id,
                $or: [
                    { customerId: { $exists: false } },
                    { customerId: null },
                    { customerId: "" }
                ]
            },
            {
                $set: { customerId }
            }
        );

        if (result.modifiedCount !== 1) {
            throw new Error(
                `Backfill CAS failed for user ${String(user._id)}`
            );
        }

        updated += 1;
    }

    if (!APPLY) {
        console.log("");
        console.log("DRY RUN ONLY — no database writes performed.");
        return;
    }

    const remaining = await User.countDocuments(missingQuery);

    const invalid = await User.find({
        customerId: { $exists: true, $nin: [null, ""] }
    })
        .select("_id customerId")
        .lean();

    const malformed = invalid.filter(
        user => !CUSTOMER_ID_PATTERN.test(String(user.customerId || ""))
    );

    const duplicates = await User.aggregate([
        {
            $match: {
                customerId: {
                    $type: "string",
                    $ne: ""
                }
            }
        },
        {
            $group: {
                _id: "$customerId",
                count: { $sum: 1 }
            }
        },
        {
            $match: {
                count: { $gt: 1 }
            }
        }
    ]);

    console.log("");
    console.log("===== VERIFICATION =====");
    console.log("Updated:", updated);
    console.log("Remaining missing:", remaining);
    console.log("Malformed IDs:", malformed.length);
    console.log("Duplicate IDs:", duplicates.length);

    if (remaining !== 0 || malformed.length !== 0 || duplicates.length !== 0) {
        throw new Error("Customer ID backfill verification failed");
    }

    await User.collection.createIndex(
        { customerId: 1 },
        {
            unique: true,
            partialFilterExpression: {
                customerId: { $type: "string" }
            },
            name: "customerId_1"
        }
    );

    console.log("Unique customerId index: ensured");
    console.log("BACKFILL PASSED");
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
