"use strict";

function isRuntimeDebugEnabled() {
    return String(process.env.AZIEL_DEBUG || "").toLowerCase() === "true";
}

function runtimeDebug(...args) {
    if (!isRuntimeDebugEnabled()) return;
    console.debug(...args);
}

module.exports = Object.freeze({
    isRuntimeDebugEnabled,
    runtimeDebug
});
