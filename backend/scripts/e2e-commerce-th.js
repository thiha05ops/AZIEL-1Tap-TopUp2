"use strict";

require("dotenv").config();

const assert = require("assert");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");

const User = require("../models/User");
const AdminAccount = require("../models/AdminAccount");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const PaymentMethod = require("../models/PaymentMethod");
const PricingQuote = require("../models/PricingQuote");
const CommerceOrder = require("../models/CommerceOrder");
const PaymentAttempt = require("../models/PaymentAttempt");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { getPermissionsForRole, PERMISSIONS } = require("../services/adminAuthorizationService");
const { uploadFile } = require("../services/storageService");
const {
    adminUsername,
    assertE2EMode,
    customerUsername,
    isTestEmail,
    isTestUsername,
    normalizedScope
} = require("../e2e/e2eSafety");

const ROOT = path.join(__dirname, "..", "..");
const RUN_DIR = path.join(ROOT, ".aziel-e2e", "runs");
const FIXTURE = path.join(ROOT, "backend", "e2e", "fixtures", "receipt-fixture.base64.txt");
const REQUIRED_ADMIN_PERMISSIONS = [
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_MANAGE,
    PERMISSIONS.FULFILLMENT_READ,
    PERMISSIONS.FULFILLMENT_EXECUTE,
    PERMISSIONS.FULFILLMENT_RESOLVE
];

