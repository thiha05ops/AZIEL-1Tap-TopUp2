const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const { safeUploadFileName, uploadFileSizeLimit } = require("../config/security");

class StorageError extends Error {
    constructor(code, message, statusCode = 400, options = {}) {
        super(message);
        this.name = "StorageError";
        this.code = code;
        this.statusCode = statusCode;
        this.provider = options.provider || getStorageMode();
    }
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp"
]);

const EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
};

const CATEGORY_FOLDERS = {
    paymentSlip: "payment-slips",
    walletSlip: "wallet-slips",
    supportEvidence: "support",
    paymentAsset: "payment-assets",
    mediaAsset: "media-assets",
    profilePhoto: "profile"
};

function getStorageMode(env = process.env) {
    return String(env.STORAGE_MODE || (env.NODE_ENV === "production" ? "" : "local"))
        .trim()
        .toLowerCase();
}

function assertAllowedImage(file = {}) {
    if (!file) {
        throw new StorageError("UPLOAD_FILE_REQUIRED", "File is required.");
    }

    if (Number(file.size || 0) > uploadFileSizeLimit) {
        throw new StorageError("UPLOAD_FILE_TOO_LARGE", "Uploaded file is too large.", 413);
    }

    const mimeType = String(file.mimetype || file.mimeType || "").toLowerCase();

    if (["image/heic", "image/heif"].includes(mimeType)) {
        throw new StorageError(
            "UPLOAD_HEIC_UNSUPPORTED",
            "HEIC images are not supported. Please upload JPG, PNG or WEBP.",
            415
        );
    }

    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
        throw new StorageError(
            "UPLOAD_TYPE_NOT_ALLOWED",
            "Only JPG, PNG and WEBP images are allowed.",
            415
        );
    }
}

function normalizeCategory(category) {
    if (!CATEGORY_FOLDERS[category]) {
        throw new StorageError("UPLOAD_STORAGE_CONFIG_INVALID", "Invalid upload category.", 500);
    }

    return category;
}

function safeOwnerReference(value) {
    return String(value || "general")
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .slice(0, 96) || "general";
}

function createObjectKey({ category, ownerReference, mimeType }) {
    const safeCategory = normalizeCategory(category);
    const folder = CATEGORY_FOLDERS[safeCategory];
    const owner = safeOwnerReference(ownerReference);
    const id = crypto.randomBytes(16).toString("hex");
    const ext = EXT_BY_MIME[String(mimeType || "").toLowerCase()] || ".bin";

    return `${folder}/${owner}/${Date.now()}-${id}${ext}`;
}

function toReference(input = {}) {
    return {
        provider: input.provider || getStorageMode(),
        key: input.key || "",
        url: input.url || "",
        mimeType: input.mimeType || "",
        size: Number(input.size || 0),
        originalName: input.originalName || "",
        uploadedAt: input.uploadedAt || new Date()
    };
}

function projectFileUrl(value, legacyFolder = "") {
    if (!value) return "";

    if (typeof value === "object") {
        return value.url || "";
    }

    const raw = String(value || "");
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || raw.startsWith("/uploads/")) return raw;
    if (legacyFolder) return `/uploads/${legacyFolder}/${raw}`;
    return raw;
}

async function uploadFile({ file, category, ownerReference, env = process.env } = {}) {
    assertAllowedImage(file);

    const mode = getStorageMode(env);
    const key = createObjectKey({
        category,
        ownerReference,
        mimeType: file.mimetype
    });
    const originalName = safeUploadFileName(file.originalname || "upload");

    if (mode === "local") {
        return uploadLocal({ file, key, originalName });
    }

    if (mode === "cloudinary") {
        return uploadCloudinary({ file, key, originalName, env });
    }

    throw new StorageError(
        "UPLOAD_STORAGE_CONFIG_INVALID",
        "Storage mode is not configured.",
        500
    );
}

async function uploadLocal({ file, key, originalName }) {
    const absolutePath = path.join(__dirname, "../uploads", key);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);

    return toReference({
        provider: "local",
        key,
        url: `/uploads/${key}`,
        mimeType: file.mimetype,
        size: file.size,
        originalName
    });
}

