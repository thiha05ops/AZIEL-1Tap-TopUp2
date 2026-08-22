const assert = require("assert");

process.env.NODE_ENV = "test";

const {
    REGISTER_OTP_MAX_ATTEMPTS,
    beginRegistration,
    hashOtp,
    verifyRegistrationOtp
} = require("../services/registrationService");
const { buildProductionReadiness } = require("../config/security");
const { SAFE_EMAIL_FAILURE_MESSAGE } = require("../services/emailTransportService");

const env = {
    NODE_ENV: "test",
    REGISTRATION_OTP_PEPPER: "registration-otp-pepper-test-secret-123456"
};

function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : value;
}

function normalizeDoc(doc) {
    if (!doc) return doc;
    const copy = { ...doc };
    ["otpExpiresAt", "resendAvailableAt", "consumedAt", "expiresAt", "emailVerifiedAt", "lastActiveAt"].forEach(key => {
        if (copy[key]) copy[key] = new Date(copy[key]);
    });
    return copy;
}

function matches(doc, query = {}) {
    return Object.entries(query).every(([key, expected]) => {
        const actual = doc[key];

        if (key === "$or") {
            return expected.some(item => matches(doc, item));
        }

        if (expected && typeof expected === "object" && !(expected instanceof Date)) {
            if (expected.$ne !== undefined && actual === expected.$ne) return false;
            if (expected.$gt !== undefined && !(actual > expected.$gt)) return false;
            if (expected.$lt !== undefined && !(actual < expected.$lt)) return false;
            return true;
        }

        return actual === expected;
    });
}

class FakePendingRegistrationModel {
    constructor(initial = []) {
        this.records = initial.map((record, index) => ({
            _id: record._id || `pending-${index + 1}`,
            ...record
        }));
        this.nextId = this.records.length + 1;
    }

    async findOne(query) {
        return normalizeDoc(clone(this.records.find(record => matches(record, query))));
    }

    async findOneAndUpdate(query, update, options = {}) {
        let index = this.records.findIndex(record => matches(record, query));

        if (index === -1 && options.upsert) {
            const email = query.email || update.$set?.email;
            this.records.push({
                _id: `pending-${this.nextId++}`,
                email
            });
            index = this.records.length - 1;
        }

        if (index === -1) return null;

        this.records[index] = {
            ...this.records[index],
            ...(update.$set || {})
        };

        return normalizeDoc(clone(this.records[index]));
    }

    async updateOne(query, update) {
        const index = this.records.findIndex(record => matches(record, query));
        if (index === -1) return { modifiedCount: 0 };

        this.records[index] = {
            ...this.records[index],
            ...(update.$set || {})
        };

        return { modifiedCount: 1 };
    }

    async deleteOne(query) {
        const before = this.records.length;
        this.records = this.records.filter(record => !matches(record, query));
        return { deletedCount: before - this.records.length };
    }
}

class FakeUserModel {
    constructor(initial = []) {
        this.records = initial.map((record, index) => ({
            _id: record._id || `user-${index + 1}`,
            ...record
        }));
        this.nextId = this.records.length + 1;
    }

    async findOne(query) {
        return normalizeDoc(clone(this.records.find(record => matches(record, query))));
    }

    async create(doc) {
        if (this.records.some(record => record.username === doc.username || record.email === doc.email)) {
            const error = new Error("duplicate key");
            error.code = 11000;
            throw error;
        }

        const user = {
            _id: `user-${this.nextId++}`,
            ...doc
        };
        this.records.push(user);
        return normalizeDoc(clone(user));
    }
}

async function issueChallenge({ pendingModel, userModel, email = "launchqa@gmail.com", username = "launchqa", password = "CorrectHorse123!" } = {}) {
    let sentOtp = "";

    const result = await beginRegistration(
        { username, email, password },
        {
            PendingRegistrationModel: pendingModel,
            UserModel: userModel,
            sendVerifyOTP: async (to, otp) => {
                assert.strictEqual(to, email);
                sentOtp = otp;
            },
            env
        }
    );

    assert.strictEqual(result.success, true);
    assert(/^\d{6}$/.test(sentOtp));

    return sentOtp;
}

