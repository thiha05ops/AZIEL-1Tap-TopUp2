#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { dispatchSubmission, recordSubmissionFailure } = require("../services/suppliers/supplierFulfillmentDispatcher");

function attemptFixture(overrides = {}) {
    return {
        _id: "attempt-1",
        status: "IN_PROGRESS",
        supplierCodeSnapshot: "FAZERCARDS",
        supplierReference: "",
        supplierRequest: {},
        supplierResult: {},
        saves: 0,
        async save() { this.saves += 1; return this; },
        ...overrides
    };
}

async function main() {
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args);
    try {
        const blocked = attemptFixture();
        await recordSubmissionFailure(blocked._id, Object.assign(new Error("sensitive provider message"), { code: "INPUT_CONTRACT_INVALID" }), { findById: async () => blocked });
        assert.strictEqual(blocked.status, "FAILED");
        assert.strictEqual(blocked.failureCode, "INPUT_CONTRACT_INVALID");
        assert.strictEqual(blocked.supplierResult.providerStatus, "SUBMISSION_BLOCKED");
        assert.strictEqual(blocked.saves, 1);

        const uncertain = attemptFixture({ _id: "attempt-2", supplierRequest: { submissionState: "SUBMISSION_IN_FLIGHT" } });
        await recordSubmissionFailure(uncertain._id, Object.assign(new Error("timeout after transport"), { code: "PROVIDER_TIMEOUT" }), { findById: async () => uncertain });
        assert.strictEqual(uncertain.status, "IN_PROGRESS", "An uncertain provider outcome must not be converted into a safely retryable failure.");
        assert.strictEqual(uncertain.supplierResult.providerStatus, "SUBMISSION_OUTCOME_UNCERTAIN");
        assert.strictEqual(uncertain.supplierRequest.manualAttention, true);

        let deferred = null;
        let persisted = null;
        assert.strictEqual(dispatchSubmission("WONDD", "attempt-3", {
            processorResolver: () => ({ submit: async () => { throw Object.assign(new Error("do not expose"), { code: "WONDD_CONTRACT_INVALID" }); } }),
            defer: callback => { deferred = callback; },
            recordFailure: async (attemptId, error) => { persisted = { attemptId, code: error.code }; }
        }), true);
        await deferred();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepStrictEqual(persisted, { attemptId: "attempt-3", code: "WONDD_CONTRACT_INVALID" }, "Unexpected processor failures must reach durable recording instead of being swallowed.");

        logs.forEach(([, details]) => {
            assert.deepStrictEqual(Object.keys(details).sort(), ["attemptId", "errorCode", "outcomeUncertain", "supplierCode"].sort());
            assert(!JSON.stringify(details).includes("sensitive") && !JSON.stringify(details).includes("timeout after transport"), "Logs must exclude exception messages and customer/provider payloads.");
        });
    } finally {
        console.error = originalError;
    }

    console.log(JSON.stringify({ result: "PASS", preSubmissionFailureDurable: true, uncertainSubmissionNotRetried: true, swallowedProcessorFailures: 0, sanitizedLogs: logs.length, providerCalls: 0, productionWrites: 0 }, null, 2));
}

main().catch(error => { console.error("VERIFY_SUPPLIER_DISPATCH_DIAGNOSTICS_FAILED:", error.stack || error); process.exitCode = 1; });
