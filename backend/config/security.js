const path = require("path");

const isProduction = process.env.NODE_ENV === "production";

const developmentOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
];

function splitList(value) {
    return String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}

function getConfiguredOrigins(env = process.env) {
    const configured = splitList(
        env.ALLOWED_ORIGINS ||
        env.CORS_ORIGINS ||
        env.FRONTEND_URL ||
        env.CLIENT_URL
    );

    return configured;
}

function getAllowedOrigins(env = process.env) {
    const configured = getConfiguredOrigins(env);

    if (env.NODE_ENV === "production") return configured;

    return Array.from(new Set([
        ...configured,
        ...developmentOrigins
    ]));
}

const allowedOrigins = getAllowedOrigins();

function isOriginAllowed(origin) {
    if (!origin) return true;
    return allowedOrigins.includes(origin);
}

const corsOptions = {
    origin(origin, callback) {
        if (isOriginAllowed(origin)) {
            return callback(null, true);
        }

        return callback(new Error("Origin not allowed by AZIEL CORS policy"));
    },
    credentials: true
};

const socketCorsOptions = {
    origin(origin, callback) {
        if (isOriginAllowed(origin)) {
            return callback(null, true);
        }

        return callback(new Error("Origin not allowed by AZIEL CORS policy"));
    },
    methods: ["GET", "POST"],
    credentials: true
};

const jsonBodyLimit = process.env.JSON_BODY_LIMIT || "1mb";
const formBodyLimit = process.env.FORM_BODY_LIMIT || "1mb";
const uploadFileSizeLimit = Number(process.env.UPLOAD_FILE_SIZE_LIMIT || 5 * 1024 * 1024);

const allowedImageMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
];

function safeUploadFileName(name, fallback = "upload") {
    const parsed = path.parse(String(name || fallback));
    const base = parsed.name || fallback;
    const ext = parsed.ext || "";

    return `${base}${ext}`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function imageUploadFileFilter(req, file, callback) {
    if (!allowedImageMimeTypes.includes(file.mimetype)) {
        return callback(new Error("Only JPG, PNG and WEBP images are allowed"));
    }

    callback(null, true);
}

function addError(result, code, message, feature = "core") {
    result.errors.push({ code, message, feature });
    result.features[feature] = "invalid";
}

function addWarning(result, code, message, feature = "core") {
    result.warnings.push({ code, message, feature });
    if (!result.features[feature]) result.features[feature] = "warning";
}

function isUnsafeValue(value, defaults = []) {
    const raw = String(value || "").trim();
    const lower = raw.toLowerCase();

    if (!raw) return true;
    if (defaults.map(item => String(item).toLowerCase()).includes(lower)) return true;
    if (["changeme", "change_me", "change-me", "placeholder", "secret", "password"].includes(lower)) return true;

    return false;
}

function validateSecret(result, env, key, code, defaults = [], minLength = 32, feature = "auth") {
    const value = String(env[key] || "").trim();

    if (isUnsafeValue(value, defaults) || value.length < minLength) {
        addError(result, code, `${key} is missing, too short, or unsafe.`, feature);
    }
}

function decodeTwoFactorKey(raw) {
    if (/^[a-f0-9]{64}$/i.test(raw)) {
        return Buffer.from(raw, "hex");
    }

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) {
        return Buffer.alloc(0);
    }

    return Buffer.from(raw, "base64");
}

function validateTwoFactorKey(result, env) {
    const raw = String(env.TWO_FACTOR_ENCRYPTION_KEY || "").trim();

    if (!raw || decodeTwoFactorKey(raw).length !== 32) {
        addError(
            result,
            "PROD_2FA_KEY_INVALID",
            "TWO_FACTOR_ENCRYPTION_KEY must decode to exactly 32 bytes.",
            "twoFactor"
        );
    }
}

