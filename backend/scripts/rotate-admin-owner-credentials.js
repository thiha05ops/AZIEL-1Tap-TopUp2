const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

dotenv.config({
    path: path.join(__dirname, "../../.env")
});

const connectDB = require("../config/db");
const AdminAccount = require("../models/AdminAccount");
const AdminSession = require("../models/AdminSession");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const { ROLES, STATUSES } = require("../services/adminAuthorizationService");

const BCRYPT_ROUNDS = 12;

function normalizeUsername(value = "") {
    const username = String(value || "").trim().toLowerCase();
    if (!/^[a-z0-9._@-]{3,64}$/.test(username)) {
        throw new Error("ADMIN_USERNAME_INVALID");
    }
    return username;
}

function assertStrongPassword(value = "") {
    if (String(value || "").length < 10) {
        throw new Error("ADMIN_PASSWORD_WEAK");
    }
}

async function selectOwnerAccount() {
    const ownerId = String(process.env.ADMIN_OWNER_ID || "").trim();
    const currentUsername = String(process.env.ADMIN_CURRENT_USERNAME || "").trim();

    if (ownerId) {
        const account = await AdminAccount.findOne({
            _id: ownerId,
            role: ROLES.OWNER,
            status: STATUSES.ACTIVE
        });
        if (!account) throw new Error("ADMIN_OWNER_NOT_FOUND");
        return account;
    }

    if (currentUsername) {
        const account = await AdminAccount.findOne({
            usernameNormalized: normalizeUsername(currentUsername),
            role: ROLES.OWNER,
            status: STATUSES.ACTIVE
        });
        if (!account) throw new Error("ADMIN_OWNER_NOT_FOUND");
        return account;
    }

    const owners = await AdminAccount.find({
        role: ROLES.OWNER,
        status: STATUSES.ACTIVE
    }).sort({ createdAt: 1 });

    if (owners.length !== 1) {
        throw new Error("ADMIN_OWNER_SELECTION_REQUIRED");
    }

    return owners[0];
}

async function rotateOwnerCredentials() {
    const newUsername = String(process.env.ADMIN_NEW_USERNAME || "").trim();
    const newPassword = String(process.env.ADMIN_NEW_PASSWORD || "");
    const usernameNormalized = normalizeUsername(newUsername);
    assertStrongPassword(newPassword);

    const owner = await selectOwnerAccount();
    const duplicate = await AdminAccount.findOne({
        _id: { $ne: owner._id },
        usernameNormalized
    }).select("_id");

    if (duplicate) {
        throw new Error("ADMIN_USERNAME_EXISTS");
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const now = new Date();

    await AdminAccount.collection.updateOne(
        { _id: owner._id, role: ROLES.OWNER },
        {
            $set: {
                username: newUsername,
                usernameNormalized,
                passwordHash,
                passwordChangedAt: now,
                updatedAt: now
            }
        }
    );

    await AdminSession.updateMany(
        { adminId: owner._id, revokedAt: null },
        {
            $set: {
                revokedAt: now,
                revokedByAdminId: owner._id,
                revokeReason: "owner_credentials_rotated"
            }
        }
    );

    await writeAdminAudit({
        actor: {
            id: owner._id,
            username: newUsername,
            role: ROLES.OWNER
        },
        action: ADMIN_AUDIT_ACTIONS.ADMIN_PASSWORD_CHANGED,
        resourceType: "AdminAccount",
        resourceId: String(owner._id),
        targetAdminId: owner._id,
        metadata: {
            credentialRotation: true,
            usernameChanged: owner.usernameNormalized !== usernameNormalized,
            sessionsRevoked: true
        }
    });

    console.log("Admin OWNER credentials rotated. Existing admin sessions were revoked.");
}

if (require.main === module) {
    connectDB()
        .then(rotateOwnerCredentials)
        .then(() => mongoose.connection.close(false))
        .then(() => process.exit(0))
        .catch(async error => {
            console.error("Admin credential rotation failed:", error.message || error.code || "ROTATION_FAILED");
            try {
                await mongoose.connection.close(false);
            } catch {
                // Ignore close failures during script shutdown.
            }
            process.exit(1);
        });
}

module.exports = {
    rotateOwnerCredentials
};
