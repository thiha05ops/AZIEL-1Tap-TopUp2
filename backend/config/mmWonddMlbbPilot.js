"use strict";

const PILOT_IDENTITY = Object.freeze({
    supplierCode: "WONDD",
    productCode: "mlbb",
    packageCode: "MLBB_55_DIA_FIRST_TOPUP",
    supplierProductCode: "mlbb",
    supplierPackageCode: "MLFT055",
    customerMarket: "MM"
});

function isPilotEnabled(env = process.env) {
    return String(env.AZIEL_MM_WONDD_MLBB_PILOT_ENABLED || "").trim().toLowerCase() === "true";
}

function matchesPilotRoute({ mapping = {}, productCode = "", packageCode = "", customerMarket = "" } = {}) {
    return String(mapping.supplierCode || "").toUpperCase() === PILOT_IDENTITY.supplierCode &&
        String(mapping.productCode || productCode).toLowerCase() === PILOT_IDENTITY.productCode &&
        String(mapping.packageCode || packageCode).toUpperCase() === PILOT_IDENTITY.packageCode &&
        String(mapping.supplierProductCode || "").toLowerCase() === PILOT_IDENTITY.supplierProductCode &&
        String(mapping.supplierPackageCode || "").toUpperCase() === PILOT_IDENTITY.supplierPackageCode &&
        String(customerMarket || "").toUpperCase() === PILOT_IDENTITY.customerMarket;
}

module.exports = Object.freeze({ PILOT_IDENTITY, isPilotEnabled, matchesPilotRoute });
