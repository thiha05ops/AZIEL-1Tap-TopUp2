function processorFor(supplierCode) {
    const code = String(supplierCode || "").trim().toUpperCase();
    if (code === "WONDD") return require("./wonddFulfillmentProcessor").processor;
    if (code === "FAZERCARDS") return require("./fazercardsFulfillmentProcessor").processor;
    return null;
}

function supportsMapping(mapping = {}) {
    const code = String(mapping.supplierCode || "").trim().toUpperCase();
    if (!processorFor(code)) return false;
    if (code === "WONDD") {
        const { hasWonddGameIdFormatter } = require("./wonddFulfillmentProcessor");
        const { resolveWonddCatalogIdentity } = require("./wonddCatalogConfig");
        const { providerGameCodeForProduct } = require("../commerce/canonicalGameInputContract");
        const productCode = String(mapping.productCode || "").trim().toLowerCase();
        const providerGameCode = providerGameCodeForProduct(productCode) || productCode;
        const identity = resolveWonddCatalogIdentity(mapping.supplierProductCode);
        return hasWonddGameIdFormatter(mapping.productCode) &&
            identity?.family?.productCode === providerGameCode;
    }
    if (code === "FAZERCARDS") {
        return require("./fazercardsFulfillmentProcessor").supportsFazerCardsMapping(mapping);
    }
    return false;
}

function dispatchSubmission(supplierCode, attemptId) {
    const processor = processorFor(supplierCode);
    if (!processor) return false;
    setImmediate(() => processor.submit(attemptId).catch(() => null));
    return true;
}

module.exports = { processorFor, supportsMapping, dispatchSubmission };
