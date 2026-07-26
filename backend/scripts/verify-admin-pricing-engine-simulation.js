const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, fragment, message) {
    assert(read(file).includes(fragment), `${file}: ${message}`);
}

function notIncludes(file, fragment, message) {
    assert(!read(file).includes(fragment), `${file}: ${message}`);
}

function loadBrowserEngine() {
    const source = read("frontend/js/commerce/pricingCalculationEngine.js");
    const context = { window: {} };
    context.window.window = context.window;
    vm.createContext(context);
    vm.runInContext(source, context);
    return context.window.AZIEL_COMMERCE_PRICING_ENGINE;
}

function verifyMarkup() {
    const html = read("frontend/admin.html");
    includes("frontend/admin.html", "/js/commerce/pricingCalculationEngine.js", "Admin Pricing Engine must load the browser calculation engine.");
    includes("frontend/admin.html", "/js/admin-pricing-engine.js", "Admin Pricing Engine controller must still load.");
    assert(html.indexOf("/js/commerce/pricingCalculationEngine.js") < html.indexOf("/js/admin-pricing-engine.js"), "Browser calculation engine must load before pricing UI controller.");
    includes("frontend/admin.html", "id=\"pricingFlow\"", "Pricing preview must have a render target.");
    includes("frontend/admin.html", "id=\"pricingBreakdown\"", "Pricing breakdown must have a render target.");
    includes("frontend/admin.html", "id=\"pricingSimulationError\"", "Pricing simulation must have an inline error target.");
    includes("frontend/admin.html", "data-pricing-edit=\"exchangeRate\"", "Exchange edit button must be wired.");
    includes("frontend/admin.html", "data-pricing-edit=\"gatewayFee\"", "Gateway fee edit button must be wired.");
    includes("frontend/admin.html", "data-pricing-edit=\"platformFee\"", "Platform fee edit button must be wired.");
    includes("frontend/admin.html", "data-pricing-edit=\"profit\"", "Profit edit button must be wired.");
    includes("frontend/admin.html", "data-pricing-edit=\"rounding\"", "Rounding edit button must be wired.");
    includes("frontend/admin.html", "Simulation", "Pricing labels should indicate simulation mode.");
    includes("frontend/admin.html", "Live Preview", "Pricing labels should indicate live preview mode.");
    includes("frontend/admin.html", "Not Saved", "Pricing labels should indicate unsaved simulation state.");
    ["Placeholder only", "Placeholder policy", "Placeholder fee", "Demo scope"].forEach(fragment => {
        notIncludes("frontend/admin.html", fragment, `${fragment} must be removed from Pricing Engine UI.`);
    });
}

function verifyController() {
    includes("frontend/js/admin-pricing-engine.js", "window.AZIEL_COMMERCE_PRICING_ENGINE", "Pricing UI must call the shared browser engine namespace.");
    includes("frontend/js/admin-pricing-engine.js", "calculateBasePrice", "Pricing UI must call calculateBasePrice.");
    includes("frontend/js/admin-pricing-engine.js", "result.breakdown", "Pricing UI must render engine breakdown output.");
    includes("frontend/js/admin-pricing-engine.js", "stageId", "Pricing breakdown must render stable stageId values.");
    includes("frontend/js/admin-pricing-engine.js", "simulationState", "Pricing UI must maintain local simulation state.");
    includes("frontend/js/admin-pricing-engine.js", "data-pricing-edit", "Edit buttons must update local simulation state.");
    notIncludes("frontend/js/admin-pricing-engine.js", "adminFetch(", "Pricing simulation must not call Admin APIs.");
    notIncludes("frontend/js/admin-pricing-engine.js", "fetch(", "Pricing simulation must not call browser fetch.");
}

function verifyEngineParity() {
    const backend = require("../services/commerce/pricingCalculationEngine");
    const browser = loadBrowserEngine();
    assert(browser?.calculateBasePrice, "Browser calculation engine must expose calculateBasePrice.");

    const input = {
        supplierCost: 1120,
        supplierCurrency: "THB",
        targetCurrency: "MMK",
        exchangeRate: { rate: 118, sourceCurrency: "THB", targetCurrency: "MMK", source: "verify" },
        policy: {
            supplierFee: { enabled: true, type: "PERCENT", value: 1.8 },
            businessCost: { enabled: false, type: "FIXED", value: 0 },
            profitRule: { enabled: true, type: "PERCENT", value: 12 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 2.5 },
            platformCost: { enabled: true, type: "FIXED", value: 4130 },
            tax: { enabled: false, type: "PERCENT", value: 0 },
            roundingRule: { enabled: true, mode: "NEAREST", increment: 100 }
        },
        context: { region: "MM", packageId: "MLBB_7740" }
    };

    const backendResult = backend.calculateBasePrice(input);
    const browserResult = browser.calculateBasePrice(input);
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(browserResult)),
        JSON.parse(JSON.stringify(backendResult)),
        "Browser engine output must match backend engine output for admin simulation input."
    );
    assert(browserResult.breakdown.every(item => item.stageId), "Every breakdown entry must include stageId.");
}

function verifyStyles() {
    includes("frontend/css/admin/admin-design-system.css", ".pricing-simulation-error", "Pricing simulation error state must be styled.");
    includes("frontend/css/admin/admin-design-system.css", ".pricing-breakdown-row", "Pricing breakdown rows must be styled.");
}

function main() {
    verifyMarkup();
    verifyController();
    verifyEngineParity();
    verifyStyles();
    console.log("Admin Pricing Engine simulation verification checks passed.");
}

main();
