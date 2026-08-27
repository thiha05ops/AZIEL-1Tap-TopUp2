const WONDD_FAMILIES = Object.freeze({
    "9601": { game: "RoV", serviceCode: "rov", productCode: "aovid", packagePrefix: "ROV" },
    "9602": { game: "Free Fire", serviceCode: "freefire", productCode: "freefire", packagePrefix: "FF", inputContract: "FREEFIRE_PLAYER_ID" },
    "9603": { game: "Undawn", serviceCode: "undawn", productCode: "undawn", packagePrefix: "UNDAWN" },
    "9604": { game: "Black Clover M", serviceCode: "", productCode: "", packagePrefix: "BCM", unsupportedReason: "NEEDS_SERVICECODE" },
    "9605": { game: "Call of Duty Mobile", serviceCode: "callofduty", productCode: "callofduty", packagePrefix: "CODM" },
    "9606": { game: "Delta Force", serviceCode: "deltaforce", productCode: "deltaforce", packagePrefix: "DELTA" },
    "9607": { game: "Haikyu!! Fly High", serviceCode: "haikyuflyhigh", productCode: "haikyuflyhigh", packagePrefix: "HAIKYU" },
    "9621": { game: "PUBG Mobile", serviceCode: "pubg", productCode: "pubg", packagePrefix: "PUBG" },
    "9622": { game: "Mobile Legends: Bang Bang", serviceCode: "mlbb", productCode: "mlbb", packagePrefix: "MLBB", inputContract: "MLBB_USER_ZONE" },
    "9623": { game: "Valorant", serviceCode: "val", productCode: "valorant", packagePrefix: "VAL" },
    "9624": { game: "Heartopia", serviceCode: "HTP", productCode: "heartopia", packagePrefix: "HTP", packageFilter: row => /^HTP\d/.test(String(row.packcode || "")) }
});

const CONFIRMED_SERVICE_CODES = Object.freeze(Object.fromEntries(
    Object.values(WONDD_FAMILIES).filter(item => item.serviceCode).map(item => [item.productCode, item.serviceCode])
));

function familyForServiceId(serviceId) {
    return WONDD_FAMILIES[String(serviceId)] || null;
}

function resolveFamilyForServiceCode(serviceCode, families = WONDD_FAMILIES) {
    const normalized = String(serviceCode == null ? "" : serviceCode).trim().toLowerCase();
    if (!normalized) {
        const error = new Error("WonDD supplier servicecode is required.");
        error.code = "WONDD_SERVICE_CODE_MISSING";
        throw error;
    }

    const matches = Object.entries(families).filter(([, family]) => (
        String(family?.serviceCode || "").trim().toLowerCase() === normalized
    ));
    if (matches.length !== 1) {
        const error = new Error(matches.length
            ? `WonDD supplier servicecode is ambiguous: ${serviceCode}`
            : `WonDD supplier servicecode is not authoritative: ${serviceCode}`);
        error.code = matches.length ? "WONDD_SERVICE_CODE_AMBIGUOUS" : "WONDD_SERVICE_CODE_UNKNOWN";
        throw error;
    }

    const [serviceId, family] = matches[0];
    return { serviceId, family };
}

module.exports = { WONDD_FAMILIES, CONFIRMED_SERVICE_CODES, familyForServiceId, resolveFamilyForServiceCode };
