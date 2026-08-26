(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.AZIEL_PAYMENT_SESSION_AUTHORITY = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    function value(input) {
        return String(input || "").trim();
    }

    function attemptId(staged) {
        return value(staged?.session?.attemptId || staged?.session?.manualPaymentAttemptId);
    }

    function orderId(staged) {
        return value(
            staged?.session?.commerceOrderId ||
            staged?.session?.orderId ||
            staged?.orderData?.commerceOrderId ||
            staged?.orderData?.orderId
        );
    }

    function quoteId(staged) {
        return value(staged?.session?.quoteId || staged?.orderData?.quoteId);
    }

    function draftQuoteId(draft) {
        return value(draft?.review?.quoteId);
    }

    function stagedSessionMatchesDraft(staged, draft) {
        const currentQuoteId = draftQuoteId(draft);
        const stagedQuoteId = quoteId(staged);
        return Boolean(currentQuoteId && stagedQuoteId && currentQuoteId === stagedQuoteId);
    }

    function stagedSessionMatchesAttempt(staged, requestedAttemptId) {
        const requested = value(requestedAttemptId);
        return Boolean(requested && attemptId(staged) === requested);
    }

    function stagedSessionMatchesRequest(staged, request = {}) {
        const requestedAttemptId = value(request.attemptId);
        const requestedOrderId = value(request.orderId);
        if (!requestedAttemptId || attemptId(staged) !== requestedAttemptId) return false;
        return !requestedOrderId || orderId(staged) === requestedOrderId;
    }

    function markerMatchesAttempt(marker, requestedAttemptId) {
        const requested = value(requestedAttemptId);
        return Boolean(requested && value(marker?.attemptId) === requested && value(marker?.orderId));
    }

    function markerMatchesRequest(marker, request = {}) {
        const requestedAttemptId = value(request.attemptId);
        const requestedOrderId = value(request.orderId);
        if (!requestedAttemptId || value(marker?.attemptId) !== requestedAttemptId) return false;
        return Boolean(value(marker?.orderId) && (!requestedOrderId || value(marker.orderId) === requestedOrderId));
    }

    function markerMatchesStaged(marker, staged) {
        return Boolean(
            value(marker?.attemptId) &&
            value(marker?.orderId) &&
            value(marker.attemptId) === attemptId(staged) &&
            value(marker.orderId) === orderId(staged)
        );
    }

    return Object.freeze({
        attemptId,
        orderId,
        quoteId,
        draftQuoteId,
        stagedSessionMatchesDraft,
        stagedSessionMatchesAttempt,
        stagedSessionMatchesRequest,
        markerMatchesAttempt,
        markerMatchesRequest,
        markerMatchesStaged
    });
});
