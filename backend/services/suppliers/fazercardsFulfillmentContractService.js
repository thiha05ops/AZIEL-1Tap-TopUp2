"use strict";

const crypto = require("crypto");

const clean = value => String(value == null ? "" : value).trim();
const CUSTOMER_FIELD_PATTERN = /^[a-z][A-Za-z0-9]{0,39}$/;
const PROVIDER_FIELD_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const customerFieldForProviderField = value => clean(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());

class FazerCardsFulfillmentContractError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "FazerCardsFulfillmentContractError";
        this.code = code;
    }
}

function normalizedFields(source = {}) {
    const rows = Array.isArray(source.normalizedInputContract?.fields)
        ? source.normalizedInputContract.fields
        : Array.isArray(source.requiredFields) ? source.requiredFields : [];
    const fields = rows.map(item => ({
        customerField: clean(item.azielField || item.customerField || item.name || customerFieldForProviderField(item.providerField)),
        providerField: clean(item.providerField),
        required: item.required !== false,
        label: clean(item.label),
        type: clean(item.type || "text").toLowerCase(),
        constraints: (() => { const value=item.constraints&&typeof item.constraints==="object"?item.constraints:{}; const out={}; if(clean(value.pattern)&&clean(value.pattern).length<=160)out.pattern=clean(value.pattern); if(Number.isInteger(Number(value.minLength))&&Number(value.minLength)>=0)out.minLength=Number(value.minLength); if(Number.isInteger(Number(value.maxLength))&&Number(value.maxLength)>0)out.maxLength=Number(value.maxLength); return out; })(),
        evidenceReference: clean(item.evidenceReference),
        transformationId: clean(item.transformationId)
    }));
    if (!fields.length || fields.some(item => !CUSTOMER_FIELD_PATTERN.test(item.customerField) || !PROVIDER_FIELD_PATTERN.test(item.providerField))) return [];
    if (new Set(fields.map(item => item.customerField)).size !== fields.length) return [];
    if (new Set(fields.map(item => item.providerField)).size !== fields.length) return [];
    return fields;
}

function contractFingerprint(value = {}) {
    return crypto.createHash("sha256").update(JSON.stringify({
        supplierProductCode: value.supplierProductCode,
        sourceHash: value.sourceHash,
        fields: value.fields
    })).digest("hex");
}

function contractFromSupplierCatalog({ mapping = {}, offer = {}, supplierProduct = {} } = {}) {
    if (!offer || !supplierProduct) return null;
    const exact = clean(mapping.supplierCode).toUpperCase() === "FAZERCARDS" &&
        clean(mapping.supplierCatalogOfferId) === clean(offer._id) &&
        clean(offer.supplierCatalogProductId) === clean(supplierProduct._id) &&
        clean(mapping.supplierProductCode) === clean(offer.supplierProductCode) &&
        clean(mapping.supplierProductCode) === clean(supplierProduct.supplierProductCode) &&
        clean(mapping.supplierPackageCode) === clean(offer.supplierOfferCode) &&
        clean(offer.catalogLifecycleState).toUpperCase() === "ACTIVE" &&
        clean(supplierProduct.supportState).toUpperCase() === "SUPPORTED";
    const fields = exact ? normalizedFields(supplierProduct) : [];
    if (!fields.length) return null;
    const review = supplierProduct.normalizedInputContract?.review || {};
    if (review.status === "OWNER_REVIEWED" && clean(review.sourceHash) !== clean(supplierProduct.rawSnapshotHash)) return null;
    const contract = {
        version: 1,
        supplierCode: "FAZERCARDS",
        protocol: "FAZERCARDS_TOPUPS_ORDER_V2",
        supplierProductCode: clean(mapping.supplierProductCode),
        sourceSupplierCatalogProductId: clean(supplierProduct._id),
        sourceHash: clean(supplierProduct.rawSnapshotHash),
        fields
    };
    return { ...contract, fingerprint: contractFingerprint(contract) };
}