function productionEnv(overrides = {}) {
    return {
        NODE_ENV: "production",
        MONGO_URI: "mongodb+srv://example.invalid/aziel",
        JWT_SECRET: "0123456789abcdef0123456789abcdef",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef-session",
        ADMIN_USERNAME: "aziel-admin",
        ADMIN_PASSWORD: "StrongAdminPassword123!",
        OMISE_MODE: "live",
        OMISE_PUBLIC_KEY: "pkey_live_placeholder",
        OMISE_SECRET_KEY: "skey_live_placeholder",
        EMAIL_USER: "aziel@example.com",
        EMAIL_PASS: "email-app-password",
        REGISTRATION_OTP_PEPPER: "registration-otp-pepper-production-placeholder",
        TWO_FACTOR_ENCRYPTION_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ALLOWED_ORIGINS: "https://aziel.example.com",
        STORAGE_MODE: "cloudinary",
        CLOUDINARY_CLOUD_NAME: "aziel-test",
        CLOUDINARY_API_KEY: "cloudinary-key",
        CLOUDINARY_API_SECRET: "cloudinary-secret",
        ...overrides
    };
}

async function main() {
    const pendingModel = new FakePendingRegistrationModel();
    const userModel = new FakeUserModel();
    const password = "CorrectHorse123!";
    const otp = await issueChallenge({ pendingModel, userModel, password });
    const pending = pendingModel.records[0];

    assert.notStrictEqual(pending.otpHash, otp, "OTP must not be stored raw");
    assert.strictEqual(pending.otpHash, hashOtp(otp, pending.email, env));
    assert.notStrictEqual(pending.passwordHash, password, "password must not be stored raw");
    assert(pending.passwordHash.startsWith("$2"), "password should be bcrypt hashed");

    const recreatedServicePendingModel = pendingModel;
    await assert.rejects(
        () => verifyRegistrationOtp(
            { email: pending.email, otp: "000000" },
            { PendingRegistrationModel: recreatedServicePendingModel, UserModel: userModel, env }
        ),
        /Invalid OTP/
    );
    assert.strictEqual(pendingModel.records[0].otpAttempts, 1, "failed attempts increment");

    const verified = await verifyRegistrationOtp(
        { email: pending.email, otp },
        { PendingRegistrationModel: recreatedServicePendingModel, UserModel: userModel, env }
    );
    assert.strictEqual(verified.success, true);
    assert.strictEqual(userModel.records.length, 1);
    assert.strictEqual(userModel.records[0].emailVerified, true);
    assert(userModel.records[0].emailVerifiedAt, "emailVerifiedAt should be set");
    assert.strictEqual(pendingModel.records.length, 0, "pending challenge should be consumed/removed");

    const maxPendingModel = new FakePendingRegistrationModel();
    const maxUserModel = new FakeUserModel();
    const maxOtp = await issueChallenge({ pendingModel: maxPendingModel, userModel: maxUserModel, email: "maxqa@gmail.com", username: "maxqa" });
    assert(maxOtp);
    for (let index = 0; index < REGISTER_OTP_MAX_ATTEMPTS - 1; index++) {
        await assert.rejects(
            () => verifyRegistrationOtp(
                { email: "maxqa@gmail.com", otp: "111111" },
                { PendingRegistrationModel: maxPendingModel, UserModel: maxUserModel, env }
            ),
            /Invalid OTP/
        );
    }
    await assert.rejects(
        () => verifyRegistrationOtp(
            { email: "maxqa@gmail.com", otp: "111111" },
            { PendingRegistrationModel: maxPendingModel, UserModel: maxUserModel, env }
        ),
        /Too many invalid attempts/
    );
    assert.strictEqual(maxPendingModel.records.length, 0);

    const expiredPendingModel = new FakePendingRegistrationModel();
    const expiredUserModel = new FakeUserModel();
    const expiredOtp = await issueChallenge({ pendingModel: expiredPendingModel, userModel: expiredUserModel, email: "expiredqa@gmail.com", username: "expiredqa" });
    expiredPendingModel.records[0].otpExpiresAt = new Date(Date.now() - 1000);
    await assert.rejects(
        () => verifyRegistrationOtp(
            { email: "expiredqa@gmail.com", otp: expiredOtp },
            { PendingRegistrationModel: expiredPendingModel, UserModel: expiredUserModel, env }
        ),
        /OTP expired/
    );

    const resendPendingModel = new FakePendingRegistrationModel();
    const resendUserModel = new FakeUserModel();
    const firstOtp = await issueChallenge({ pendingModel: resendPendingModel, userModel: resendUserModel, email: "resendqa@gmail.com", username: "resendqa" });
    const cooldown = await beginRegistration(
        { username: "resendqa", email: "resendqa@gmail.com", password: "NewPassword123!" },
        {
            PendingRegistrationModel: resendPendingModel,
            UserModel: resendUserModel,
            sendVerifyOTP: async () => assert.fail("cooldown should not send email"),
            env
        }
    );
    assert.strictEqual(cooldown.success, false);
    assert.strictEqual(cooldown.code, "OTP_RESEND_COOLDOWN");

    resendPendingModel.records[0].resendAvailableAt = new Date(Date.now() - 1000);
    let secondOtp = "";
    await beginRegistration(
        { username: "resendqa", email: "resendqa@gmail.com", password: "NewPassword123!" },
        {
            PendingRegistrationModel: resendPendingModel,
            UserModel: resendUserModel,
            sendVerifyOTP: async (to, otpValue) => {
                secondOtp = otpValue;
            },
            env
        }
    );
    assert.notStrictEqual(secondOtp, firstOtp);
    await assert.rejects(
        () => verifyRegistrationOtp(
            { email: "resendqa@gmail.com", otp: firstOtp },
            { PendingRegistrationModel: resendPendingModel, UserModel: resendUserModel, env }
        ),
        /Invalid OTP/
    );
    const resendVerified = await verifyRegistrationOtp(
        { email: "resendqa@gmail.com", otp: secondOtp },
        { PendingRegistrationModel: resendPendingModel, UserModel: resendUserModel, env }
    );
    assert.strictEqual(resendVerified.success, true);

    const racePendingModel = new FakePendingRegistrationModel();
    const raceUserModel = new FakeUserModel();
    const raceOtp = await issueChallenge({ pendingModel: racePendingModel, userModel: raceUserModel, email: "raceqa@gmail.com", username: "raceqa" });
    const raceResults = await Promise.allSettled([
        verifyRegistrationOtp(
            { email: "raceqa@gmail.com", otp: raceOtp },
            { PendingRegistrationModel: racePendingModel, UserModel: raceUserModel, env }
        ),
        verifyRegistrationOtp(
            { email: "raceqa@gmail.com", otp: raceOtp },
            { PendingRegistrationModel: racePendingModel, UserModel: raceUserModel, env }
        )
    ]);
    assert.strictEqual(raceResults.filter(result => result.status === "fulfilled").length, 1);
    assert.strictEqual(raceUserModel.records.length, 1);

    const mailFailPendingModel = new FakePendingRegistrationModel();
    const mailFailUserModel = new FakeUserModel();
    await assert.rejects(
        () => beginRegistration(
            { username: "mailfail", email: "mailfail@gmail.com", password: "CorrectHorse123!" },
            {
                PendingRegistrationModel: mailFailPendingModel,
                UserModel: mailFailUserModel,
                sendVerifyOTP: async () => {
                    throw new Error("smtp down");
                },
                env
            }
        ),
        error => error?.code === "REGISTRATION_EMAIL_SEND_FAILED" && error?.message === SAFE_EMAIL_FAILURE_MESSAGE
    );
    assert.strictEqual(mailFailPendingModel.records.length, 0);

    const readiness = buildProductionReadiness(productionEnv({ REGISTRATION_OTP_PEPPER: "" }));
    assert.strictEqual(readiness.ready, false);
    assert(readiness.errors.some(error => error.code === "PROD_REGISTRATION_OTP_PEPPER_INVALID"));

    console.log("Registration OTP verification checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
