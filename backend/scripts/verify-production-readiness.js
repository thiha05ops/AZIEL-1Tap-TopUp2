const assert = require("assert");

const {
    buildProductionReadiness,
    validateProductionReadiness
} = require("../config/security");

const strongSecret = "0123456789abcdef0123456789abcdef";
const twoFactorKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function baseProductionEnv(overrides = {}) {
    return {
        NODE_ENV: "production",
        MONGO_URI: "mongodb+srv://example.invalid/aziel",
        JWT_SECRET: strongSecret,
        SESSION_SECRET: `${strongSecret}session`,
        ADMIN_USERNAME: "aziel-admin",
        ADMIN_PASSWORD: "StrongAdminPassword123!",
        OMISE_MODE: "live",
        OMISE_PUBLIC_KEY: "pkey_live_placeholder",
        OMISE_SECRET_KEY: "skey_live_placeholder",
        EMAIL_USER: "aziel@example.com",
        EMAIL_PASS: "email-app-password",
        REGISTRATION_OTP_PEPPER: "registration-otp-pepper-production-placeholder",
        TWO_FACTOR_ENCRYPTION_KEY: twoFactorKey,
        ALLOWED_ORIGINS: "https://aziel.example.com",
        STORAGE_MODE: "cloudinary",
        CLOUDINARY_CLOUD_NAME: "aziel-test",
        CLOUDINARY_API_KEY: "cloudinary-key",
        CLOUDINARY_API_SECRET: "cloudinary-secret",
        AZIEL_SUPPRESS_READINESS_LOGS: "true",
        ...overrides
    };
}

function expectReady(label, env, expectedReady) {
    const result = buildProductionReadiness(env);
    assert.strictEqual(result.ready, expectedReady, `${label}: readiness`);
    return result;
}

function expectCode(label, env, code) {
    const result = expectReady(label, env, false);
    assert(
        result.errors.some(error => error.code === code),
        `${label}: expected ${code}, got ${result.errors.map(error => error.code).join(", ")}`
    );
    return result;
}

function main() {
    const dev = expectReady("development minimal config", { NODE_ENV: "development" }, true);
    assert(dev.warnings.some(warning => warning.code === "STORAGE_LOCAL_FILESYSTEM"));

    expectCode("production missing Mongo", baseProductionEnv({ MONGO_URI: "" }), "PROD_MONGO_URI_MISSING");
    expectCode("production weak JWT", baseProductionEnv({ JWT_SECRET: "aziel_jwt_secret" }), "PROD_JWT_SECRET_INVALID");
    expectCode("production missing session", baseProductionEnv({ SESSION_SECRET: "" }), "PROD_SESSION_SECRET_INVALID");
    expectCode("production default admin", baseProductionEnv({
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "AZIEL2026"
    }), "PROD_ADMIN_CONFIG_MISSING");
    expectCode("production unsafe admin password", baseProductionEnv({ ADMIN_PASSWORD: "AZIEL2026" }), "PROD_ADMIN_PASSWORD_UNSAFE");
    expectCode("invalid Omise mode", baseProductionEnv({ OMISE_MODE: "sandbox" }), "PROD_OMISE_MODE_INVALID");
    expectCode("live payment missing secret", baseProductionEnv({ OMISE_SECRET_KEY: "" }), "PROD_OMISE_SECRET_MISSING");
    expectCode("payment missing public key", baseProductionEnv({ OMISE_PUBLIC_KEY: "" }), "PROD_OMISE_PUBLIC_KEY_MISSING");
    expectCode(
        "test payment key in live production",
        baseProductionEnv({ OMISE_PUBLIC_KEY: "pkey_test_placeholder", OMISE_SECRET_KEY: "skey_test_placeholder" }),
        "PAYMENT_TEST_KEY_IN_PRODUCTION"
    );
    expectCode(
        "payment key mode mismatch",
        baseProductionEnv({ OMISE_PUBLIC_KEY: "pkey_live_placeholder", OMISE_SECRET_KEY: "skey_test_placeholder" }),
        "PAYMENT_KEY_MODE_MISMATCH"
    );
    expectCode("missing email", baseProductionEnv({ EMAIL_USER: "", EMAIL_PASS: "" }), "PROD_EMAIL_CONFIG_MISSING");
    expectCode(
        "missing registration OTP pepper",
        baseProductionEnv({ REGISTRATION_OTP_PEPPER: "" }),
        "PROD_REGISTRATION_OTP_PEPPER_INVALID"
    );
    expectCode("invalid 2FA key", baseProductionEnv({ TWO_FACTOR_ENCRYPTION_KEY: "short" }), "PROD_2FA_KEY_INVALID");
    expectCode("partial Google OAuth", baseProductionEnv({ GOOGLE_CLIENT_ID: "client-id" }), "PROD_GOOGLE_OAUTH_PARTIAL_CONFIG");

    const absentGoogle = expectReady("absent optional Google OAuth", baseProductionEnv(), true);
    assert.strictEqual(absentGoogle.features.googleOAuth, "disabled");

    expectCode("malformed production origin", baseProductionEnv({ ALLOWED_ORIGINS: "not-a-url" }), "PROD_ORIGIN_INVALID");
    expectCode("invalid catalog source", baseProductionEnv({ CATALOG_SOURCE: "browser" }), "PROD_CATALOG_SOURCE_INVALID");

    expectCode("production local storage mode", baseProductionEnv({ STORAGE_MODE: "local" }), "PROD_STORAGE_LOCAL_UNSAFE");
    expectCode(
        "incomplete Cloudinary config",
        baseProductionEnv({ CLOUDINARY_API_SECRET: "" }),
        "PROD_STORAGE_CLOUDINARY_CONFIG_MISSING"
    );

    assert.doesNotThrow(() => validateProductionReadiness(baseProductionEnv()));
    assert.doesNotThrow(() => validateProductionReadiness(baseProductionEnv({ CATALOG_SOURCE: "database" })));
    assert.throws(
        () => validateProductionReadiness(baseProductionEnv({ EMAIL_PASS: "" })),
        /PROD_EMAIL_CONFIG_MISSING/
    );

    console.log("Production readiness checks passed.");
}

main();