function mappingContractMatchesSupplierCatalog(mapping = {}, supplierProduct = {}) {
    const contract = verifiedMappingContract(mapping);
    if (!contract) return false;
    return clean(contract.sourceSupplierCatalogProductId) === clean(supplierProduct._id) &&
        clean(contract.sourceHash) === clean(supplierProduct.rawSnapshotHash) &&
        clean(contract.fingerprint) === contractFingerprint(contract);
}

function verifiedMappingContract(mapping = {}) {
    const value = mapping.mappingMetadata?.fulfillmentContract;
    if (!value || value.version !== 1 || value.supplierCode !== "FAZERCARDS" || value.protocol !== "FAZERCARDS_TOPUPS_ORDER_V2") return null;
    if (clean(value.supplierProductCode) !== clean(mapping.supplierProductCode)) return null;
    const fields = normalizedFields({ normalizedInputContract: { fields: value.fields } });
    if (!fields.length) return null;
    const normalized = { ...value, fields };
    return clean(value.fingerprint) === contractFingerprint(normalized) ? normalized : null;
}

function inputValue(input = {}, key = "") {
    const accountFields = Array.isArray(input.accountFields) ? input.accountFields : [];
    const direct = input[key];
    const aliases = key === "playerId" ? ["playerId", "userId"] : key === "userId" ? ["userId", "playerId"] : [key];
    return clean(direct || aliases.map(alias => input[alias]).find(Boolean) || accountFields.find(field => aliases.includes(clean(field?.key)))?.value);
}

function buildFieldsFromContract(contract, input = {}) {
    if (!contract?.fields?.length) throw new FazerCardsFulfillmentContractError("FAZERCARDS_INPUT_CONTRACT_NOT_VERIFIED", "A verified FazerCards input contract is required.");
    const output = {};
    for (const field of contract.fields) {
        const value = inputValue(input, field.customerField);
        if (field.required && !value) throw new FazerCardsFulfillmentContractError("FAZERCARDS_REQUIRED_INPUT_MISSING", `${field.customerField} is required.`);
        if (value && field.constraints?.minLength != null && value.length < field.constraints.minLength) throw new FazerCardsFulfillmentContractError("FAZERCARDS_INPUT_CONSTRAINT_FAILED", `${field.customerField} is shorter than the verified minimum.`);
        if (value && field.constraints?.maxLength != null && value.length > field.constraints.maxLength) throw new FazerCardsFulfillmentContractError("FAZERCARDS_INPUT_CONSTRAINT_FAILED", `${field.customerField} exceeds the verified maximum.`);
        if (value && field.constraints?.pattern) { let pattern; try { pattern=new RegExp(field.constraints.pattern); } catch { throw new FazerCardsFulfillmentContractError("FAZERCARDS_INPUT_CONTRACT_NOT_VERIFIED", "The verified input pattern is invalid."); } if(!pattern.test(value))throw new FazerCardsFulfillmentContractError("FAZERCARDS_INPUT_CONSTRAINT_FAILED", `${field.customerField} does not match the verified format.`); }
        if (value) output[field.providerField] = value;
    }
    return output;
}

function publicCustomerInputContract(contract) {
    if (!contract?.fields?.length) return null;
    return {
        verified: true,
        fields: contract.fields.map((field, index) => ({
            key: field.customerField,
            label: field.label || field.customerField.replace(/([A-Z])/g, " $1").replace(/^./, value => value.toUpperCase()),
            selector: index === 0 ? "#userId" : `#supplierInput${index + 1}`,
            required: field.required,
            type: field.type || "text",
            constraints: field.constraints || {},
            requiredMessage: `${field.label || field.customerField} is required.`
        }))
    };
}

module.exports = Object.freeze({
    FazerCardsFulfillmentContractError,
    buildFieldsFromContract,
    contractFromSupplierCatalog,
    contractFingerprint,
    normalizedFields,
    mappingContractMatchesSupplierCatalog,
    customerFieldForProviderField,
    publicCustomerInputContract,
    verifiedMappingContract
});
