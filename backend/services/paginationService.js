const mongoose = require("mongoose");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

class PaginationError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "PaginationError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function parseLimit(value, options = {}) {
    const fallback = Number(options.defaultLimit || DEFAULT_LIMIT);
    const max = Number(options.maxLimit || MAX_LIMIT);
    const min = Number(options.minLimit || 1);
    const parsed = Number(value || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.floor(parsed), min), max);
}

function encodeCursor(doc = {}) {
    const createdAt = doc.createdAt ? new Date(doc.createdAt) : null;
    const id = String(doc._id || doc.id || "");
    if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) return "";
    return Buffer.from(JSON.stringify({
        createdAt: createdAt.toISOString(),
        id
    })).toString("base64url");
}

function decodeCursor(cursor = "") {
    const value = String(cursor || "").trim();
    if (!value) return null;

    try {
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
        const createdAt = new Date(parsed.createdAt);
        const id = String(parsed.id || "");

        if (Number.isNaN(createdAt.getTime()) || !mongoose.Types.ObjectId.isValid(id)) {
            throw new Error("Invalid cursor");
        }

        return {
            createdAt,
            _id: new mongoose.Types.ObjectId(id)
        };
    } catch (error) {
        const legacyCreatedAt = new Date(value);
        if (!Number.isNaN(legacyCreatedAt.getTime())) {
            return {
                createdAt: legacyCreatedAt,
                _id: new mongoose.Types.ObjectId("ffffffffffffffffffffffff")
            };
        }

        throw new PaginationError("INVALID_CURSOR", "Invalid pagination cursor.");
    }
}

function applyCursorFilter(filter = {}, cursor = "") {
    const decoded = decodeCursor(cursor);
    if (!decoded) return filter;

    return {
        ...filter,
        $and: [
            ...(Array.isArray(filter.$and) ? filter.$and : []),
            {
                $or: [
                    { createdAt: { $lt: decoded.createdAt } },
                    { createdAt: decoded.createdAt, _id: { $lt: decoded._id } }
                ]
            }
        ]
    };
}

function pageResult(items = [], limit) {
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
        page,
        pagination: {
            limit,
            hasMore,
            nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : ""
        }
    };
}

function escapeRegex(value = "") {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearch(value = "", options = {}) {
    const maxLength = Number(options.maxLength || 80);
    return String(value || "").trim().slice(0, maxLength);
}

function sendPaginationError(res, error) {
    if (error instanceof PaginationError) {
        return res.status(error.statusCode).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }
    return null;
}

module.exports = {
    DEFAULT_LIMIT,
    MAX_LIMIT,
    PaginationError,
    applyCursorFilter,
    decodeCursor,
    encodeCursor,
    escapeRegex,
    normalizeSearch,
    pageResult,
    parseLimit,
    sendPaginationError
};
