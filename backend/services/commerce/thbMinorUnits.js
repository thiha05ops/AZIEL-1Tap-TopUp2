"use strict";

class ThbMinorUnitError extends Error {
    constructor(message) {
        super(message);
        this.name = "ThbMinorUnitError";
        this.code = "INVALID_THB_AMOUNT";
    }
}

function toThbSatang(value) {
    if (typeof value !== "number" && typeof value !== "string") {
        throw new ThbMinorUnitError("THB amount must be a number or decimal string.");
    }
    const source = typeof value === "number" ? String(value) : value.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(source)) {
        throw new ThbMinorUnitError("THB amount has invalid precision or format.");
    }
    const [bahtPart, fraction = ""] = source.split(".");
    const baht = Number(bahtPart);
    const satang = Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(baht) || !Number.isSafeInteger(satang)) {
        throw new ThbMinorUnitError("THB amount is outside the safe range.");
    }
    const result = (baht * 100) + satang;
    if (!Number.isSafeInteger(result)) {
        throw new ThbMinorUnitError("THB amount is outside the safe range.");
    }
    return result;
}

module.exports = Object.freeze({ ThbMinorUnitError, toThbSatang });
