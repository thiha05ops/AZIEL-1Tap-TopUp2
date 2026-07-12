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

function getAllowedOrigins() {
    const configured = splitList(
        process.env.ALLOWED_ORIGINS ||
        process.env.CORS_ORIGINS ||
        process.env.FRONTEND_URL ||
        process.env.CLIENT_URL
    );

    if (isProduction) return configured;

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

function validateProductionSecurityConfig() {
    if (!isProduction) return;

    const missing = [];

    if (!process.env.MONGO_URI) missing.push("MONGO_URI");
    if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
    if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
    if (!allowedOrigins.length) missing.push("ALLOWED_ORIGINS");

    if (process.env.JWT_SECRET === "aziel_jwt_secret") {
        missing.push("JWT_SECRET(non-default)");
    }

    if (process.env.SESSION_SECRET === "aziel_secret") {
        missing.push("SESSION_SECRET(non-default)");
    }

    if (missing.length) {
        throw new Error(
            `Missing production security config: ${missing.join(", ")}`
        );
    }
}

module.exports = {
    allowedImageMimeTypes,
    allowedOrigins,
    corsOptions,
    developmentOrigins,
    formBodyLimit,
    imageUploadFileFilter,
    isProduction,
    jsonBodyLimit,
    safeUploadFileName,
    socketCorsOptions,
    uploadFileSizeLimit,
    validateProductionSecurityConfig
};
