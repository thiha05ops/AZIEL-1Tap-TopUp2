const assert = require("assert");
const fs = require("fs");
const path = require("path");

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
}

function verifyRouteAndFrontendContracts() {
    includes("backend/routes/paymentMethods.js", 'router.get("/admin/payment-infrastructure"', "Admin payment infrastructure endpoint must exist.");
    includes("backend/routes/paymentMethods.js", "getPaymentInfrastructureSnapshot", "Route must use backend infrastructure projection.");
    includes("frontend/js/admin-payments.js", "/api/admin/payment-infrastructure", "Admin frontend must load infrastructure endpoint.");
    includes("frontend/js/admin-payments.js", "renderPaymentInfrastructureWorkspace", "Admin frontend must render infrastructure workspace.");
    includes("frontend/js/admin-payments.js", "adminPaymentInfrastructureActiveRegion", "Infrastructure workspace must own active region state.");
    includes("frontend/js/admin-payments.js", "getPaymentMethodsForInfrastructureRegion", "Configuration editor must separate Myanmar and Thailand payment methods.");
    includes("frontend/js/admin-payments.js", "Automatic Rails", "Automatic rails must have an admin surface.");
    includes("frontend/js/admin-payments.js", "Card", "Card readiness must have an admin surface.");
    includes("frontend/js/admin-payments.js", "rawSecretsReturned", "Frontend must consume safe credential/security projection.");
    includes("frontend/css/admin/admin-design-system.css", ".payment-infrastructure-workspace", "Infrastructure workspace CSS must exist.");
    includes("backend/routes/paymentMethods.js", "router.get(\"/payment-methods\"", "Public payment methods route must remain.");
    includes("backend/routes/paymentMethods.js", ".map(formatMethod)", "Public checkout projection must still use formatMethod.");
}

verifyModelAndServices()
    .then(() => {
        verifyRouteAndFrontendContracts();
        console.log("Payment infrastructure foundation verification checks passed.");
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
