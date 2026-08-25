"use strict";

const mongoose = require("mongoose");
const Supplier = require("../../models/Supplier");
const { SUPPLIER_CURRENCY } = require("../../constants/commerce");

class PricingSupplierError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "PricingSupplierError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function text(value) {
    return String(value || "").trim();
}

function upper(value) {
    return text(value).toUpperCase();
}

function supplierCurrency(supplier = {}) {
    return upper(supplier.supplierCurrency || supplier.balanceCurrency || supplier.metadata?.supplierCurrency);
}

function projectPricingSupplier(supplier = {}) {
    return {
        supplierId: text(supplier._id || supplier.id),
        supplierCode: upper(supplier.supplierCode),
        supplierName: text(supplier.name),
        supplierCurrency: supplierCurrency(supplier),
        mode: upper(supplier.mode || "MANUAL"),
        supportedRegions: Array.isArray(supplier.supportedRegions) ? supplier.supportedRegions.map(upper) : [],
        enabled: supplier.enabled !== false
    };
}

async function resolvePricingSupplier({ supplierId, region = "" } = {}) {
    const id = text(supplierId);
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new PricingSupplierError("PRICING_SUPPLIER_REQUIRED", "Select a valid supplier.");
    }
    const supplier = await Supplier.findOne({ _id: id, enabled: true }).lean();
    if (!supplier) {
        throw new PricingSupplierError("PRICING_SUPPLIER_UNAVAILABLE", "Selected supplier is unavailable.", 409);
    }
    const projected = projectPricingSupplier(supplier);
    const normalizedRegion = upper(region);
    if (projected.supportedRegions.length && normalizedRegion && normalizedRegion !== "ALL" && !projected.supportedRegions.includes(normalizedRegion)) {
        throw new PricingSupplierError("PRICING_SUPPLIER_REGION_UNAVAILABLE", "Selected supplier does not support this region.", 409);
    }
    if (!SUPPLIER_CURRENCY.includes(projected.supplierCurrency)) {
        throw new PricingSupplierError("PRICING_SUPPLIER_CURRENCY_MISSING", "Selected supplier has no pricing currency configured.", 409);
    }
    return projected;
}

module.exports = {
    PricingSupplierError,
    projectPricingSupplier,
    resolvePricingSupplier
};
