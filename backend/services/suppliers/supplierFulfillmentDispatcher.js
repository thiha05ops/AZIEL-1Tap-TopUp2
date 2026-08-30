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
        return hasWonddGameIdFormatter(mapping.productCode) &&
            String(mapping.supplierProductCode || "").trim().toLowerCase() === String(mapping.productCode || "").trim().toLowerCase();
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
