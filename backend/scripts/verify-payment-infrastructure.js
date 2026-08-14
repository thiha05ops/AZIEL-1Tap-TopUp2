const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PaymentMethod = require("../models/PaymentMethod");
const PaymentProviderConfig = require("../models/PaymentProviderConfig");
const { listProviderAdapters } = require("../services/paymentProviderAdapterRegistry");
const {
    RAIL_TYPES,
    AVAILABILITY_MODES,
    getPaymentInfrastructureSnapshot,
    railTypeForMethod
} = require("../services/paymentInfrastructureService");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, fragment, message) {
    assert(read(file).includes(fragment), `${file}: ${message}`);
}

async function verifyModelAndServices() {
    assert(PaymentMethod.schema.path("railType"), "PaymentMethod.railType must exist.");
    assert(PaymentMethod.schema.path("availabilityMode"), "PaymentMethod.availabilityMode must exist.");
    assert(PaymentMethod.schema.path("providerEnvironment"), "PaymentMethod.providerEnvironment must exist.");
    assert(PaymentMethod.schema.path("feeConfig.percentageFee"), "PaymentMethod fee metadata must exist.");
    assert(PaymentProviderConfig.schema.path("providerCode"), "PaymentProviderConfig.providerCode must exist.");
    assert(PaymentProviderConfig.schema.path("environments.0.webhookSecretConfigured"), "Provider webhook secret status must be stored as a flag.");

    const adapters = listProviderAdapters();
    assert(adapters.some(adapter => adapter.name === "omise"), "Existing Omise/OPN adapter must be represented.");
    assert(adapters.find(adapter => adapter.name === "omise").methods.includes("verifyWebhook"), "Provider adapter registry must expose webhook verification capability.");

    assert.strictEqual(railTypeForMethod({ paymentType: "manual", qrMode: "aziel_promptpay_dynamic" }), RAIL_TYPES.MANUAL_QR);
    assert.strictEqual(railTypeForMethod({ paymentType: "deeplink" }), RAIL_TYPES.MANUAL_BANK_APP);
    assert.strictEqual(railTypeForMethod({ paymentType: "wallet", key: "wallet" }), RAIL_TYPES.WALLET);
    assert.strictEqual(railTypeForMethod({ paymentType: "auto", key: "promptpay" }), RAIL_TYPES.AUTO_PROMPTPAY);

    const snapshot = await getPaymentInfrastructureSnapshot([
        {
            _id: "64f000000000000000000001",
            method: "PromptPay QR",
            key: "promptpay",
            region: "TH",
            enabled: true,
            paymentType: "manual",
            provider: "promptpay",
            qrMode: "aziel_promptpay_dynamic",
            enableSaveQr: true,
            enableOpenApp: true,
            enableChecklist: true,
            receiptUploadEnabled: true,
            confirmationMode: "manual_admin",
            dynamicQrSupported: true,
            amountPrefillSupported: true,
            bankLaunchers: [{ enabled: true }],
            publicReady: true
        },
        {
            _id: "64f000000000000000000002",
            method: "AZIEL Wallet",
            key: "wallet",
            region: "MM",
            enabled: true,
            paymentType: "wallet",
            provider: "wallet",
            publicReady: true
        }
    ]);

    const thailand = snapshot.regions.find(region => region.region === "TH");
    assert(thailand.manualRails.some(rail => rail.key === "promptpay" && rail.enabled === true), "Manual PromptPay must remain enabled in infrastructure projection.");
    assert(thailand.manualRails.find(rail => rail.key === "promptpay").capabilities.saveQr, "Manual PromptPay Save QR capability must be preserved.");
    assert(thailand.manualRails.find(rail => rail.key === "promptpay").capabilities.receiptUpload, "Manual PromptPay receipt upload must be preserved.");
    assert(thailand.manualRails.find(rail => rail.key === "promptpay").capabilities.adminVerification, "Manual PromptPay admin verification must be preserved.");
    assert(thailand.automaticRails.some(rail => rail.railType === RAIL_TYPES.AUTO_PROMPTPAY && rail.status === "NOT_CONFIGURED"), "Auto PromptPay must start disabled/not configured.");
    assert(thailand.automaticRails.some(rail => rail.railType === RAIL_TYPES.AUTO_CARD && rail.status === "NOT_CONFIGURED"), "Card rail must start disabled/not configured.");
    assert.strictEqual(snapshot.routing.TH.mode, AVAILABILITY_MODES.MANUAL_ONLY, "Thailand routing must remain manual-only by default.");
    assert.strictEqual(snapshot.security.rawSecretsReturned, false, "Infrastructure snapshot must explicitly avoid raw secrets.");
    assert(JSON.stringify(snapshot).includes("Configured") || JSON.stringify(snapshot).includes("Missing"), "Credential status labels should be safe statuses only.");
    assert(!JSON.stringify(snapshot).includes("sk_test_"), "Secret-like values must not be returned.");

    const capabilitySnapshot = await getPaymentInfrastructureSnapshot([
        { method: "Ready TH", key: "promptpay", region: "TH", enabled: true, paymentType: "manual", publicReady: true },
        { method: "Incomplete TH", key: "scb", region: "TH", enabled: true, paymentType: "manual", publicReady: false },
        { method: "Unknown MM", key: "kbzpay", region: "MM", enabled: true, paymentType: "manual" },
        { method: "Disabled MM", key: "wavepay", region: "MM", enabled: false, paymentType: "manual", publicReady: true }
    ]);
    const thRails = capabilitySnapshot.regions.find(region => region.region === "TH").manualRails;
    const mmRails = capabilitySnapshot.regions.find(region => region.region === "MM").manualRails;
    assert(thRails.find(rail => rail.key === "promptpay" && rail.status === "READY" && rail.customerVisible === true), "Only enabled and explicitly public-ready TH rails may be customer visible.");
    assert(thRails.find(rail => rail.key === "scb" && rail.status === "DEGRADED" && rail.customerVisible === false), "Enabled but incomplete TH rails must not be customer visible.");
    assert(mmRails.find(rail => rail.key === "kbzpay" && rail.status === "DEGRADED" && rail.customerVisible === false), "Missing public readiness must fail closed.");
    assert(mmRails.find(rail => rail.key === "wavepay" && rail.status === "DISABLED" && rail.customerVisible === false), "Disabled rails must remain unavailable even when configured.");
    assert(!mmRails.some(rail => rail.key === "promptpay"), "Myanmar and Thailand rail projections must remain isolated.");
}

