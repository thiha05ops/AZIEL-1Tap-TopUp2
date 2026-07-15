class SupplierAdapterError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "SupplierAdapterError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const manualSupplierAdapter = Object.freeze({
    isConfigured() {
        return true;
    },
    async submitFulfillment() {
        throw new SupplierAdapterError(
            "MANUAL_SUPPLIER_REQUIRES_ADMIN_ACTION",
            "Manual supplier fulfillment must be performed and resolved by an Admin.",
            409
        );
    },
    async getBalance() {
        return {
            status: "PENDING",
            supplierReference: "",
            supplierCode: "",
            providerStatus: "MANUAL_BALANCE_NOT_AUTOMATED",
            failureCode: "",
            safeMessage: "Manual supplier balance is not fetched automatically.",
            rawMetadata: {}
        };
    }
});

function normalizeSupplierResult(input = {}) {
    const allowedStatuses = new Set(["SUCCEEDED", "FAILED", "PENDING"]);
    const status = allowedStatuses.has(String(input.status || "").toUpperCase())
        ? String(input.status).toUpperCase()
        : "PENDING";

    return {
        status,
        supplierReference: String(input.supplierReference || "").trim().slice(0, 160),
        supplierCode: String(input.supplierCode || "").trim().toUpperCase().slice(0, 40),
        providerStatus: String(input.providerStatus || "").trim().slice(0, 80),
        failureCode: String(input.failureCode || "").trim().slice(0, 80),
        safeMessage: String(input.safeMessage || "").trim().slice(0, 500),
        rawMetadata: sanitizeProviderMetadata(input.rawMetadata || {})
    };
}

function sanitizeProviderMetadata(value, depth = 0) {
    if (depth > 3) return "[omitted]";
    if (value == null) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeProviderMetadata(item, depth + 1));
    if (typeof value === "object") {
        const safe = {};
        Object.entries(value).forEach(([key, item]) => {
            if (/password|secret|token|authorization|signature|jwt|key/i.test(key)) return;
            safe[key] = sanitizeProviderMetadata(item, depth + 1);
        });
        return safe;
    }
    if (typeof value === "string") return value.slice(0, 300);
    if (typeof value === "number" || typeof value === "boolean") return value;
    return String(value).slice(0, 300);
}

function getSupplierAdapter(supplier) {
    if (String(supplier?.mode || "").toUpperCase() === "MANUAL") return manualSupplierAdapter;

    return {
        isConfigured() {
            return false;
        },
        async submitFulfillment() {
            throw new SupplierAdapterError(
                "SUPPLIER_ADAPTER_NOT_CONFIGURED",
                "Supplier API adapter is not configured.",
                409
            );
        },
        async getBalance() {
            throw new SupplierAdapterError(
                "SUPPLIER_ADAPTER_NOT_CONFIGURED",
                "Supplier API adapter is not configured.",
                409
            );
        }
    };
}

module.exports = {
    SupplierAdapterError,
    getSupplierAdapter,
    normalizeSupplierResult,
    sanitizeProviderMetadata
};
