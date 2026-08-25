function processorFor(supplierCode) {
    const code = String(supplierCode || "").trim().toUpperCase();
    if (code === "WONDD") return require("./wonddFulfillmentProcessor").processor;
    if (code === "FAZERCARDS") return require("./fazercardsFulfillmentProcessor").processor;
    return null;
}

function dispatchSubmission(supplierCode, attemptId) {
    const processor = processorFor(supplierCode);
    if (!processor) return false;
    setImmediate(() => processor.submit(attemptId).catch(() => null));
    return true;
}

module.exports = { processorFor, dispatchSubmission };
