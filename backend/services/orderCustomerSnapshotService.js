function normalizeEmail(value = "") {
    return String(value || "").trim().toLowerCase();
}

function normalizeUserId(value = "") {
    return String(value || "").trim() || null;
}

function buildOrderCustomerSnapshot(user = {}) {
    return {
        customerEmail: normalizeEmail(user.email),
        customerUserId: normalizeUserId(user._id || user.id)
    };
}

module.exports = {
    buildOrderCustomerSnapshot,
    normalizeEmail
};