function verifyRouteAndFrontendContracts() {
    const paymentRoutes = read("backend/routes/paymentMethods.js");
    includes("backend/routes/paymentMethods.js", 'router.get("/admin/payment-infrastructure"', "Admin payment infrastructure endpoint must exist.");
    includes("backend/routes/paymentMethods.js", "getPaymentInfrastructureSnapshot", "Route must use backend infrastructure projection.");
    includes("frontend/js/admin-payments.js", "/api/admin/payment-infrastructure", "Admin frontend must load infrastructure endpoint.");
    includes("frontend/js/admin-payments.js", "renderPaymentInfrastructureWorkspace", "Admin frontend must render infrastructure workspace.");
    includes("frontend/js/admin-payments.js", "adminPaymentInfrastructureActiveRegion", "Infrastructure workspace must own active region state.");
    includes("frontend/js/admin-payments.js", "getPaymentMethodsForInfrastructureRegion", "Configuration editor must separate Myanmar and Thailand payment methods.");
    includes("frontend/js/admin-payments.js", "selectPaymentInfrastructureRegion", "Region selection must have one explicit read-only state transition.");
    includes("frontend/js/admin-payments.js", "paymentInfrastructureActionsBound", "Region and tab actions must use a stable delegated binding.");
    includes("frontend/js/admin-payments.js", 'method.enabled === true && method.publicReady === true', "Fallback customer visibility must fail closed on computed readiness.");
    includes("frontend/js/admin-payments.js", "filter(rail => rail.customerVisible === true)", "Customer Display must render only authoritative customer-visible rails.");
    includes("frontend/js/admin-payments.js", "Configured · Disabled", "Configured readiness must remain distinct from enabled storefront state.");
    includes("frontend/js/admin-payments.js", "Unsaved · Disabled", "An unchecked draft must not continue to claim customer visibility before it is saved.");
    includes("frontend/admin.html", "/js/admin-payments.js?v=20260815-canonical-payment-contract", "Admin must publish the repaired payment controller under a fresh versioned asset URL.");
    includes("frontend/js/admin-payments.js", "Automatic Rails", "Automatic rails must have an admin surface.");
    includes("frontend/js/admin-payments.js", "Card", "Card readiness must have an admin surface.");
    includes("frontend/js/admin-payments.js", "rawSecretsReturned", "Frontend must consume safe credential/security projection.");
    includes("frontend/css/admin/admin-design-system.css", ".payment-infrastructure-workspace", "Infrastructure workspace CSS must exist.");
    includes("backend/routes/paymentMethods.js", "router.get(\"/payment-methods\"", "Public payment methods route must remain.");
    includes("backend/routes/paymentMethods.js", ".map(formatMethod)", "Public checkout projection must still use formatMethod.");
    includes("backend/routes/paymentMethods.js", ".filter(method => method.customerVisible === true)", "Public capability must use the canonical backend visibility decision.");
    const adminMethodsGet = paymentRoutes.slice(
        paymentRoutes.indexOf('router.get("/admin/payment-methods"'),
        paymentRoutes.indexOf('router.get("/admin/payment-infrastructure"')
    );
    const adminInfrastructureGet = paymentRoutes.slice(
        paymentRoutes.indexOf('router.get("/admin/payment-infrastructure"'),
        paymentRoutes.indexOf("function applyPaymentMethodPatch")
    );
    assert(!adminMethodsGet.includes("seedPaymentMethods()"), "Admin Payment Methods GET must remain read-only.");
    assert(!adminInfrastructureGet.includes("seedPaymentMethods()"), "Admin Payment Infrastructure GET must remain read-only.");
}

