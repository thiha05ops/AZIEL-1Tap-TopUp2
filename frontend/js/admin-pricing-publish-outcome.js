(function (root, factory) {
    const authority = factory();
    if (typeof module === "object" && module.exports) module.exports = authority;
    if (root) root.AZIEL_PRICING_PUBLISH_OUTCOME = authority;
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    function classify(error = {}) {
        const status = Number(error.status || 0);
        return !status || status >= 500 ? "UNCERTAIN" : "REJECTED";
    }

    return Object.freeze({ classify });
});