function cloudinaryConfig(env = process.env) {
    const cloudName = String(env.CLOUDINARY_CLOUD_NAME || "").trim();
    const apiKey = String(env.CLOUDINARY_API_KEY || "").trim();
    const apiSecret = String(env.CLOUDINARY_API_SECRET || "").trim();

    if (!cloudName || !apiKey || !apiSecret) {
        throw new StorageError(
            "UPLOAD_STORAGE_CONFIG_INVALID",
            "Cloudinary storage configuration is incomplete.",
            500,
            { provider: "cloudinary" }
        );
    }

    return { cloudName, apiKey, apiSecret };
}

function signCloudinaryParams(params, apiSecret) {
    const payload = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join("&");

    return crypto
        .createHash("sha1")
        .update(`${payload}${apiSecret}`)
        .digest("hex");
}

async function uploadCloudinary({ file, key, originalName, env }) {
    const { cloudName, apiKey, apiSecret } = cloudinaryConfig(env);
    const publicId = key.replace(/\.[^.]+$/, "");
    const folder = path.dirname(publicId);
    const timestamp = Math.floor(Date.now() / 1000);
    const params = {
        folder,
        public_id: path.basename(publicId),
        timestamp
    };
    const signature = signCloudinaryParams(params, apiSecret);
    const form = new FormData();
    const blob = new Blob([file.buffer], { type: file.mimetype });

    form.append("file", blob, originalName);
    form.append("api_key", apiKey);
    form.append("timestamp", String(timestamp));
    form.append("folder", folder);
    form.append("public_id", path.basename(publicId));
    form.append("signature", signature);

    let response;

    try {
        response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
            method: "POST",
            body: form
        });
    } catch (error) {
        throw new StorageError(
            "UPLOAD_STORAGE_UNAVAILABLE",
            "Durable storage upload failed.",
            503,
            { provider: "cloudinary" }
        );
    }

    let body = {};

    try {
        body = await response.json();
    } catch {
        body = {};
    }

    if (!response.ok || !body.secure_url || !body.public_id) {
        throw new StorageError(
            "UPLOAD_STORAGE_UNAVAILABLE",
            "Durable storage upload failed.",
            503,
            { provider: "cloudinary" }
        );
    }

    return toReference({
        provider: "cloudinary",
        key: body.public_id,
        url: body.secure_url,
        mimeType: file.mimetype,
        size: file.size,
        originalName
    });
}

async function deleteFile(reference = {}, options = {}) {
    const provider = reference.provider || "";

    if (provider === "local" && reference.key) {
        const absolutePath = path.join(__dirname, "../uploads", reference.key);
        await fs.unlink(absolutePath).catch(error => {
            if (error?.code !== "ENOENT") throw error;
        });
        return true;
    }

    if (provider === "cloudinary" && reference.key) {
        if (options.skipRemote) return false;
        const env = options.env || process.env;
        const { cloudName, apiKey, apiSecret } = cloudinaryConfig(env);
        const timestamp = Math.floor(Date.now() / 1000);
        const params = {
            public_id: reference.key,
            timestamp
        };
        const signature = signCloudinaryParams(params, apiSecret);
        const form = new FormData();

        form.append("public_id", reference.key);
        form.append("api_key", apiKey);
        form.append("timestamp", String(timestamp));
        form.append("signature", signature);

        const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`, {
            method: "POST",
            body: form
        });

        return response.ok;
    }

    return false;
}

async function cleanupAfterFailedPersistence(reference) {
    try {
        await deleteFile(reference);
    } catch (error) {
        console.warn("UPLOAD CLEANUP:", {
            code: "UPLOAD_CLEANUP_FAILED",
            provider: reference?.provider || "",
            key: reference?.key || "",
            at: new Date().toISOString()
        });
    }
}

function logStorageError(code, details = {}) {
    console.warn("UPLOAD STORAGE:", {
        code,
        provider: details.provider || getStorageMode(),
        category: details.category || "",
        key: details.key || "",
        orderId: details.orderId || "",
        topupId: details.topupId || "",
        ticketId: details.ticketId || "",
        at: new Date().toISOString()
    });
}

module.exports = {
    StorageError,
    cleanupAfterFailedPersistence,
    createObjectKey,
    deleteFile,
    getStorageMode,
    logStorageError,
    projectFileUrl,
    toReference,
    uploadFile
};
