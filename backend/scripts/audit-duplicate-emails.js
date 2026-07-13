const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const Order = require("../models/Order");
const Session = require("../models/Session");
const User = require("../models/User");

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function walletSummary(wallet = {}) {
    return {
        MMK: Number(wallet.MMK || 0),
        THB: Number(wallet.THB || 0)
    };
}

async function userSummary(user) {
    const [orderCount, sessionCount] = await Promise.all([
        Order.countDocuments({ username: user.username }),
        Session.countDocuments({ userId: user._id })
    ]);

    return {
        username: user.username,
        email: normalizeEmail(user.email),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        emailVerified: Boolean(user.emailVerified),
        isVerified: Boolean(user.isVerified),
        authProvider: user.authProvider || "local",
        hasGoogleId: Boolean(user.googleId),
        orderCount,
        wallet: walletSummary(user.wallet),
        sessionCount
    };
}

function classifyGroup(users) {
    const providers = new Set(users.map(user => user.authProvider || "local"));
    const hasGoogle = users.some(user => user.hasGoogleId);
    const hasOrdersOrWallet = users.some(user => (
        user.orderCount > 0 ||
        Number(user.wallet.MMK || 0) !== 0 ||
        Number(user.wallet.THB || 0) !== 0
    ));

    if (hasGoogle || providers.size > 1) return "GOOGLE_OR_LOCAL_LINKING_ARTIFACT_POSSIBLE";
    if (!hasOrdersOrWallet) return "AMBIGUOUS_LOW_ACTIVITY_DUPLICATE";
    return "GENUINELY_AMBIGUOUS";
}

async function runAudit() {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is required for duplicate email audit.");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const groups = await User.aggregate([
        {
            $project: {
                email: { $toLower: { $trim: { input: { $ifNull: ["$email", ""] } } } }
            }
        },
        { $match: { email: { $ne: "" } } },
        {
            $group: {
                _id: "$email",
                count: { $sum: 1 }
            }
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1, _id: 1 } }
    ]);

    const duplicateGroups = [];

    for (const group of groups) {
        const users = await User.find({
            email: new RegExp(`^${group._id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
        }).select("username email createdAt updatedAt emailVerified isVerified authProvider googleId wallet").lean();

        const summaries = [];
        for (const user of users) {
            summaries.push(await userSummary(user));
        }

        duplicateGroups.push({
            email: group._id,
            count: group.count,
            classification: classifyGroup(summaries),
            users: summaries
        });
    }

    const affectedUserCount = duplicateGroups.reduce((sum, group) => sum + group.count, 0);

    const result = {
        duplicateGroupCount: duplicateGroups.length,
        affectedUserCount,
        duplicateGroups,
        remediation: duplicateGroups.length
            ? "Review each group. Use repair:duplicate-email with --email, --detach-username and --apply only after choosing the account to detach."
            : "No duplicate non-empty normalized emails found."
    };

    console.log(JSON.stringify(result, null, 2));
    await mongoose.disconnect();
    return result;
}

runAudit().catch(async error => {
    console.error("Duplicate email audit failed:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
