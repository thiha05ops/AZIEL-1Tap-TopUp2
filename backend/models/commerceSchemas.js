const mongoose = require("mongoose");
const {
    ROUNDING_MODE,
    PROMOTION_SCOPE,
    ELIGIBILITY_OPERATOR,
    ELIGIBILITY_COMPARATOR
} = require("../constants/commerce");

const MAX_METADATA_BYTES = 8192;
const MAX_ELIGIBILITY_DEPTH = 5;
const FORBIDDEN_METADATA_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

const percentValidator = {
    validator(value) {
        return value === undefined || value === null || (value >= 0 && value <= 100);
    },
    message: "Percentage value must be between 0 and 100."
};

const moneyRuleSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ["FIXED", "PERCENT"],
            default: "FIXED"
        },
        value: {
            type: Number,
            min: 0,
            default: 0,
            validate: {
                validator(value) {
                    return this.type !== "PERCENT" || percentValidator.validator(value);
                },
                message: "Percent rule value must be between 0 and 100."
            }
        },
        enabled: {
            type: Boolean,
            default: false
        }
    },
    { _id: false }
);

const profitRuleSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ["FIXED", "PERCENT"],
            default: "PERCENT"
        },
        value: {
            type: Number,
            min: 0,
            default: 0,
            validate: {
                validator(value) {
                    return this.type !== "PERCENT" || percentValidator.validator(value);
                },
                message: "Profit percent value must be between 0 and 100."
            }
        }
    },
    { _id: false }
);

const roundingRuleSchema = new mongoose.Schema(
    {
        mode: {
            type: String,
            enum: ROUNDING_MODE,
            default: "NONE"
        },
        increment: {
            type: Number,
            min: 0,
            default: 0
        },
        psychologicalEnding: {
            type: Number,
            min: 0,
            default: 0
        },
        enabled: {
            type: Boolean,
            default: false
        }
    },
    { _id: false }
);

const promotionScopeSchema = new mongoose.Schema(
    {
        scopeType: {
            type: String,
            enum: PROMOTION_SCOPE,
            required: true
        },
        scopeReference: {
            type: String,
            trim: true,
            default: ""
        }
    },
    { _id: false }
);

const packageIdentitySchema = new mongoose.Schema(
    {
        packageId: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        },
        packageCode: {
            type: String,
            trim: true,
            uppercase: true,
            default: ""
        },
        packageRef: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CatalogPackage",
            default: null
        }
    },
    { _id: false }
);

const eligibilityConditionSchema = new mongoose.Schema(
    {},
    { _id: false }
);

eligibilityConditionSchema.add({
    operator: {
        type: String,
        enum: ELIGIBILITY_OPERATOR,
        default: undefined
    },
    conditions: {
        type: [eligibilityConditionSchema],
        default: []
    },
    field: {
        type: String,
        trim: true,
        default: ""
    },
    comparator: {
        type: String,
        enum: ELIGIBILITY_COMPARATOR,
        default: undefined
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
        default: undefined
    },
    values: {
        type: [mongoose.Schema.Types.Mixed],
        default: undefined
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
});

const eligibilitySchema = new mongoose.Schema(
    {
        operator: {
            type: String,
            enum: ELIGIBILITY_OPERATOR,
            required: true,
            default: "ALL"
        },
        conditions: {
            type: [eligibilityConditionSchema],
            default: []
        }
    },
    { _id: false }
);

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function hasForbiddenMetadataKey(value) {
    if (!value || typeof value !== "object") {
        return false;
    }

    return Object.keys(value).some(key => (
        FORBIDDEN_METADATA_KEYS.includes(key) ||
        hasForbiddenMetadataKey(value[key])
    ));
}

function isSafeMetadata(value) {
    if (value === undefined || value === null) {
        return true;
    }

    if (!isPlainObject(value)) {
        return false;
    }

    if (hasForbiddenMetadataKey(value)) {
        return false;
    }

    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_METADATA_BYTES;
    } catch (error) {
        return false;
    }
}

function applyMetadataValidation(schema, pathName = "metadata") {
    schema.path(pathName)?.validate({
        validator: isSafeMetadata,
        message: `${pathName} must be a plain object without dangerous keys.`
    });
}

function eligibilityDepth(value, depth = 1) {
    if (!value?.conditions?.length) {
        return depth;
    }

    return Math.max(...value.conditions.map(condition => eligibilityDepth(condition, depth + 1)));
}

function validateEligibilityDepth(schema, pathName = "eligibility") {
    schema.path(pathName)?.validate({
        validator(value) {
            return !value || eligibilityDepth(value) <= MAX_ELIGIBILITY_DEPTH;
        },
        message: `${pathName} nesting is too deep.`
    });
}

function validateStartBeforeEnd(startField, endField) {
    return function validateDateRange() {
        const start = this[startField];
        const end = this[endField];
        if (start && end && end < start) {
            this.invalidate(endField, `${endField} must be after ${startField}.`);
        }
    };
}

module.exports = {
    moneyRuleSchema,
    profitRuleSchema,
    roundingRuleSchema,
    promotionScopeSchema,
    packageIdentitySchema,
    eligibilitySchema,
    percentValidator,
    applyMetadataValidation,
    validateEligibilityDepth,
    validateStartBeforeEnd
};
