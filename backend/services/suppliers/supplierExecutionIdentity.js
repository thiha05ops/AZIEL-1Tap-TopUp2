"use strict";

const clean = value => String(value == null ? "" : value).trim();

function transactionalServiceCode({ mapping = {}, supplierProduct = {}, offer = {} } = {}) {
    const contract = mapping.mappingMetadata?.fulfillmentContract || {};
    return clean(contract.transactionalServiceCode || contract.executionIdentity?.servicecode || contract.executionIdentity?.serviceCode) ||
        clean(offer.metadata?.normalizedInputContract?.transactionalServiceCode || offer.metadata?.transactionalServiceCode) ||
        clean(supplierProduct.normalizedInputContract?.transactionalServiceCode || supplierProduct.metadata?.transactionalServiceCode);
}

module.exports = Object.freeze({ transactionalServiceCode });