function validateProductionOrigins(result, env) {
    const origins = getConfiguredOrigins(env);

    if (!origins.length) {
        addError(result, "PROD_ORIGIN_MISSING", "At least one production origin is required.", "cors");
        return;
    }

    origins.forEach(origin => {
        if (origin === "*") {
            addError(result, "PROD_ORIGIN_WILDCARD_UNSAFE", "Wildcard origins are not allowed with credentials.", "cors");
            return;
        }

        try {
            const parsed = new URL(origin);
            const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);

            if (parsed.origin !== origin.replace(/\/$/, "")) {
                addError(result, "PROD_ORIGIN_INVALID", "Production origins must not include paths or query strings.", "cors");
            }

            if (parsed.protocol !== "https:" || isLocalhost) {
                addError(result, "PROD_ORIGIN_INSECURE", "Production origins must be HTTPS non-localhost origins.", "cors");
            }
        } catch {
            addError(result, "PROD_ORIGIN_INVALID", "Production origin is malformed.", "cors");
        }
    });
}

function validateGoogleOAuth(result, env) {
    const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
    const clientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();
    const callbackUrl = String(env.GOOGLE_CALLBACK_URL || "").trim();
    const hasAny = Boolean(clientId || clientSecret || callbackUrl);
    const hasCredentials = Boolean(clientId && clientSecret);

    if (!hasAny) {
        result.features.googleOAuth = "disabled";
        return;
    }

    if (!hasCredentials || !callbackUrl) {
        addError(result, "PROD_GOOGLE_OAUTH_PARTIAL_CONFIG", "Google OAuth config is incomplete.", "googleOAuth");
        return;
    }

    try {
        const parsed = new URL(callbackUrl);
        if (parsed.protocol !== "https:") {
            addError(result, "PROD_GOOGLE_CALLBACK_INVALID", "Google callback URL must be HTTPS in production.", "googleOAuth");
        }
    } catch {
        addError(result, "PROD_GOOGLE_CALLBACK_INVALID", "Google callback URL is malformed.", "googleOAuth");
    }
}

function validateAdmin(result, env) {
    const username = String(env.ADMIN_USERNAME || "").trim();
    const password = String(env.ADMIN_PASSWORD || "").trim();

    if (!username || username.toLowerCase() === "admin") {
        addError(result, "PROD_ADMIN_CONFIG_MISSING", "ADMIN_USERNAME must be explicitly configured and non-default.", "admin");
    }

    if (
        isUnsafeValue(password, ["AZIEL2026", "admin", "password"]) ||
        password.length < 12
    ) {
        addError(result, "PROD_ADMIN_PASSWORD_UNSAFE", "ADMIN_PASSWORD must be explicit, non-default, and strong.", "admin");
    }
}

function validateOmise(result, env) {
    const mode = String(env.OMISE_MODE || "").trim().toLowerCase();

    if (!mode) {
        addError(result, "PROD_OMISE_MODE_MISSING", "OMISE_MODE must be explicitly set to test or live.", "payment");
        return;
    }

    if (!["test", "live"].includes(mode)) {
        addError(result, "PROD_OMISE_MODE_INVALID", "OMISE_MODE must be test or live.", "payment");
        return;
    }

    if (mode === "test") {
        addWarning(result, "PROD_OMISE_TEST_MODE", "Production is configured for Omise test mode.", "payment");
    }

    if (!String(env.OMISE_SECRET_KEY || "").trim()) {
        addError(result, "PROD_OMISE_SECRET_MISSING", "OMISE_SECRET_KEY is required for payment verification.", "payment");
    }

    if (!String(env.OMISE_PUBLIC_KEY || "").trim()) {
        addError(result, "PROD_OMISE_PUBLIC_KEY_MISSING", "OMISE_PUBLIC_KEY is required for payment creation.", "payment");
    }
}

function validateEmail(result, env) {
    if (!String(env.EMAIL_USER || "").trim() || !String(env.EMAIL_PASS || "").trim()) {
        addError(result, "PROD_EMAIL_CONFIG_MISSING", "EMAIL_USER and EMAIL_PASS are required for active email flows.", "email");
    }
}

function validateRegistrationOtpPepper(result, env) {
    validateSecret(
        result,
        env,
        "REGISTRATION_OTP_PEPPER",
        "PROD_REGISTRATION_OTP_PEPPER_INVALID",
        [
            "aziel-development-registration-otp-pepper-change-for-production",
            env.JWT_SECRET,
            env.SESSION_SECRET,
            env.TWO_FACTOR_ENCRYPTION_KEY,
            env.OMISE_SECRET_KEY
        ],
        32,
        "registration"
    );
}

