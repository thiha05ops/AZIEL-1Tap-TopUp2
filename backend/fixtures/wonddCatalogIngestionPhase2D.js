"use strict";

const rows = Object.freeze([
    { serviceid: "9622", packcode: "ML00086", name: "86 Diamonds", point: 86, amount: 60, discount: 0, netpricedealer: 58 },
    { serviceid: "9602", packcode: "F00033", name: "100 Diamonds", point: 100, amount: 35, discount: 0, netpricedealer: 34 },
    { serviceid: "9604", packcode: "BCM001", name: "Black Crystal 100", point: 100, amount: 40, discount: 0, netpricedealer: 39 },
    { serviceid: "9624", packcode: "HTP001", name: "60 Heartopia Crystals", point: 60, amount: 30, discount: 0, netpricedealer: 29 },
    { serviceid: "9624", packcode: "ASSOC01", name: "Association Gift Box", point: 0, amount: 55, discount: 0, netpricedealer: 53 }
]);

const mappings = Object.freeze([
    { supplierCode: "WONDD", supplierProductCode: "mlbb", supplierPackageCode: "ML00086" },
    { supplierCode: "WONDD", supplierProductCode: "freefire", supplierPackageCode: "F00033" },
    { supplierCode: "WONDD", supplierProductCode: "HTP", supplierPackageCode: "HTP001" }
]);

function reader(overrides = {}) {
    return { async listPackages() { if (overrides.error) throw overrides.error; return { rows: overrides.rows || rows, completenessEvidence: overrides.completenessEvidence || "SINGLE_RESPONSE_COMPLETENESS_UNPROVEN" }; } };
}

module.exports = Object.freeze({ rows, mappings, reader });
