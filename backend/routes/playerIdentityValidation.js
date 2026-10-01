const express = require("express");
const rateLimit = require("express-rate-limit");

const {
    PlayerIdentityValidationError,
    playerIdentityValidationCapability,
    validatePlayerIdentity
} = require("../services/playerIdentityValidationService");

const router = express.Router();

const playerValidationLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_PLAYER_VALIDATION || 20),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        code: "PLAYER_VALIDATION_RATE_LIMITED",
        message: "Too many player verification requests. Please try again shortly."
    }
});

function clean(value) {
    return String(value == null ? "" : value).trim();
}

function safeAccountFields(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 12) {
        throw new PlayerIdentityValidationError("PLAYER_VALIDATION_INPUT_INVALID", "Account information is invalid.");
    }
    return value.map(field => {
        const key = clean(field?.key);
        const fieldValue = clean(field?.value);
        if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(key) || fieldValue.length > 128) {
            throw new PlayerIdentityValidationError("PLAYER_VALIDATION_INPUT_INVALID", "Account information is invalid.");
        }
        return { key, value: fieldValue };
    });
}

router.get(
    "/player-identity/capability",
    playerValidationLimiter,
    (req, res) => {
        const capability = playerIdentityValidationCapability(clean(req.query?.productCode));
        return res.status(200).json({ success: true, capability });
    }
);

router.post(
    "/player-identity/validate",
    playerValidationLimiter,
    async (req, res) => {
        try {
            const productCode = clean(req.body?.productCode);
            const userId = clean(req.body?.userId);
            const zoneId = clean(req.body?.zoneId);
            const accountFields = safeAccountFields(req.body?.accountFields);

            const result = await validatePlayerIdentity({
                productCode,
                userId,
                zoneId,
                accountFields
            });

            return res.status(200).json({
                success: true,
                validation: {
                    supported: result.supported === true,
                    available: result.available === true,
                    valid: result.valid === true,
                    playerName: clean(result.playerName),
                    region: clean(result.region),
                    message: result.available === true && result.valid !== true
                        ? "Player ID or account information is invalid."
                        : ""
                }
            });
        } catch (error) {
            if (error instanceof PlayerIdentityValidationError) {
                return res.status(error.statusCode || 400).json({
                    success: false,
                    code: error.code,
                    message: error.message
                });
            }

            console.error(
                "Player identity validation error:",
                error?.code || error?.name || "PLAYER_VALIDATION_FAILED"
            );

            return res.status(502).json({
                success: false,
                code: "PLAYER_VALIDATION_FAILED",
                message: "Player verification is temporarily unavailable."
            });
        }
    }
);

module.exports = router;