function validateStorage(result, env) {
    const mode = String(env.STORAGE_MODE || "").trim().toLowerCase();

    if (!mode) {
        addError(result, "PROD_STORAGE_MODE_MISSING", "STORAGE_MODE is required in production.", "storage");
        return;
    }

    if (mode === "local") {
        addError(result, "PROD_STORAGE_LOCAL_UNSAFE", "Local filesystem storage is not allowed in production.", "storage");
        return;
    }

    if (mode !== "cloudinary") {
        addError(result, "PROD_STORAGE_MODE_INVALID", "STORAGE_MODE must be cloudinary in production.", "storage");
        return;
    }

    if (
        !String(env.CLOUDINARY_CLOUD_NAME || "").trim() ||
        !String(env.CLOUDINARY_API_KEY || "").trim() ||
        !String(env.CLOUDINARY_API_SECRET || "").trim()
    ) {
        addError(result, "PROD_STORAGE_CLOUDINARY_CONFIG_MISSING", "Cloudinary storage configuration is incomplete.", "storage");
        return;
    }

    result.features.storage = "ready";
}

function buildProductionReadiness(env = process.env) {
    const production = env.NODE_ENV === "production";
    const result = {
        environment: env.NODE_ENV || "development",
        ready: true,
        features: {
            database: production ? "ready" : "development",
            auth: production ? "ready" : "development",
            admin: production ? "ready" : "development",
            payment: production ? "ready" : "development",
            email: production ? "ready" : "development",
            registration: production ? "ready" : "development",
            twoFactor: production ? "ready" : "development",
            googleOAuth: "disabled",
            cors: production ? "ready" : "development",
            realtime: production ? "ready" : "development",
            storage: production ? "ready" : "warning"
        },
        errors: [],
        warnings: []
    };

    if (!production) {
        if (String(env.STORAGE_MODE || "local").trim().toLowerCase() === "local") {
            addWarning(
                result,
                "STORAGE_LOCAL_FILESYSTEM",
                "Uploads are stored on the local filesystem in development.",
                "storage"
            );
        }
        result.ready = true;
        return result;
    }

    if (!String(env.MONGO_URI || "").trim()) {
        addError(result, "PROD_MONGO_URI_MISSING", "MONGO_URI is required.", "database");
    }

    validateSecret(result, env, "JWT_SECRET", "PROD_JWT_SECRET_INVALID", ["aziel_jwt_secret"], 32, "auth");
    validateSecret(result, env, "SESSION_SECRET", "PROD_SESSION_SECRET_INVALID", ["aziel_secret"], 32, "auth");
    validateAdmin(result, env);
    validateOmise(result, env);
    validateEmail(result, env);
    validateRegistrationOtpPepper(result, env);
    validateStorage(result, env);
    validateTwoFactorKey(result, env);
    validateGoogleOAuth(result, env);
    validateProductionOrigins(result, env);

    result.ready = result.errors.length === 0;

    return result;
}

function logReadinessResult(result) {
    result.warnings.forEach(warning => {
        console.warn(`[readiness] WARN ${warning.code}`);
    });

    result.errors.forEach(error => {
        console.error(`[readiness] FAIL ${error.code}`);
    });

    if (result.ready) {
        console.log(`[readiness] PASS ${result.environment}`);
    }
}

function validateProductionReadiness(env = process.env) {
    const result = buildProductionReadiness(env);

    if (env.NODE_ENV === "production") {
        logReadinessResult(result);
    } else if (process.env.READINESS_DEBUG === "true") {
        logReadinessResult(result);
    }

    if (env.NODE_ENV === "production" && !result.ready) {
        const codes = result.errors.map(error => error.code).join(", ");
        throw new Error(`Production readiness failed: ${codes}`);
    }

    return result;
}

function validateProductionSecurityConfig() {
    return validateProductionReadiness(process.env);
}

module.exports = {
    allowedImageMimeTypes,
    allowedOrigins,
    buildProductionReadiness,
    corsOptions,
    developmentOrigins,
    formBodyLimit,
    imageUploadFileFilter,
    isProduction,
    jsonBodyLimit,
    safeUploadFileName,
    socketCorsOptions,
    uploadFileSizeLimit,
    validateProductionReadiness,
    validateProductionSecurityConfig
};