function config() {
    const { scope } = assertE2EMode();
    const baseUrl = String(process.env.AZIEL_E2E_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
    const customerPassword = String(process.env.AZIEL_E2E_CUSTOMER_PASSWORD || "");
    const adminPassword = String(process.env.AZIEL_E2E_ADMIN_PASSWORD || "");
    const mongoUri = String(process.env.AZIEL_E2E_MONGO_URI || "");
    if (!mongoUri) throw new Error("AZIEL_E2E_MONGO_URI is required; the harness never falls back to the normal runtime database.");
    const databaseName = decodeURIComponent(new URL(mongoUri).pathname.replace(/^\//, "").split("?")[0]).trim();
    if (!databaseName || databaseName.toLowerCase() === "azielshop" || !databaseName.toLowerCase().includes("e2e")) {
        throw new Error("AZIEL_E2E_MONGO_URI must select an explicit non-production database whose name contains e2e and is not azielshop.");
    }
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname === "azielplay.com" || hostname.endsWith(".azielplay.com")) {
        throw new Error("The production AZIEL hosts are forbidden E2E targets.");
    }
    const localTarget = ["127.0.0.1", "localhost", "::1"].includes(hostname);
    if (!localTarget && String(process.env.AZIEL_E2E_ALLOW_REMOTE_STAGING || "").toLowerCase() !== "true") {
        throw new Error("Remote E2E targets require AZIEL_E2E_ALLOW_REMOTE_STAGING=true and must not be production hosts.");
    }
    if (customerPassword.length < 12 || adminPassword.length < 12) {
        throw new Error("E2E customer and Admin passwords must be supplied through env and contain at least 12 characters.");
    }
    return { scope, baseUrl, customerPassword, adminPassword, mongoUri, databaseName };
}

async function connect(cfg) {
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(cfg.mongoUri, { serverSelectionTimeoutMS: 10000 });
}

function requestShape() {
    return { headers: { "user-agent": "AZIEL-E2E-HARNESS/1.0" }, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
}

function runId(scope) {
    return `${scope}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${require("crypto").randomBytes(3).toString("hex")}`;
}

function manifestPath(id) {
    return path.join(RUN_DIR, `${id}.json`);
}

function writeManifest(manifest) {
    fs.mkdirSync(RUN_DIR, { recursive: true });
    fs.writeFileSync(manifestPath(manifest.runId), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

function readManifest(id) {
    if (!/^[a-z0-9_-]+$/i.test(String(id || ""))) throw new Error("Invalid run id.");
    return JSON.parse(fs.readFileSync(manifestPath(id), "utf8"));
}

async function setup() {
    const cfg = config();
    await connect(cfg);
    const username = customerUsername(cfg.scope);
    const email = `${username}@example.invalid`;
    let user = await User.findOne({ username });
    if (user && !isTestEmail(user.email, cfg.scope)) throw new Error("Existing E2E username does not carry the exact test email marker.");
    const password = await bcrypt.hash(cfg.customerPassword, 12);
    if (!user) {
        user = await User.create({
            username,
            email,
            password,
            displayName: `AZIEL E2E ${cfg.scope}`,
            region: "TH",
            role: "user",
            emailVerified: true,
            emailVerifiedAt: new Date(),
            isVerified: true,
            authProvider: "local",
            mlbbUserId: `E2E-${cfg.scope}`,
            mlbbServerId: "0000"
        });
    } else {
        user.password = password;
        user.region = "TH";
        user.isBlocked = false;
        await user.save();
    }

    const adminName = adminUsername(cfg.scope);
    let admin = await AdminAccount.findOne({ usernameNormalized: adminName });
    if (admin && !isTestUsername(admin.usernameNormalized, cfg.scope)) throw new Error("Existing Admin is not an exact E2E identity.");
    const passwordHash = await bcrypt.hash(cfg.adminPassword, 12);
    if (!admin) {
        admin = await AdminAccount.create({
            username: adminName,
            usernameNormalized: adminName,
            displayName: `AZIEL E2E Operations ${cfg.scope}`,
            passwordHash,
            role: "OPERATIONS",
            status: "ACTIVE"
        });
    } else {
        admin.passwordHash = passwordHash;
        admin.role = "OPERATIONS";
        admin.status = "ACTIVE";
        admin.twoFactor = { enabled: false, secretEncrypted: "", pendingSecretEncrypted: "", pendingExpiresAt: null, enabledAt: null };
        await admin.save();
    }

    const product = await CatalogProduct.findOneAndUpdate(
        { productCode: "mlbb" },
        { $setOnInsert: {
            productCode: "mlbb", name: "Mobile Legends E2E", description: "Isolated E2E catalog fixture",
            enabled: true, catalogCategory: "MOBILE_GAME_TOPUP", lifecycleStatus: "ACTIVE",
            commerceState: "PURCHASABLE", publicDiscoveryEnabled: true, homepageEnabled: false,
            productRoute: "mlbb.html", artworkPath: "/assets/games/mlbb.webp",
            supportedRegions: ["TH"], source: "seeded", fulfillment: { manualAllowedRegions: ["TH"] },
            metadata: { azielE2E: true, scope: cfg.scope }
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    if (product.metadata?.azielE2E !== true || product.metadata?.scope !== cfg.scope) throw new Error("Catalog product is not owned by this E2E scope.");

    const pkg = await CatalogPackage.findOneAndUpdate(
        { productCode: "mlbb", packageCode: "MLBB_13_1" },
        { $setOnInsert: {
            productCode: "mlbb", packageCode: "MLBB_13_1", name: "13+1 Diamonds E2E", enabled: true,
            prices: { TH: {
                amount: 10, currency: "THB", enabled: true, supplierCost: 10, supplierCurrency: "THB",
                supplierName: "AZIEL E2E FIXTURE", publishedPriceMode: "MANUAL_OVERRIDE",
                manualOverrideReason: "Isolated E2E fixture price; no real payment is performed."
            } },
            source: "seeded", sortOrder: 1, metadata: { azielE2E: true, scope: cfg.scope, gameName: "Mobile Legends E2E" }
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    if (pkg.metadata?.azielE2E !== true || pkg.metadata?.scope !== cfg.scope) throw new Error("Catalog package is not owned by this E2E scope.");

    const promptPay = await PaymentMethod.findOneAndUpdate(
        { key: "promptpay" },
        { $setOnInsert: {
            method: "PromptPay QR E2E", key: "promptpay", region: "TH", enabled: true,
            paymentType: "manual", provider: "promptpay", providerEnvironment: "TEST",
            qrMode: "aziel_promptpay_dynamic", receiptUploadEnabled: true, confirmationMode: "manual_admin",
            promptPayRecipientType: "NATIONAL_ID", promptPayRecipientValue: "0000000000000",
            dynamicQrExpiryMinutes: 15, dynamicQrSupported: true, amountPrefillSupported: true,
            referenceSupported: true, slipRequired: true, autoVerificationSupported: false,
            webhookSupported: false, enableSaveQr: true, enableOpenApp: false, enableChecklist: false,
            logoUrl: "/assets/payment/promptpay.png", shortDescription: `Isolated E2E PromptPay fixture (${cfg.scope})`,
            badgeText: "E2E", availabilityMode: "MANUAL_ONLY"
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    if (promptPay.providerEnvironment !== "TEST" || !String(promptPay.shortDescription).includes(`(${cfg.scope})`)) {
        throw new Error("PromptPay method is not owned by this E2E scope.");
    }

    console.log(JSON.stringify({
        success: true,
        scope: cfg.scope,
        databaseName: cfg.databaseName,
        customer: { id: String(user._id), username },
        admin: { id: String(admin._id), username: adminName, role: admin.role },
        referenceData: { productCode: product.productCode, packageCode: pkg.packageCode, paymentMethod: promptPay.key },
        marker: `owner.userId=${user._id}; username-prefix=aziel_e2e_`
    }, null, 2));
}

async function api(baseUrl, pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, options);
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    if (!response.ok || body?.success === false) {
        const error = new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${body?.code || body?.error || ""} ${body?.message || ""}`.trim());
        error.details = { endpoint: pathname, status: response.status, body };
        throw error;
    }
    return body;
}

function auth(token, extra = {}) {
    return { authorization: `Bearer ${token}`, ...extra };
}

async function identities(cfg) {
    await connect(cfg);
    const user = await User.findOne({ username: customerUsername(cfg.scope) }).lean();
    const admin = await AdminAccount.findOne({ usernameNormalized: adminUsername(cfg.scope) }).lean();
    if (!user || !isTestEmail(user.email, cfg.scope)) throw new Error("Exact E2E customer is unavailable; run setup.");
    if (!admin || admin.role !== "OPERATIONS" || admin.status !== "ACTIVE") throw new Error("Exact E2E Operations Admin is unavailable; run setup.");
    const permissions = getPermissionsForRole(admin.role);
    REQUIRED_ADMIN_PERMISSIONS.forEach(permission => assert(permissions.includes(permission), `E2E Admin lacks ${permission}`));
    assert(!permissions.includes(PERMISSIONS.ADMIN_ACCOUNTS_MANAGE), "E2E Admin must not manage Admin accounts.");
    return { user, admin, permissions };
}

async function publicPreflight(cfg) {
    const ready = await api(cfg.baseUrl, "/ready");
    const hostname = new URL(cfg.baseUrl).hostname;
    const localTarget = ["127.0.0.1", "localhost", "::1"].includes(hostname);
    const storageState = ready.components?.storage;
    if (storageState !== "ready" && !(localTarget && storageState === "warning" && (ready.warnings || []).includes("STORAGE_LOCAL_FILESYSTEM"))) {
        throw new Error("Runtime storage is not ready for this E2E target.");
    }
    const catalog = await api(cfg.baseUrl, "/api/catalog");
    const candidates = (catalog.products || [])
        .filter(product => ["mlbb", "pubg"].includes(String(product.productCode).toLowerCase()) && product.enabled && product.commerceState === "PURCHASABLE")
        .flatMap(product => (product.packages || []).map(pkg => ({ product, pkg, price: pkg.prices?.TH })))
        .filter(item => item.pkg.enabled && item.price?.enabled && item.price.currency === "THB" && item.pkg.fulfillmentRegions?.TH)
        .sort((a, b) => Number(a.price.amount) - Number(b.price.amount));
    if (!candidates.length) throw new Error("No ready MLBB/PUBG THB package found.");
    const methods = await api(cfg.baseUrl, "/api/payment-methods?region=TH");
    const promptPay = (methods.methods || []).find(method => method.key === "promptpay" && method.publicReady && method.confirmationMode === "manual_admin" && method.receiptUploadEnabled);
    if (!promptPay) throw new Error("Manual PromptPay is not ready for TH.");
    return { ready, selected: candidates[0], promptPay };
}

async function verifyStorageFixture(cfg) {
    const buffer = Buffer.from(fs.readFileSync(FIXTURE, "utf8").trim(), "base64");
    const uploaded = await uploadFile({
        file: { buffer, originalname: `AZIEL-E2E-PREFLIGHT-${cfg.scope}.png`, mimetype: "image/png", size: buffer.length },
        category: "paymentSlip",
        ownerReference: `preflight-${cfg.scope}`,
        env: { ...process.env, CLOUDINARY_CLOUD_NAME: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "" }
    });
    return { provider: uploaded.provider, key: uploaded.key, mimeType: uploaded.mimeType, size: uploaded.size };
}

async function preflight() {
    const cfg = config();
    const identity = await identities(cfg);
    const beforeCounts = {
        quotes: await PricingQuote.countDocuments({}), orders: await CommerceOrder.countDocuments({}),
        payments: await PaymentAttempt.countDocuments({}), fulfillments: await FulfillmentAttempt.countDocuments({})
    };
    const runtime = await publicPreflight(cfg);
    const storageFixture = await verifyStorageFixture(cfg);
    const tokens = await login(cfg);
    const customerRecovery = await api(cfg.baseUrl, "/api/commerce/payments/recoverable", { headers: auth(tokens.customerToken) });
    const adminMe = await api(cfg.baseUrl, "/api/admin/me", { headers: auth(tokens.adminToken) });
    const fulfillmentReachability = await api(cfg.baseUrl, "/api/admin/fulfillments?limit=1", { headers: auth(tokens.adminToken) });
    const afterCounts = {
        quotes: await PricingQuote.countDocuments({}), orders: await CommerceOrder.countDocuments({}),
        payments: await PaymentAttempt.countDocuments({}), fulfillments: await FulfillmentAttempt.countDocuments({})
    };
    assert.deepStrictEqual(afterCounts, beforeCounts, "Preflight must not create transactional records.");
    console.log(JSON.stringify({
        success: true,
        gate: "OPEN_NON_PRODUCTION_ONLY",
        scope: cfg.scope,
        databaseName: cfg.databaseName,
        target: cfg.baseUrl,
        customerId: String(identity.user._id),
        adminId: String(identity.admin._id),
        adminRole: identity.admin.role,
        customerAuth: { durableJwtAccepted: Array.isArray(customerRecovery.recoverable) },
        adminAuth: { durableJwtAccepted: adminMe.admin?.role === "OPERATIONS", permissions: REQUIRED_ADMIN_PERMISSIONS },
        productCode: runtime.selected.product.productCode,
        packageCode: runtime.selected.pkg.packageCode,
        amount: runtime.selected.price.amount,
        currency: runtime.selected.price.currency,
        paymentMethod: runtime.promptPay.key,
        storage: { readiness: runtime.ready.components.storage, fixture: storageFixture },
        fulfillmentRoutes: { reachable: Boolean(fulfillmentReachability.success), mode: "MANUAL_ADMIN_NO_SUPPLIER_API" },
        transactionCounts: afterCounts,
        notificationSuppression: "ACTIVE_FOR_EXACT_E2E_IDENTITY"
    }, null, 2));
}

async function login(cfg) {
    const customer = await api(cfg.baseUrl, "/api/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: customerUsername(cfg.scope), password: cfg.customerPassword })
    });
    const admin = await api(cfg.baseUrl, "/api/admin/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: adminUsername(cfg.scope), password: cfg.adminPassword })
    });
    if (customer.twoFactorRequired || admin.twoFactorRequired) throw new Error("E2E identities must not require interactive 2FA.");
    return { customerToken: customer.token, adminToken: admin.token };
}

async function run() {
    const cfg = config();
    const identity = await identities(cfg);
    const runtime = await publicPreflight(cfg);
    const tokens = await login(cfg);
    const id = runId(cfg.scope);
    const marker = `aziel-e2e:${id}`;
    const chosen = runtime.selected;
    const input = {
        productCode: chosen.product.productCode,
        packageCode: chosen.pkg.packageCode,
        region: "TH", currency: "THB", paymentMethod: "promptpay",
        checkoutKey: marker, orderId: marker,
        userId: `E2E-${id}`, zoneId: "0000", username: customerUsername(cfg.scope)
    };
    const manifest = { runId: id, scope: cfg.scope, marker, createdAt: new Date().toISOString(), customerId: String(identity.user._id), productCode: input.productCode, packageCode: input.packageCode, amount: chosen.price.amount, currency: "THB", states: [] };
    writeManifest(manifest);

    const customerHeaders = auth(tokens.customerToken, { "content-type": "application/json", "idempotency-key": marker, "x-request-id": marker });
    const review = await api(cfg.baseUrl, "/api/commerce/checkout/review", { method: "POST", headers: customerHeaders, body: JSON.stringify(input) });
    manifest.quoteId = review.quote?.quoteId || review.review?.quoteId || review.quoteId;
    input.reviewQuoteId = manifest.quoteId;
    manifest.states.push({ step: "quote", at: new Date().toISOString(), status: review.quote?.status || review.review?.status || "ISSUED" });
    writeManifest(manifest);

    const checkout = await api(cfg.baseUrl, "/api/commerce/checkout/manual-promptpay", { method: "POST", headers: customerHeaders, body: JSON.stringify(input) });
    manifest.orderId = checkout.session?.commerceOrderId || checkout.checkout?.orderId;
    manifest.paymentAttemptId = checkout.session?.attemptId || checkout.payment?.attemptId;
    manifest.states.push({ step: "checkout", at: new Date().toISOString(), orderStatus: checkout.checkout?.status || "pending_payment", paymentStatus: checkout.payment?.paymentStatus || checkout.payment?.status });
    writeManifest(manifest);

    const png = Buffer.from(fs.readFileSync(FIXTURE, "utf8").trim(), "base64");
    const form = new FormData();
    form.append("slip", new Blob([png], { type: "image/png" }), `AZIEL-E2E-${id}.png`);
    const receipt = await api(cfg.baseUrl, `/api/commerce/orders/${encodeURIComponent(manifest.orderId)}/payments/${encodeURIComponent(manifest.paymentAttemptId)}/receipt`, { method: "POST", headers: auth(tokens.customerToken, { "x-request-id": marker }), body: form });
    manifest.receipt = { receiptId: receipt.payment?.receiptEvidence?.receiptId || "bound", storageProvider: receipt.payment?.receiptEvidence?.storageProvider || "reported-by-payment-projection" };
    manifest.states.push({ step: "receipt", at: new Date().toISOString(), status: receipt.payment?.paymentStatus || receipt.payment?.status });
    writeManifest(manifest);

    const adminHeaders = auth(tokens.adminToken, { "content-type": "application/json", "x-request-id": marker });
    await api(cfg.baseUrl, `/api/admin/orders/${encodeURIComponent(manifest.orderId)}`, { headers: adminHeaders });
    const approved = await api(cfg.baseUrl, `/api/admin/commerce/payments/${encodeURIComponent(manifest.paymentAttemptId)}/approve`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ providerEventId: `${marker}:approve`, note: marker }) });
    manifest.states.push({ step: "payment-approved", at: new Date().toISOString(), paymentStatus: approved.payment?.paymentStatus || approved.payment?.status });
    writeManifest(manifest);

    const fulfillmentList = await api(cfg.baseUrl, `/api/admin/fulfillments?orderId=${encodeURIComponent(manifest.orderId)}`, { headers: adminHeaders });
    const attempt = (fulfillmentList.attempts || fulfillmentList.items || []).find(item => item.orderCode === manifest.orderId) || (fulfillmentList.attempts || fulfillmentList.items || [])[0];
    if (!attempt) throw new Error("Payment approval did not create a fulfillment attempt.");
    manifest.fulfillmentAttemptId = attempt.fulfillmentId;
    manifest.states.push({ step: "fulfillment-queued", at: new Date().toISOString(), status: attempt.status, routeType: attempt.routeType });
    writeManifest(manifest);

    try {
        const started = await api(cfg.baseUrl, `/api/admin/fulfillments/${encodeURIComponent(attempt.fulfillmentId)}/start`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ requestId: marker, orderType: "CommerceOrder" }) });
        manifest.states.push({ step: "fulfillment-started", at: new Date().toISOString(), status: started.attempt?.status });
    } catch (error) {
        manifest.failure = { step: "fulfillment-start", requestId: marker, orderType: "CommerceOrder", fulfillmentState: attempt.status, ...error.details };
        writeManifest(manifest);
        throw error;
    }
    const completed = await api(cfg.baseUrl, `/api/admin/fulfillments/${encodeURIComponent(attempt.fulfillmentId)}/succeed`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ supplierReference: marker, note: marker }) });
    manifest.states.push({ step: "fulfillment-succeeded", at: new Date().toISOString(), status: completed.attempt?.status });
    const recovered = await api(cfg.baseUrl, "/api/commerce/payments/recoverable", { headers: auth(tokens.customerToken) });
    manifest.customerRecoveryObserved = Array.isArray(recovered.recoverable);
    manifest.completedAt = new Date().toISOString();
    writeManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
}

async function inspect(id) {
    const cfg = config();
    await connect(cfg);
    const manifest = readManifest(id);
    if (manifest.scope !== cfg.scope || !String(manifest.marker).startsWith(`aziel-e2e:${cfg.scope}-`)) throw new Error("Manifest is outside the active E2E scope.");
    const [quote, order, payment, fulfillment] = await Promise.all([
        manifest.quoteId ? PricingQuote.findOne({ quoteId: manifest.quoteId, "owner.userId": manifest.customerId }).lean() : null,
        manifest.orderId ? CommerceOrder.findOne({ orderId: manifest.orderId, "owner.userId": manifest.customerId }).lean() : null,
        manifest.paymentAttemptId ? PaymentAttempt.findOne({ attemptId: manifest.paymentAttemptId, ownerId: manifest.customerId }).lean() : null,
        manifest.fulfillmentAttemptId ? FulfillmentAttempt.findOne({ fulfillmentId: manifest.fulfillmentAttemptId }).lean() : null
    ]);
    console.log(JSON.stringify({
        runId: manifest.runId, marker: manifest.marker, customerId: manifest.customerId,
        quote: quote && { id: quote.quoteId, status: quote.status, amount: quote.commercialSnapshot.quotedTotalAmount, currency: quote.commercialSnapshot.currency, region: quote.commercialSnapshot.region },
        order: order && { id: order.orderId, quoteId: order.quoteId, status: order.status, paymentStatus: order.paymentStatus, fulfillmentStatus: order.fulfilment?.status, amount: order.commercial.totalAmount, currency: order.commercial.currency, region: order.commercial.region },
        payment: payment && { id: payment.attemptId, orderId: payment.orderId, status: payment.status, amount: payment.amount, currency: payment.currency, region: payment.region },
        fulfillment: fulfillment && { id: fulfillment.fulfillmentId, orderId: String(fulfillment.orderId), orderCode: fulfillment.orderCode, orderModel: fulfillment.orderModel, routeType: fulfillment.routeType, status: fulfillment.status },
        failure: manifest.failure || null
    }, null, 2));
}

async function main() {
    const [command, id] = process.argv.slice(2);
    try {
        if (command === "setup") await setup();
        else if (command === "preflight") await preflight();
        else if (command === "run") await run();
        else if (command === "inspect" && id) await inspect(id);
        else if (command === "cleanup-review" && id) await inspect(id);
        else throw new Error("Usage: e2e-commerce-th.js <setup|preflight|run|inspect RUN_ID|cleanup-review RUN_ID>");
    } finally {
        if (mongoose.connection.readyState) await mongoose.disconnect();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(JSON.stringify({ success: false, code: error.code || "AZIEL_E2E_FAILED", message: error.message, details: error.details || null }, null, 2));
        process.exitCode = 1;
    });
}

module.exports = { config, publicPreflight, readManifest, writeManifest };
