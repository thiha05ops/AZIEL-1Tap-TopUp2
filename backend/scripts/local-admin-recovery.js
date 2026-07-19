#!/usr/bin/env node

require("dotenv").config();

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { generateSecret, generateURI } = require("otplib");

const AdminAccount = require("../models/AdminAccount");
const AdminLoginChallenge = require("../models/AdminLoginChallenge");
const AdminSession = require("../models/AdminSession");
const { ROLES, STATUSES } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const { encryptSecret } = require("../services/twoFactorService");

const ROOT = path.join(__dirname, "../..");
const RECOVERY_DIR = path.join(ROOT, ".local-admin-recovery");
const SETUP_FILE = path.join(RECOVERY_DIR, "owner-totp-setup.txt");
const BCRYPT_ROUNDS = 12;

function parseArgs(argv = process.argv.slice(2)) {
    const args = {
        apply: false,
        username: process.env.ADMIN_USERNAME || "admin",
        password: process.env.ADMIN_PASSWORD || "",
        displayName: "Owner"
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === "--apply") args.apply = true;
        if (value === "--username") args.username = argv[index += 1] || args.username;
        if (value === "--password") args.password = argv[index += 1] || args.password;
        if (value === "--display-name") args.displayName = argv[index += 1] || args.displayName;
    }

    return args;
}

function normalizeUsername(username) {
    return String(username || "").trim().toLowerCase();
}

function databaseNameFromUri(uri) {
    try {
        const parsed = new URL(uri);
        return parsed.pathname.replace(/^\//, "").split("/")[0] || "";
    } catch (error) {
        return "";
    }
}

function assertLocalRecoveryAllowed(uri) {
    const nodeEnv = String(process.env.NODE_ENV || "development").toLowerCase();
    if (nodeEnv === "production") {
        throw new Error("Local admin recovery is disabled in production.");
    }

    if (process.env.RENDER || process.env.AZIEL_PRODUCTION === "true") {
        throw new Error("Local admin recovery is disabled in hosted/production-like environments.");
    }

    if (process.env.AZIEL_LOCAL_ADMIN_RECOVERY !== "true") {
        throw new Error("Set AZIEL_LOCAL_ADMIN_RECOVERY=true to acknowledge local-only recovery.");
    }

    if (!uri) {
        throw new Error("MONGO_URI is required for local admin recovery.");
    }

    let parsed;
    try {
        parsed = new URL(uri);
    } catch (error) {
        throw new Error("MONGO_URI is invalid.");
    }

    const hostname = String(parsed.hostname || "").toLowerCase();
    const isLocalMongo = [
        "localhost",
        "127.0.0.1",
        "::1",
        "0.0.0.0"
    ].includes(hostname);

    if (!isLocalMongo) {
        throw new Error(`Refusing non-local Mongo host "${hostname}". Use a localhost Mongo URI for recovery.`);
    }
}

function assertPassword(password) {
    if (String(password || "").length < 10) {
        throw new Error("Recovery password must be at least 10 characters.");
    }
}

async function writeSetupArtifact({ username, issuer, otpauthUri }) {
    await fs.promises.mkdir(RECOVERY_DIR, { mode: 0o700, recursive: true });
    const body = [
        "AZIEL local admin recovery TOTP setup",
        "",
        "This file is generated only for local development recovery.",
        "Delete it after the authenticator app is enrolled.",
        "",
        `Username: ${username}`,
        `Issuer: ${issuer}`,
        "",
        "Provisioning URI:",
        otpauthUri,
        ""
    ].join("\n");

    await fs.promises.writeFile(SETUP_FILE, body, { mode: 0o600 });
}

async function recoverOwner(args) {
    const usernameNormalized = normalizeUsername(args.username);
    const passwordHash = await bcrypt.hash(args.password, BCRYPT_ROUNDS);
    const secret = generateSecret();
    const issuer = "AZIEL Admin Local";
    const otpauthUri = generateURI({
        secret,
        strategy: "totp",
        algorithm: "sha1",
        digits: 6,
        period: 30,
        issuer,
        label: usernameNormalized
    });

    const adminAccountCount = await AdminAccount.countDocuments();
    let admin = await AdminAccount.findOne({ usernameNormalized });
    if (!admin && adminAccountCount > 0) {
        throw new Error("Refusing to create a new owner because local admin accounts already exist. Recover an existing OWNER username.");
    }
    if (admin && admin.role !== ROLES.OWNER) {
        throw new Error("Refusing to promote a non-owner admin account during local recovery.");
    }

    if (!admin) {
        admin = new AdminAccount({
            username: args.username,
            usernameNormalized,
            displayName: args.displayName,
            role: ROLES.OWNER,
            status: STATUSES.ACTIVE
        });
    }

    admin.username = args.username;
    admin.displayName = admin.displayName || args.displayName;
    admin.passwordHash = passwordHash;
    admin.role = ROLES.OWNER;
    admin.status = STATUSES.ACTIVE;
    admin.passwordChangedAt = new Date();
    admin.twoFactor = {
        enabled: true,
        secretEncrypted: encryptSecret(secret),
        pendingSecretEncrypted: "",
        pendingExpiresAt: null,
        enabledAt: new Date()
    };
    admin.updatedByAdminId = null;

    await admin.save();
    await AdminSession.updateMany(
        { adminId: admin._id, revokedAt: null },
        {
            $set: {
                revokedAt: new Date(),
                revokeReason: "Local developer admin recovery"
            }
        }
    );
    await AdminLoginChallenge.deleteMany({ adminId: admin._id });
    await writeSetupArtifact({ username: args.username, issuer, otpauthUri });

    await writeAdminAudit({
        actor: {
            username: "local-admin-recovery",
            role: ROLES.OWNER
        },
        action: ADMIN_AUDIT_ACTIONS.ADMIN_2FA_RESET,
        resourceType: "AdminAccount",
        resourceId: String(admin._id),
        targetAdminId: admin._id,
        metadata: {
            localRecovery: true,
            passwordRotated: true,
            twoFactorRotated: true,
            sessionsRevoked: true,
            recoveryId: crypto.randomBytes(8).toString("hex")
        }
    });

    return {
        id: String(admin._id),
        username: admin.username,
        role: admin.role,
        status: admin.status,
        setupFile: SETUP_FILE
    };
}

async function main() {
    const args = parseArgs();
    const uri = process.env.MONGO_URI || "";
    assertLocalRecoveryAllowed(uri);
    assertPassword(args.password);

    const dbName = databaseNameFromUri(uri);
    const safeSummary = {
        environment: process.env.NODE_ENV || "development",
        database: dbName || "[unknown]",
        username: args.username,
        apply: args.apply
    };

    if (!args.apply) {
        console.log("local-admin-recovery: dry run");
        console.log(JSON.stringify(safeSummary, null, 2));
        console.log("Run again with --apply to rotate the local owner password and TOTP.");
        return;
    }

    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });

    try {
        const result = await recoverOwner(args);
        console.log("local-admin-recovery: applied");
        console.log(JSON.stringify({
            id: result.id,
            username: result.username,
            role: result.role,
            status: result.status,
            totpSetupFile: result.setupFile
        }, null, 2));
        console.log("Open the setup file locally, enroll the authenticator, then delete the file.");
    } finally {
        await mongoose.disconnect();
    }
}

main().catch(error => {
    console.error("local-admin-recovery: failed");
    console.error(error.message);
    process.exit(1);
});
