"use strict";

function normalizeRouteProductCode(value = "") {
    const productCode = String(value || "").trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]{0,79}$/.test(productCode) ? productCode : "";
}

function resolveProductRoute(value = "") {
    const productCode = normalizeRouteProductCode(value);
    return productCode ? `/products/${encodeURIComponent(productCode)}` : "";
}

module.exports = Object.freeze({ normalizeRouteProductCode, resolveProductRoute });
