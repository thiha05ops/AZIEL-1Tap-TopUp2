"use strict";

const crypto = require("crypto");

const clean = value => String(value == null ? "" : value).trim();
const CUSTOMER_FIELD_PATTERN = /^[a-z][A-Za-z0-9]{0,39}$/;
const PROVIDER_FIELD_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_TYPES = new Set(["text", "numeric-text", "select"]);
const TRANSFORMS = Object.freeze({ DIRECT: "", JOIN_WITH_SPACE: " ", JOIN_WITH_PIPE: "|", JOIN_WITH_COLON: ":", JOIN_WITH_DASH: "-" });
const MAX_FIELDS = 12, MAX_OPTIONS = 100, MAX_OUTPUT_LENGTH = 512;
const customerFieldForProviderField = value => clean(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());

class SupplierFulfillmentContractError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "SupplierFulfillmentContractError";
        this.code = code;
    }
}
const FazerCardsFulfillmentContractError = SupplierFulfillmentContractError;

function normalizedFields(source = {}) {
    let rows = Array.isArray(source.normalizedInputContract?.fields)
        ? source.normalizedInputContract.fields
        : Array.isArray(source.requiredFields) ? source.requiredFields : [];
    const legacyWonddContract = clean(source.normalizedInputContract?.contractId).toUpperCase();
    if (legacyWonddContract === "MLBB_USER_ZONE") rows = rows.map(item => ({ ...item, providerField: "gameid", transformationId: "JOIN_WITH_SPACE", type: item.type || "numeric-text" }));
    if (legacyWonddContract === "FREEFIRE_PLAYER_ID") rows = rows.map(item => ({ ...item, providerField: "gameid", transformationId: "DIRECT" }));
    if (rows.length > MAX_FIELDS) return [];
    const fields = rows.map(item => ({
        customerField: clean(item.azielField || item.customerField || item.name || customerFieldForProviderField(item.providerField)),
        providerField: clean(item.providerField),
        required: item.required !== false,
        label: clean(item.label),
        type: clean(item.type || "text").toLowerCase() === "number" ? "numeric-text" : clean(item.type || "text").toLowerCase(),
        options: Array.isArray(item.options)
            ? item.options.map(option => ({
                label: clean(option?.label || option?.value),
                value: clean(option?.value)
            })).filter(option => option.value)
            : [],
        constraints: (() => { const value=item.constraints&&typeof item.constraints==="object"?item.constraints:{}; const out={}; if(clean(value.pattern)&&clean(value.pattern).length<=160)out.pattern=clean(value.pattern); if(Number.isInteger(Number(value.minLength))&&Number(value.minLength)>=0)out.minLength=Number(value.minLength); if(Number.isInteger(Number(value.maxLength))&&Number(value.maxLength)>0)out.maxLength=Number(value.maxLength); return out; })(),
        evidenceReference: clean(item.evidenceReference),
        transformationId: clean(item.transformationId || "DIRECT").toUpperCase()
    }));
    if (fields.some(item => !CUSTOMER_FIELD_PATTERN.test(item.customerField) || !PROVIDER_FIELD_PATTERN.test(item.providerField) || !FIELD_TYPES.has(item.type) || !Object.hasOwn(TRANSFORMS, item.transformationId))) return [];
    if (fields.some(item => item.label.length > 120 || item.options.length > MAX_OPTIONS || item.options.some(option => !option.value || option.value.length > 160 || option.label.length > 160))) return [];
    if (fields.some(item => item.type === "select" && !item.options.length)) return [];
    if (fields.some(item => item.constraints.pattern && (!isSafePattern(item.constraints.pattern) || item.constraints.pattern.length > 160))) return [];
    if (new Set(fields.map(item => item.customerField)).size !== fields.length) return [];
    const destinations = new Map();
    for (const field of fields) {
        const prior = destinations.get(field.providerField);
        if (prior && (field.transformationId === "DIRECT" || prior !== field.transformationId)) return [];
        destinations.set(field.providerField, field.transformationId);
    }
    return fields;
}

