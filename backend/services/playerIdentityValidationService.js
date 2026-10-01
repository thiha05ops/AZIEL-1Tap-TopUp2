const fazercardsAdapter = require("./suppliers/fazercardsAdapter");
const {
    buildFazerCardsValidationFields,
    FazerCardsInputError
} = require("./suppliers/fazercardsInputFormatters");
const {
    gameFamilyForProduct,
    inputContractForProduct
} = require("./commerce/canonicalGameInputContract");

const VALIDATION_CATEGORY_BY_GAME = Object.freeze({
    mlbb: "mobile_legends",
    freefire: "free_fire",
    pubg: "pubg_mobile"
});

class PlayerIdentityValidationError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "PlayerIdentityValidationError";
        this.code = code;
        this.statusCode = details.statusCode || 400;
        this.retryable = Boolean(details.retryable);
    }
}

function clean(value) {
    return String(value == null ? "" : value).trim();
}

function validationCategoryForProduct(productCode) {
    const family = clean(gameFamilyForProduct(productCode)).toLowerCase();
    return VALIDATION_CATEGORY_BY_GAME[family] || "";
}

function supportsPlayerIdentityValidation(productCode) {
    return Boolean(validationCategoryForProduct(productCode));
}

function playerIdentityValidationCapability(productCode) {
    const normalizedProductCode = clean(productCode);
    const supported = supportsPlayerIdentityValidation(normalizedProductCode);
    const contract = supported ? inputContractForProduct(normalizedProductCode) : null;
    return {
        supported,
        accountFieldKeys: contract ? [...contract.required, ...contract.optional] : []
    };
}

async function validatePlayerIdentity({
    productCode,
    userId,
    zoneId,
    accountFields = []
} = {}, dependencies = {}) {
    const normalizedProductCode = clean(productCode);

    if (!normalizedProductCode) {
        throw new PlayerIdentityValidationError(
            "PLAYER_VALIDATION_PRODUCT_REQUIRED",
            "Product code is required."
        );
    }

    const validationCategoryId =
        validationCategoryForProduct(normalizedProductCode);

    if (!validationCategoryId) {
        return {
            supported: false,
            available: false,
            valid: false,
            playerName: "",
            providerStatus: "UNSUPPORTED"
        };
    }

    let fields;

    try {
        fields = buildFazerCardsValidationFields(normalizedProductCode, {
            userId,
            zoneId,
            accountFields
        });
    } catch (error) {
        if (error instanceof FazerCardsInputError) {
            throw new PlayerIdentityValidationError(
                error.code || "PLAYER_VALIDATION_INPUT_INVALID",
                error.message,
                { statusCode: 400 }
            );
        }

        throw error;
    }

    try {
        const adapter = dependencies.adapter || fazercardsAdapter;
        const result = await adapter.validatePlayerId({
            validationCategoryId,
            fields
        });

        return {
            supported: true,
            available: true,
            valid: result.valid === true,
            playerName: clean(result.playerName),
            playerId: clean(result.playerId),
            region: clean(result.region),
            providerStatus: clean(result.providerStatus),
            message: clean(result.safeMessage)
        };
    } catch (error) {
        /*
         * Provider/configuration/subscription/transport failures must never
         * be interpreted as an invalid customer game account.
         */
        const providerUnavailable =
            error?.code === "FAZERCARDS_NOT_CONFIGURED" ||
            error?.code === "FAZERCARDS_TRANSPORT_ERROR" ||
            error?.code === "FAZERCARDS_VALIDATION_RESPONSE_INVALID" ||
            /^FAZERCARDS_HTTP_(401|403|429|5\d\d)$/.test(clean(error?.code));

        if (providerUnavailable) {
            return {
                supported: true,
                available: false,
                valid: false,
                playerName: "",
                providerStatus: "UNAVAILABLE",
                message: "Player verification is temporarily unavailable."
            };
        }

        throw new PlayerIdentityValidationError(
            error?.code || "PLAYER_VALIDATION_FAILED",
            error?.message || "Player validation failed.",
            {
                statusCode: Number(error?.statusCode) || 502,
                retryable: Boolean(error?.retryable)
            }
        );
    }
}

module.exports = {
    PlayerIdentityValidationError,
    VALIDATION_CATEGORY_BY_GAME,
    validationCategoryForProduct,
    supportsPlayerIdentityValidation,
    playerIdentityValidationCapability,
    validatePlayerIdentity
};
