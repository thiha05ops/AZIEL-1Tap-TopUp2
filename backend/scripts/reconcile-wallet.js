const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config({
    path: path.join(__dirname, "../../.env")
});

const User = require("../models/User");
const { reconcileWallet } = require("../services/walletService");

async function main() {
    const usernameArg = process.argv.find(arg => arg.startsWith("--username="));
    const currencyArg = process.argv.find(arg => arg.startsWith("--currency="));
    const username = usernameArg ? usernameArg.split("=").slice(1).join("=").trim() : "";
    const currencies = currencyArg
        ? [currencyArg.split("=").slice(1).join("=").trim().toUpperCase()]
        : ["MMK", "THB"];

    if (!process.env.MONGO_URI) {
        console.error("MONGO_URI is required for wallet reconciliation.");
        process.exitCode = 1;
        return;
    }

    await mongoose.connect(process.env.MONGO_URI);

    const users = username
        ? await User.find({ username }).select("username wallet")
        : await User.find().select("username wallet").limit(500);

    if (!users.length) {
        console.log("No users found for reconciliation.");
        return;
    }

    const results = [];

    for (const user of users) {
        for (const currency of currencies) {
            results.push(await reconcileWallet(user.username, currency));
        }
    }

    const mismatches = results.filter(result => !result.matches);

    results.forEach(result => {
        console.log(
            [
                result.status,
                result.username,
                result.currency,
                `stored=${result.storedBalance}`,
                `opening=${result.openingBaseline}`,
                `credits=${result.canonicalCredits}`,
                `debits=${result.canonicalDebits}`,
                `expected=${result.expectedBalance}`,
                `diff=${result.difference}`,
                `canonical=${result.canonicalCount}`,
                `legacy=${result.legacyCount}`,
                `migrations=${result.migrationCount}`
            ].join(" ")
        );
    });

    if (mismatches.length) {
        console.error(`Wallet reconciliation found ${mismatches.length} mismatch(es).`);
        process.exitCode = 1;
    } else {
        console.log("Wallet reconciliation passed.");
    }
}

main()
    .catch(error => {
        console.error("Wallet reconciliation failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