function verifyAdminRegionRuntime() {
    const context = vm.createContext({
        console,
        document: {
            addEventListener() {},
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; }
        },
        window: { addEventListener() {}, AZIEL_ADMIN_AUTH: { state: {} } },
        localStorage: { getItem() { return ""; } },
        URL,
        setTimeout,
        clearTimeout
    });
    vm.runInContext(read("frontend/js/admin-payments.js"), context, { filename: "admin-payments.js" });
    const result = vm.runInContext(`
        adminPaymentInfrastructure = {
            regions: [
                { region: "MM", label: "Myanmar", manualRails: [{ key: "kbzpay", label: "KBZPay", enabled: true, publicReady: true, customerVisible: true, status: "READY" }], automaticRails: [], wallet: [], providers: [] },
                { region: "TH", label: "Thailand", manualRails: [{ key: "promptpay", label: "PromptPay", enabled: true, publicReady: true, customerVisible: true, status: "READY" }], automaticRails: [], wallet: [], providers: [] },
                { region: "FUTURE", label: "Future Regions", manualRails: [], automaticRails: [], wallet: [], providers: [] }
            ],
            providers: [], adapters: [], routing: { MM: {}, TH: {} }, security: {}
        };
        adminPaymentMethods = [
            { key: "kbzpay", region: "MM", enabled: true, publicReady: true },
            { key: "promptpay", region: "TH", enabled: true, publicReady: true }
        ];
        const before = JSON.stringify(adminPaymentMethods);
        let renderCount = 0;
        renderAdminPaymentMethods = () => { renderCount += 1; };
        const mmChanged = selectPaymentInfrastructureRegion("MM", { notify: false });
        const mmActive = getPaymentInfrastructureActiveRegion(adminPaymentMethods);
        const mmMethods = getPaymentMethodsForInfrastructureRegion(adminPaymentMethods, mmActive).map(item => item.key);
        const repeated = selectPaymentInfrastructureRegion("MM", { notify: false });
        const thChanged = selectPaymentInfrastructureRegion("TH", { notify: false });
        const thMethods = getPaymentMethodsForInfrastructureRegion(adminPaymentMethods, getPaymentInfrastructureActiveRegion(adminPaymentMethods)).map(item => item.key);
        const futureChanged = selectPaymentInfrastructureRegion("FUTURE", { notify: false });
        const futureMethods = getPaymentMethodsForInfrastructureRegion(adminPaymentMethods, getPaymentInfrastructureActiveRegion(adminPaymentMethods)).map(item => item.key);
        ({ before, after: JSON.stringify(adminPaymentMethods), renderCount, mmChanged, mmActive, mmMethods, repeated, thChanged, thMethods, futureChanged, futureMethods,
            mmMarkup: renderPaymentInfrastructureWorkspace(adminPaymentMethods, "", "MM"),
            thMarkup: renderPaymentInfrastructureWorkspace(adminPaymentMethods, "", "TH"),
            futureMarkup: renderPaymentInfrastructureWorkspace(adminPaymentMethods, "", "FUTURE") });
    `, context);

    assert.strictEqual(result.before, result.after, "Region selection must not mutate payment methods.");
    assert.strictEqual(result.renderCount, 3, "Each actual region transition must render exactly once; repeated selection must be a no-op.");
    assert.strictEqual(result.mmChanged, true);
    assert.strictEqual(result.mmActive, "MM");
    assert.deepStrictEqual(Array.from(result.mmMethods), ["kbzpay"]);
    assert.strictEqual(result.repeated, false, "Repeated region selection must not stack work/toasts.");
    assert.strictEqual(result.thChanged, true);
    assert.deepStrictEqual(Array.from(result.thMethods), ["promptpay"]);
    assert.strictEqual(result.futureChanged, true);
    assert.deepStrictEqual(Array.from(result.futureMethods), []);
    assert(result.mmMarkup.includes('data-payment-infra-region="MM"') && result.mmMarkup.includes('payment-infra-region active" type="button" data-payment-infra-region="MM"'), "Myanmar markup must own selected styling and content.");
    assert(result.thMarkup.includes('data-payment-infra-region="TH"') && result.thMarkup.includes('payment-infra-region active" type="button" data-payment-infra-region="TH"'), "Thailand markup must own selected styling and content.");
    assert(result.futureMarkup.includes('data-payment-infra-region="FUTURE"') && result.futureMarkup.includes('payment-infra-region active" type="button" data-payment-infra-region="FUTURE"'), "Future Regions markup must own selected styling and content.");
}

verifyModelAndServices()
    .then(() => {
        verifyRouteAndFrontendContracts();
        verifyAdminRegionRuntime();
        console.log("Payment infrastructure foundation verification checks passed.");
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
