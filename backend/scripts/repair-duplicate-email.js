const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const User = require("../models/User");

function parseArgs(argv) {
    return argv.reduce((acc, item) => {
        if (item === "--apply") {
            acc.apply = true;
            return acc;
        }

        const match = item.match(/^--([^=]+)=(.*)$/);
        if (match) {
            acc[match[1]] = match[2];
        }

        return acc;
    }, { apply: false });
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

async function main() {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is required for duplicate email repair.");
    }

    const args = parseArgs(process.argv.slice(2));
    const email = normalizeEmail(args.email);
    const detachUsername = String(args["detach-username"] || "").trim();
    const keepUsername = String(args["keep-username"] || "").trim();

    if (!email || !detachUsername || !keepUsername) {
        throw new Error("Required arguments: --email=<email> --keep-username=<username> --detach-username=<username> [--apply]");
    }

    if (detachUsername === keepUsername) {
        throw new Error("keep-username and detach-username must be different.");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const users = await User.find({
        email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
    }).select("username email createdAt updatedAt emailVerified isVerified authProvider googleId wallet").lean();

    const keep = users.find(user => user.username === keepUsername);
    const detach = users.find(user => user.username === detachUsername);

    if (!keep || !detach) {
        throw new Error("Both selected users must currently share the provided email.");
    }

    const output = {
        mode: args.apply ? "apply" : "dry-run",
        email,
        keep: {
            username: keep.username,
            email: normalizeEmail(keep.email)
        },
        detach: {
            username: detach.username,
            beforeEmail: normalizeEmail(detach.email),
            afterEmail: "",
            hasGoogleId: Boolean(detach.googleId),
            walletPreserved: true,
            ordersPreserved: true,
            userDeleted: false
        }
    };

    if (!args.apply) {
        output.message = "Dry run only. No data was modified. Add --apply to detach the selected user's email.";
        console.log(JSON.stringify(output, null, 2));
        await mongoose.disconnect();
        return;
    }

    await User.updateOne(
        {
            _id: detach._id,
            username: detachUsername,
            email: detach.email
        },
        {
            $set: {
                email: "",
                emailVerified: false,
                isVerified: false,
                emailVerifiedAt: null
            }
        }
    );

    output.message = "Selected user email detached. User, wallet, orders and sessions were preserved.";
    console.log(JSON.stringify(output, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => {
    console.error("Duplicate email repair failed:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
