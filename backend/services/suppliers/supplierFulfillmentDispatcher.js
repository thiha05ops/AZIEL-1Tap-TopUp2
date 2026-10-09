const FulfillmentAttempt = require("../../models/FulfillmentAttempt");

const UNSAFE_SUBMISSION_STATES = new Set(["SUBMISSION_IN_FLIGHT", "SUBMISSION_UNCERTAIN", "ACCEPTED"]);
const safeErrorCode = error => {
    const value = String(error?.code || error?.name || "SUPPLIER_SUBMISSION_FAILED").trim().toUpperCase();
    return /^[A-Z0-9_]{2,80}$/.test(value) ? value : "SUPPLIER_SUBMISSION_FAILED";
};

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
        const { verifiedMappingContract } = require("./fazercardsFulfillmentContractService");
        const declarativeContract = verifiedMappingContract(mapping);
        return declarativeContract?.protocol === "WONDD_GAME_ID_TOPUP" && Boolean(declarativeContract.transactionalServiceCode);
    }
    if (code === "FAZERCARDS") {
        return require("./fazercardsFulfillmentProcessor").supportsFazerCardsMapping(mapping);
    }
    return false;
}

async function recordSubmissionFailure(attemptId, error, Attempt = FulfillmentAttempt) {
    const attempt = await Attempt.findById(attemptId);
    if (!attempt || String(attempt.status || "").toUpperCase() !== "IN_PROGRESS") return null;
    const errorCode = safeErrorCode(error);
    const submissionState = String(attempt.supplierRequest?.submissionState || "").trim().toUpperCase();
    const uncertain = Boolean(String(attempt.supplierReference || "").trim()) || UNSAFE_SUBMISSION_STATES.has(submissionState);
    attempt.supplierRequest = {
        ...(attempt.supplierRequest || {}),
        manualAttention: true,
        dispatchFailureCode: errorCode,
        dispatchFailedAt: new Date()
    };
    attempt.supplierResult = {
        ...(attempt.supplierResult || {}),
        status: uncertain ? "PENDING" : "FAILED",
        providerStatus: uncertain ? "SUBMISSION_OUTCOME_UNCERTAIN" : "SUBMISSION_BLOCKED",
        failureCode: errorCode,
        safeMessage: uncertain
            ? "Supplier submission outcome requires manual reconciliation."
            : "Supplier submission was blocked before provider acceptance."
    };
    if (!uncertain) {
        attempt.status = "FAILED";
        attempt.failureCode = errorCode;
        attempt.failureReason = "Supplier submission was blocked before provider acceptance.";
        attempt.failedAt = new Date();
    }
    await attempt.save();
    console.error("Supplier fulfillment dispatch failed:", { attemptId: String(attemptId), supplierCode: String(attempt.supplierCodeSnapshot || "").trim().toUpperCase(), errorCode, outcomeUncertain: uncertain });
    return attempt;
}

function dispatchSubmission(supplierCode, attemptId, options = {}) {
    const processor = (options.processorResolver || processorFor)(supplierCode);
    if (!processor) return false;
    const defer = options.defer || setImmediate;
    const recordFailure = options.recordFailure || ((id, error) => recordSubmissionFailure(id, error));
    defer(() => Promise.resolve()
        .then(() => processor.submit(attemptId))
        .catch(error => recordFailure(attemptId, error).catch(recordError => {
            console.error("Supplier fulfillment dispatch failure could not be persisted:", { attemptId: String(attemptId), supplierCode: String(supplierCode || "").trim().toUpperCase(), errorCode: safeErrorCode(recordError) });
        })));
    return true;
}

module.exports = { processorFor, supportsMapping, dispatchSubmission, recordSubmissionFailure };