function isSafePattern(value = "") {
    const pattern = clean(value);
    if (!pattern) return true;
    if (/\\[1-9]|\(\?[=!<]|\(\?<[A-Za-z]/.test(pattern)) return false;
    try { new RegExp(pattern); return true; } catch { return false; }
}

function protocolForSupplier(supplierCode = "") {
    const code = clean(supplierCode).toUpperCase();
    if (code === "WONDD") return "WONDD_GAME_ID_TOPUP";
    if (code === "FAZERCARDS") return "FAZERCARDS_TOPUPS_ORDER_V2";
    return "";
}

function providerDestinationAllowed(protocol = "", providerField = "") {
    if (protocol === "WONDD_GAME_ID_TOPUP") return ["gameid", "gameid2", "gameid3"].includes(providerField);
    if (protocol === "FAZERCARDS_TOPUPS_ORDER_V2") return PROVIDER_FIELD_PATTERN.test(providerField);
    return false;
}

function contractFingerprint(value = {}) {
    const fields = Array.isArray(value.fields)
        ? value.fields.map(field => ({
            customerField: clean(field?.customerField), providerField: clean(field?.providerField), required: field?.required !== false,
            label: clean(field?.label), type: clean(field?.type || "text").toLowerCase(),
            ...(clean(field?.type || "text").toLowerCase() === "select" ? { options: field?.options || [] } : {}),
            constraints: field?.constraints || {}, evidenceReference: clean(field?.evidenceReference), transformationId: clean(field?.transformationId || "DIRECT").toUpperCase()
        }))
        : value.fields;

    return crypto.createHash("sha256").update(JSON.stringify({
        supplierProductCode: value.supplierProductCode,
        sourceHash: value.sourceHash,
        protocol: value.protocol,
        transactionalServiceCode: value.transactionalServiceCode,
        decisionVersion: value.decisionVersion,
        noCustomerInput: value.noCustomerInput === true,
        fields
    })).digest("hex");
}

function legacyContractFingerprint(value = {}) {
    const fields = Array.isArray(value.fields)
        ? value.fields.map(field => {
            if (clean(field?.type || "text").toLowerCase() === "select") return field;
            const { options, ...rest } = field || {};
            return rest;
        })
        : value.fields;
    return crypto.createHash("sha256").update(JSON.stringify({
        supplierProductCode: value.supplierProductCode,
        sourceHash: value.sourceHash,
        fields
    })).digest("hex");
}

function contractFromSupplierCatalog({ mapping = {}, offer = {}, supplierProduct = {}, supplierCode = "" } = {}) {
    if (!offer || !supplierProduct) return null;
    const code = clean(supplierCode || mapping.supplierCode || "FAZERCARDS").toUpperCase();
    const exact = ["FAZERCARDS", "WONDD"].includes(code) &&
        clean(mapping.supplierCatalogOfferId) === clean(offer._id) &&
        clean(offer.supplierCatalogProductId) === clean(supplierProduct._id) &&
        clean(mapping.supplierProductCode) === clean(offer.supplierProductCode) &&
        clean(mapping.supplierProductCode) === clean(supplierProduct.supplierProductCode) &&
        clean(mapping.supplierPackageCode) === clean(offer.supplierOfferCode) &&
        clean(offer.catalogLifecycleState).toUpperCase() === "ACTIVE" &&
        clean(supplierProduct.supportState).toUpperCase() === "SUPPORTED";
    const offerAuthority = offer?.metadata?.normalizedInputContract;
    const hasOfferAuthority = Array.isArray(offerAuthority?.fields) || offerAuthority?.noCustomerInput === true;
    const authoritySource = hasOfferAuthority ? offerAuthority : supplierProduct.normalizedInputContract;
    const fields = exact ? normalizedFields({ normalizedInputContract: authoritySource, requiredFields: supplierProduct.requiredFields }) : [];
    const noInput = authoritySource?.noCustomerInput === true;
    if (!fields.length && !noInput) return null;
    const review = authoritySource?.review || {};
    if (review.status === "OWNER_REVIEWED" && clean(review.sourceHash) !== clean(supplierProduct.rawSnapshotHash)) return null;
    const protocol = protocolForSupplier(code);
    if (!protocol || fields.some(field => !providerDestinationAllowed(protocol, field.providerField))) return null;
    const contract = {
        version: 1,
        decisionVersion: Number(authoritySource?.decisionVersion || 1),
        supplierCode: code,
        protocol,
        transactionalServiceCode: clean(authoritySource?.transactionalServiceCode),
        supplierProductCode: clean(mapping.supplierProductCode),
        sourceSupplierCatalogProductId: clean(supplierProduct._id),
        sourceHash: clean(supplierProduct.rawSnapshotHash),
        sourceOfferHash: clean(offer.rawSnapshotHash),
        authorityScope: hasOfferAuthority ? "OFFER" : "PRODUCT",
        noCustomerInput: noInput,
        fields
    };
    return { ...contract, fingerprint: contractFingerprint(contract) };
}

function mappingContractMatchesSupplierCatalog(mapping = {}, supplierProduct = {}) {
    const contract = verifiedMappingContract(mapping);
    if (!contract) return false;
    return clean(contract.sourceSupplierCatalogProductId) === clean(supplierProduct._id) &&
        clean(contract.sourceHash) === clean(supplierProduct.rawSnapshotHash) &&
        (contract.legacyCompatibility === true || clean(contract.fingerprint) === contractFingerprint(contract));
}

function verifiedMappingContract(mapping = {}) {
    const value = mapping.mappingMetadata?.fulfillmentContract;
    if (!value || value.version !== 1 || !["FAZERCARDS_TOPUPS_ORDER_V2", "WONDD_GAME_ID_TOPUP"].includes(value.protocol) || protocolForSupplier(value.supplierCode) !== value.protocol) return null;
    if (clean(value.supplierProductCode) !== clean(mapping.supplierProductCode)) return null;
    let inputFields = value.fields;
    if (value.protocol === "WONDD_GAME_ID_TOPUP" && Array.isArray(inputFields) && inputFields.length && inputFields.every(field => ["userId", "zoneId"].includes(clean(field.customerField)) && ["userId", "zoneId"].includes(clean(field.providerField)))) {
        inputFields = inputFields.map(field => ({ ...field, providerField: "gameid", transformationId: inputFields.length > 1 ? "JOIN_WITH_SPACE" : "DIRECT" }));
    }
    const fields = normalizedFields({ normalizedInputContract: { fields: inputFields } });
    if (!fields.length && value.noCustomerInput !== true) return null;
    if (fields.some(field => !providerDestinationAllowed(value.protocol, field.providerField))) return null;
    const normalized = { ...value, fields };
    if (value.protocol === "WONDD_GAME_ID_TOPUP" && inputFields !== value.fields) return { ...normalized, legacyCompatibility: true };
    if (clean(value.fingerprint) === contractFingerprint(normalized)) return normalized;
    if (clean(value.fingerprint) === legacyContractFingerprint(value)) return { ...normalized, legacyCompatibility: true };
    return null;
}

const CUSTOMER_INPUT_ALIASES = Object.freeze({
    playerId: Object.freeze(["playerId", "userId"]),
    userId: Object.freeze(["userId", "playerId"]),
    serverId: Object.freeze(["serverId", "zoneId"]),
    zoneId: Object.freeze(["zoneId", "serverId"])
});

function inputValue(input = {}, key = "") {
    const accountFields = Array.isArray(input.accountFields) ? input.accountFields : [];
    const aliases = CUSTOMER_INPUT_ALIASES[key] || [key];
    return clean(aliases.map(alias => input[alias]).find(value => clean(value)) || accountFields.find(field => aliases.includes(clean(field?.key)) && clean(field?.value))?.value);
}

function contractErrorCode(contract = {}, neutralCode, fazerCardsCode = neutralCode) {
    return contract.protocol === "FAZERCARDS_TOPUPS_ORDER_V2" ? fazerCardsCode : neutralCode;
}

function buildFieldsFromContract(contract, input = {}) {
    if (!contract || (!contract.fields?.length && contract.noCustomerInput !== true)) throw new FazerCardsFulfillmentContractError("SUPPLIER_INPUT_CONTRACT_NOT_VERIFIED", "A verified supplier input contract is required.");
    if (contract.noCustomerInput === true) return {};
    const declaredCustomerFields = new Set(contract.fields.flatMap(field => CUSTOMER_INPUT_ALIASES[field.customerField] || [field.customerField]));
    const undeclaredAccountField = (Array.isArray(input.accountFields) ? input.accountFields : [])
        .find(field => clean(field?.key) && !declaredCustomerFields.has(clean(field.key)));
    if (undeclaredAccountField) {
        throw new FazerCardsFulfillmentContractError(
            "SUPPLIER_UNDECLARED_INPUT",
            `${clean(undeclaredAccountField.key)} is not declared by the verified customer input contract.`
        );
    }
    const grouped = new Map();
    for (const field of contract.fields) {
        const value = inputValue(input, field.customerField);
        if (field.required && !value) throw new FazerCardsFulfillmentContractError(contractErrorCode(contract, "SUPPLIER_REQUIRED_INPUT_MISSING", "FAZERCARDS_REQUIRED_INPUT_MISSING"), `${field.customerField} is required.`);
        if (value && field.constraints?.minLength != null && value.length < field.constraints.minLength) throw new FazerCardsFulfillmentContractError(contractErrorCode(contract, "SUPPLIER_INPUT_CONSTRAINT_FAILED", "FAZERCARDS_INPUT_CONSTRAINT_FAILED"), `${field.customerField} is shorter than the verified minimum.`);
        if (value && field.constraints?.maxLength != null && value.length > field.constraints.maxLength) throw new FazerCardsFulfillmentContractError(contractErrorCode(contract, "SUPPLIER_INPUT_CONSTRAINT_FAILED", "FAZERCARDS_INPUT_CONSTRAINT_FAILED"), `${field.customerField} exceeds the verified maximum.`);
        if (value && field.constraints?.pattern) { let pattern; try { pattern=new RegExp(field.constraints.pattern); } catch { throw new FazerCardsFulfillmentContractError(contractErrorCode(contract, "SUPPLIER_INPUT_CONTRACT_NOT_VERIFIED", "FAZERCARDS_INPUT_CONTRACT_NOT_VERIFIED"), "The verified input pattern is invalid."); } if(!pattern.test(value))throw new FazerCardsFulfillmentContractError(contractErrorCode(contract, "SUPPLIER_INPUT_CONSTRAINT_FAILED", "FAZERCARDS_INPUT_CONSTRAINT_FAILED"), `${field.customerField} does not match the verified format.`); }
        if (value && field.type === "select") {
            const allowedValues = new Set(
                (Array.isArray(field.options) ? field.options : [])
                    .map(option => clean(option?.value))
                    .filter(Boolean)
            );
            if (!allowedValues.size) {
                throw new FazerCardsFulfillmentContractError(
                    contractErrorCode(contract, "SUPPLIER_INPUT_CONTRACT_NOT_VERIFIED", "FAZERCARDS_INPUT_CONTRACT_NOT_VERIFIED"),
                    `${field.customerField} has no verified select options.`
                );
            }
            if (!allowedValues.has(value)) {
                throw new FazerCardsFulfillmentContractError(
                    contractErrorCode(contract, "SUPPLIER_INPUT_CONSTRAINT_FAILED", "FAZERCARDS_INPUT_CONSTRAINT_FAILED"),
                    `${field.customerField} is not an allowed verified option.`
                );
            }
        }
        if (value && field.type === "numeric-text" && !/^\d+$/.test(value)) throw new FazerCardsFulfillmentContractError("SUPPLIER_INPUT_CONSTRAINT_FAILED", `${field.customerField} must contain digits only.`);
        if (value) {
            const group = grouped.get(field.providerField) || { transformationId: field.transformationId || "DIRECT", values: [] };
            if (group.transformationId !== (field.transformationId || "DIRECT")) throw new FazerCardsFulfillmentContractError("SUPPLIER_INPUT_CONTRACT_NOT_VERIFIED", "Provider destination has conflicting transformations.");
            group.values.push(value); grouped.set(field.providerField, group);
        }
    }
    const output = {};
    for (const [providerField, group] of grouped) {
        if (!providerDestinationAllowed(contract.protocol, providerField) || !Object.hasOwn(TRANSFORMS, group.transformationId)) throw new FazerCardsFulfillmentContractError("SUPPLIER_INPUT_CONTRACT_NOT_VERIFIED", "Supplier input transformation is not supported.");
        if (group.transformationId === "DIRECT" && group.values.length > 1) throw new FazerCardsFulfillmentContractError("SUPPLIER_INPUT_CONTRACT_NOT_VERIFIED", "Direct provider destinations cannot have multiple source fields.");
        const value = group.values.join(TRANSFORMS[group.transformationId]);
        if (value.length > MAX_OUTPUT_LENGTH) throw new FazerCardsFulfillmentContractError("SUPPLIER_INPUT_CONSTRAINT_FAILED", "Supplier input output is too long.");
        if (value) output[providerField] = value;
    }
    return output;
}

function publicCustomerInputContract(contract) {
    if (!contract || (!contract.fields?.length && contract.noCustomerInput !== true)) return null;
    return {
        verified: true,
        version: Number(contract.decisionVersion || contract.version || 1),
        noCustomerInput: contract.noCustomerInput === true,
        fields: contract.fields.map((field, index) => ({
            key: field.customerField,
            label: field.label || field.customerField.replace(/([A-Z])/g, " $1").replace(/^./, value => value.toUpperCase()),
            selector: index === 0 ? "#userId" : `#supplierInput${index + 1}`,
            required: field.required,
            type: field.type || "text",
            options: Array.isArray(field.options)
                ? field.options.map(option => ({ label: option.label, value: option.value }))
                : [],
            constraints: field.constraints || {},
            requiredMessage: `${field.label || field.customerField} is required.`
        }))
    };
}

module.exports = Object.freeze({
    SupplierFulfillmentContractError,
    FazerCardsFulfillmentContractError,
    buildFieldsFromContract,
    contractFromSupplierCatalog,
    contractFingerprint,
    normalizedFields,
    isSafePattern,
    protocolForSupplier,
    providerDestinationAllowed,
    TRANSFORMS,
    mappingContractMatchesSupplierCatalog,
    customerFieldForProviderField,
    publicCustomerInputContract,
    verifiedMappingContract
});
