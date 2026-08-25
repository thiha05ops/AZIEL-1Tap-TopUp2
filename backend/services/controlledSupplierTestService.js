"use strict";

const crypto = require("crypto");
const CommerceOrder = require("../models/CommerceOrder");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const Mapping = require("../models/SupplierProductMapping");
const Supplier = require("../models/Supplier");
const { assessProductionMapping } = require("./supplierProductionSelectionService");
const { dispatchSubmission } = require("./suppliers/supplierFulfillmentDispatcher");

const clean = value => String(value == null ? "" : value).trim();
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function safeEqual(left, right) {
    const a = Buffer.from(clean(left)); const b = Buffer.from(clean(right));
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

async function authorizeControlledAttempt(input = {}, deps = {}) {
    const env = deps.env || process.env;
    if (input.explicitApproval !== true || clean(input.approvalPhrase) !== "EXECUTE EXACTLY ONE CONTROLLED SUPPLIER TEST") fail("CONTROLLED_TEST_APPROVAL_REQUIRED", "Explicit controlled-test approval is required.");
    if (!safeEqual(input.authorizationToken, env.CONTROLLED_SUPPLIER_TEST_AUTHORIZATION_TOKEN)) fail("CONTROLLED_TEST_AUTHORIZATION_INVALID", "Controlled-test authorization is invalid.");
    const [attempt, order, mapping] = await Promise.all([
        (deps.Attempt || FulfillmentAttempt).findById(input.attemptId),
        (deps.Order || CommerceOrder).findById(input.orderId),
        (deps.Mapping || Mapping).findById(input.mappingId)
    ]);
    if (!attempt || !order || !mapping) fail("CONTROLLED_TEST_AUTHORITY_MISSING", "Order, attempt, and mapping authority are required.");
    if (mapping.archivedAt || mapping.productionRole === "PRIMARY") fail("CONTROLLED_TEST_MAPPING_UNSAFE", "Controlled tests require a non-archived, non-PRIMARY exact mapping.");
    const supplier = await (deps.Supplier || Supplier).findById(mapping.supplierId);
    const exact = {
        supplier: clean(input.supplier).toUpperCase(), product: clean(input.product).toLowerCase(), package: clean(input.packageCode).toUpperCase(),
        mapping: clean(input.mappingId), order: clean(input.orderId), attempt: clean(input.attemptId)
    };
    if (!supplier || mapping.supplierCode !== exact.supplier || mapping.productCode !== exact.product || mapping.packageCode !== exact.package || String(mapping._id) !== exact.mapping || String(order._id) !== exact.order || String(attempt._id) !== exact.attempt) fail("CONTROLLED_TEST_EXACT_BINDING_MISMATCH", "Controlled-test identities do not match the explicit approval.");
    const route = order.fulfilment?.routeSnapshot;
    if (route?.routeType !== "SUPPLIER_API" || String(route.supplierMappingId) !== String(mapping._id)) fail("CONTROLLED_TEST_ROUTE_NOT_FROZEN", "The controlled order must contain the exact immutable supplier route snapshot.");
    if (attempt.routeType !== "SUPPLIER_API" || String(attempt.supplierMappingId) !== String(mapping._id) || String(attempt.orderId) !== String(order._id)) fail("CONTROLLED_TEST_ATTEMPT_MISMATCH", "The FulfillmentAttempt is not bound to the approved route.");
    if (attempt.status !== "IN_PROGRESS" || attempt.supplierReference || ["SUBMISSION_IN_FLIGHT", "SUBMISSION_UNCERTAIN", "ACCEPTED"].includes(attempt.supplierRequest?.submissionState)) fail("CONTROLLED_TEST_ALREADY_SUBMITTED", "This attempt cannot make another supplier submission.");
    const assessment = await (deps.assess || assessProductionMapping)(mapping.toObject ? mapping.toObject() : mapping);
    if (!assessment.ready) fail("CONTROLLED_TEST_NOT_READY", `Controlled test is blocked: ${assessment.blockers.join(", ")}`);
    return { attempt, order, mapping, supplier, exact };
}

async function executeControlledSupplierTest(input = {}, deps = {}) {
    const authority = await authorizeControlledAttempt(input, deps);
    const dispatched = (deps.dispatch || dispatchSubmission)(authority.mapping.supplierCode, authority.attempt._id);
    if (!dispatched) fail("CONTROLLED_TEST_PROCESSOR_MISSING", "No supplier processor accepted the controlled attempt.");
    return { dispatched: true, fulfillmentId: authority.attempt.fulfillmentId, supplier: authority.mapping.supplierCode, product: authority.mapping.productCode, packageCode: authority.mapping.packageCode };
}

module.exports = { authorizeControlledAttempt, executeControlledSupplierTest };
