"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const route = read("backend/routes/commerceManualPaymentRoutes.js");
const controller = read("backend/controllers/commerceManualPaymentController.js");
const checkout = read("backend/services/commerce/customerManualPromptPayCheckoutService.js");
const debug = read("backend/utils/runtimeDebug.js");
const recovery = read("frontend/js/payment/pending-payment-recovery.js");
const sheet = read("frontend/js/payment/payment-checkout-sheet.js");
const liveChat = read("frontend/js/live-chat.js");

assert(debug.includes('process.env.AZIEL_DEBUG'), "Backend debug mode must use the single AZIEL_DEBUG authority.");
assert(debug.includes('console.debug(...args)'), "Enabled debug mode must retain useful troubleshooting output.");
assert(route.includes('runtimeDebug("[COMMERCE ROUTE PROBE] Request entered"'), "Route probes must be debug-gated.");
assert(route.includes('runtimeDebug("[COMMERCE ROUTE PROBE] Response finished"'), "Route completion probes must be debug-gated.");
assert(route.includes('console.warn("[COMMERCE ROUTE PROBE] Connection closed before response"'), "Actionable premature-close warnings must remain.");

assert(controller.includes('runtimeDebug("[RECOVERY CONTROLLER] Service resolved"'), "Successful recovery traces must be debug-gated.");
assert(!controller.includes('console.log("[RECOVERY CONTROLLER]'), "Successful recovery polling must not log in normal runtime.");
assert(controller.includes('console.error("[RECOVERY CONTROLLER] Recovery failed"'), "Recovery failures must remain visible.");
assert(!checkout.includes("console.log("), "Checkout step-by-step probes must not log in normal runtime.");
assert(checkout.includes("runtimeDebug("), "Checkout probes must remain available under explicit debug mode.");
assert(checkout.includes('console.error('), "Checkout failures must remain visible.");

assert(recovery.includes("window.AZIEL_DEBUG === true"), "Frontend recovery debug output must require explicit opt-in.");
assert(sheet.includes("window.AZIEL_DEBUG === true"), "Frontend checkout diagnostics must require explicit opt-in.");
assert(!liveChat.includes("AZIEL ASSISTANT V2 LOADED"), "Customer runtime must not emit the temporary live-chat load message.");

const runtimeDebugModule = require(path.join(ROOT, "backend/utils/runtimeDebug.js"));
const previousDebugValue = process.env.AZIEL_DEBUG;
const originalConsoleDebug = console.debug;
let debugCalls = 0;
console.debug = () => { debugCalls += 1; };
delete process.env.AZIEL_DEBUG;
runtimeDebugModule.runtimeDebug("silent");
assert.strictEqual(debugCalls, 0, "Normal runtime must suppress debug output.");
process.env.AZIEL_DEBUG = "true";
runtimeDebugModule.runtimeDebug("enabled");
assert.strictEqual(debugCalls, 1, "AZIEL_DEBUG=true must enable troubleshooting output.");
console.debug = originalConsoleDebug;
if (previousDebugValue === undefined) delete process.env.AZIEL_DEBUG;
else process.env.AZIEL_DEBUG = previousDebugValue;

console.log("Runtime log cleanup verification passed.");
