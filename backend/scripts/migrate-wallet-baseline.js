const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config({
    path: path.join(__dirname, "../../.env")
});

const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const { reconcileWallet, normalizeCurrency } = require("../services/walletService");

const APPLY = process.argv.includes("--apply");
const usernameArg = process.argv.find(arg => arg.startsWith("--username="));
const currencyArg = process.argv.find(arg => arg.startsWith("--currency="));
const usernameFilter = usernameArg ? usernameArg.split("=").slice(1).join("=").trim() : "";
const currencyFilter = currencyArg ? [normalizeCurrency(currencyArg.split("=").slice(1).join("="))] : ["MMK", "THB"];

function idempotencyKey(userId, currency) {
    return `wallet:migration:${userId}:${currency}:v1`;
}

function migrationReference(username, currency) {
    return `${username}:${currency}`;
}

async function canonicalMovement(username, currency) {
    const transactions = await WalletTransaction.find({
        username,
        currency,
        status: { $in: ["committed", "completed"] },
        direction: { $in: ["credit", "debit"] },
        idempotencyKey: { $exists: true, $ne: "" },
        source: { $exists: true, $ne: "legacy" },
        type: { $ne: "wallet.migration" }
    }).lean();

    return transactions.reduce((sum, item) => (
        item.direction === "debit"
            ? sum - Number(item.amount || 0)
            : sum + Number(item.amount || 0)
    ), 0);
}

async function buildPlan(user, currency) {
    const existingMigration = await WalletTransaction.findOne({
        username: user.username,
        currency,
        type: "wallet.migration",
        idempotencyKey: idempotencyKey(user._id, currency)
    }).lean();

    const storedBalance = Number(user.wallet?.[currency] || 0);
    const movement = await canonicalMovement(user.username, currency);
    const proposedBaseline = storedBalance - movement;
    const expectedBalance = proposedBaseline + movement;
    const currentReconciliation = await reconcileWallet(user.username, currency);

    return {
        username: user.username,
        userId: String(user._id),
        currency,
        storedBalance,
        canonicalNetMovement: movement,
        proposedBaseline,
        expectedBalance,
        differenceAfterBaseline: storedBalance - expectedBalance,
        existingMigration: Boolean(existingMigration),
        currentStatus: currentReconciliation.status,
        action: existingMigration
            ? "skip_existing"
            : Math.abs(proposedBaseline) < 0.000001
                ? "skip_zero_baseline"
                : proposedBaseline < 0
                    ? "skip_negative_baseline"
                    : "create_baseline"
    };
}

async function applyPlan(plan) {
    if (plan.action !== "create_baseline") return null;

    try {
        return await WalletTransaction.create({
            transactionId: `WMIG-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
            username: plan.username,
            type: "wallet.migration",
            direction: "credit",
            amount: plan.proposedBaseline,
            currency: plan.currency,
            status: "committed",
            balanceBefore: 0,
            balanceAfter: plan.proposedBaseline,
            source: "legacy_migration",
            referenceType: "wallet_migration",
            referenceId: migrationReference(plan.username, plan.currency),
            idempotencyKey: idempotencyKey(plan.userId, plan.currency),
            description: "Opening wallet balance",
            performedBy: "system",
            metadata: {
                migrationVersion: "v1",
                storedBalanceAtMigration: plan.storedBalance,
                canonicalNetMovementAtMigration: plan.canonicalNetMovement
            }
        });
    } catch (error) {
        if (error?.code === 11000) return null;
        throw error;
    }
}

async function main() {
    if (!process.env.MONGO_URI) {
        console.error("MONGO_URI is required for wallet baseline migration.");
        process.exitCode = 1;
        return;
    }

    await mongoose.connect(process.env.MONGO_URI);

    const users = usernameFilter
        ? await User.find({ username: usernameFilter }).select("username wallet")
        : await User.find().select("username wallet").limit(1000);

    const plans = [];

    for (const user of users) {
        for (const currency of currencyFilter) {
            plans.push(await buildPlan(user, currency));
        }
    }

    console.log(APPLY ? "Wallet baseline migration APPLY mode" : "Wallet baseline migration dry run");
    console.log("No User.wallet balances will be modified.");

    plans.forEach(plan => {
        console.log(
            [
                plan.action.toUpperCase(),
                plan.username,
                plan.currency,
                `stored=${plan.storedBalance}`,
                `canonicalNet=${plan.canonicalNetMovement}`,
                `baseline=${plan.proposedBaseline}`,
                `expected=${plan.expectedBalance}`,
                `diffAfter=${plan.differenceAfterBaseline}`,
                `currentStatus=${plan.currentStatus}`
            ].join(" ")
        );
    });

    if (!APPLY) return;

    const created = [];

    for (const plan of plans) {
        const entry = await applyPlan(plan);
        if (entry) created.push(entry);
    }

    console.log(`Created ${created.length} wallet migration baseline entr${created.length === 1 ? "y" : "ies"}.`);
}

main()
    .catch(error => {
        console.error("Wallet baseline migration failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
