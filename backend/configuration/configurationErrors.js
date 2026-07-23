class ConfigurationError extends Error {
    constructor(code, message, statusCode = 400, context = {}) {
        super(message);
        this.name = "ConfigurationError";
        this.code = code || "CONFIGURATION_ERROR";
        this.statusCode = statusCode;
        this.context = sanitizeContext(context);
    }
}

function sanitizeContext(context = {}) {
    const safe = {};
    Object.entries(context || {}).forEach(([key, value]) => {
        if (/secret|token|password|cookie|key|uri|connection/i.test(key)) return;
        if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
            safe[key] = value;
        }
    });
    return safe;
}

function toSafeError(error) {
    if (error instanceof ConfigurationError) {
        return {
            code: error.code,
            message: error.message,
            context: error.context
        };
    }
    return {
        code: error?.code || error?.name || "CONFIGURATION_ERROR",
        message: "Configuration registry operation failed."
    };
}

module.exports = {
    ConfigurationError,
    toSafeError
};
