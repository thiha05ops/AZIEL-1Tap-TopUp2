const fs = require("fs");
const path = require("path");

const {
    buildProductionReadiness,
    developmentOrigins
} = require("../config/security");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

function listFiles(dir, predicate = () => true) {
    const absolute = path.join(ROOT, dir);
    const results = [];

    function walk(current) {
        fs.readdirSync(current, { withFileTypes: true }).forEach(entry => {
            const next = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (["node_modules", ".git", "uploads"].includes(entry.name)) return;
                walk(next);
                return;
            }
            const relative = path.relative(ROOT, next);
            if (predicate(relative)) results.push(relative);
        });
    }

    if (fs.existsSync(absolute)) walk(absolute);
    return results;
}

function addFinding(collection, severity, code, message, scope = "general") {
    collection.push({ severity, code, message, scope });
}

function envStatus(env, key) {
    const value = String(env[key] || "").trim();
    if (!value) return "missing";
    if (/changeme|change[_-]?me|placeholder|your-|example/i.test(value)) return "placeholder";
    return "configured";
}

function paymentKeyMode(value = "") {
    if (value.startsWith("pkey_live_") || value.startsWith("skey_live_")) return "live";
    if (value.startsWith("pkey_test_") || value.startsWith("skey_test_")) return "test";
    return "unknown";
}

function verifyConfiguration(findings) {
    const current = buildProductionReadiness(process.env);
    const productionMode = process.env.NODE_ENV === "production";

    if (productionMode) {
        current.errors.forEach(error => addFinding(findings, "BLOCKER", error.code, error.message, error.feature));
        current.warnings.forEach(warning => addFinding(findings, "WARNING", warning.code, warning.message, warning.feature));
    } else {
        addFinding(
            findings,
            "INFO",
            "LOCAL_ENV_NOT_PRODUCTION",
            "Current verifier run is not using NODE_ENV=production; production policy is still source-audited.",
            "configuration"
        );
    }

    const requiredClassifications = {
        NODE_ENV: "production-required",
        PORT: "platform/provided",
        MONGO_URI: "production-required",
        JWT_SECRET: "production-required",
        SESSION_SECRET: "production-required",
        ADMIN_USERNAME: "production-required-bootstrap",
        ADMIN_PASSWORD: "production-required-bootstrap",
        OMISE_MODE: "production-required-payment",
        OMISE_PUBLIC_KEY: "production-required-payment",
        OMISE_SECRET_KEY: "production-required-payment",
        EMAIL_USER: "production-required-email",
        EMAIL_PASS: "production-required-email",
        REGISTRATION_OTP_PEPPER: "production-required-registration",
        TWO_FACTOR_ENCRYPTION_KEY: "production-required-security",
        ALLOWED_ORIGINS: "production-required-origin",
        STORAGE_MODE: "production-required-storage",
        CLOUDINARY_CLOUD_NAME: "feature-required-storage",
        CLOUDINARY_API_KEY: "feature-required-storage",
        CLOUDINARY_API_SECRET: "feature-required-storage",
        GOOGLE_CLIENT_ID: "optional-google-oauth",
        GOOGLE_CLIENT_SECRET: "optional-google-oauth",
        GOOGLE_CALLBACK_URL: "optional-google-oauth",
        CATALOG_SOURCE: "optional-runtime-selection",
        TELEGRAM_BOT_TOKEN: "optional-ops-notification",
        TELEGRAM_CHAT_ID: "optional-ops-notification"
    };

    Object.entries(requiredClassifications).forEach(([key, classification]) => {
        addFinding(findings, "INFO", `ENV_${key}`, `${key}: ${classification}; current status=${envStatus(process.env, key)}.`, "configuration");
    });

    return { current, productionMode };
}

function verifyEmailPolicy(findings) {
    const registration = read("backend/services/registrationService.js");
    const password = read("backend/routes/password.js");
    const mail = read("backend/services/mail.js");
    const transport = read("backend/services/emailTransportService.js");

    if (
        registration.includes("sendVerifyOTP") &&
        registration.includes("REGISTRATION_EMAIL_SEND_FAILED") &&
        password.includes("sendResetOTP") &&
        mail.includes("sendEmail") &&
        transport.includes("nodemailer.createTransport") &&
        transport.includes("lookupIpv4")
    ) {
        addFinding(
            findings,
            "INFO",
            "EMAIL_POLICY_LAUNCH_CRITICAL",
            "Email is launch-critical because registration OTP and forgot-password OTP have no safe non-email fallback.",
            "email"
        );
        return;
    }

    addFinding(findings, "BLOCKER", "EMAIL_POLICY_UNCLEAR", "Email OTP ownership could not be proven.", "email");
}

function verifyPayment(findings) {
    const paymentRoute = read("backend/routes/payment.js");
    const omise = read("backend/services/omisePaymentService.js");
    const mode = String(process.env.OMISE_MODE || "").trim().toLowerCase();
    const publicMode = paymentKeyMode(String(process.env.OMISE_PUBLIC_KEY || "").trim());
    const secretMode = paymentKeyMode(String(process.env.OMISE_SECRET_KEY || "").trim());

    if (!omise.includes("retrieveVerifiedCharge") || !omise.includes("assertChargeMatchesRecord")) {
        addFinding(findings, "BLOCKER", "PAYMENT_PROVIDER_VERIFICATION_MISSING", "Omise charge retrieval/record matching service is missing.", "payment");
    }

    if (!paymentRoute.includes("retrieveVerifiedCharge") || !paymentRoute.includes("applyPaymentToOrder")) {
        addFinding(findings, "BLOCKER", "PAYMENT_WEBHOOK_STATE_OWNER_MISSING", "Payment webhook does not prove provider retrieval and canonical state application.", "payment");
    }

    if (process.env.NODE_ENV === "production" && mode === "live" && (publicMode === "test" || secretMode === "test")) {
        addFinding(findings, "BLOCKER", "PAYMENT_TEST_KEY_IN_PRODUCTION", "Production live mode is using test payment keys.", "payment");
    } else if (mode === "test") {
        addFinding(findings, "WARNING", "PAYMENT_TEST_MODE", "Payment mode is test; controlled launch may proceed only if owner accepts non-live payments.", "payment");
    }

    addFinding(findings, "INFO", "PAYMENT_WEBHOOK_AUTHENTICITY_MODEL", "Webhook authenticity is enforced by provider charge retrieval and server-side amount/currency/metadata checks.", "payment");
}

function verifyOrigins(findings) {
    const security = read("backend/config/security.js");
    const frontendFiles = listFiles("frontend", file => /\.(js|html|xml)$/.test(file));
    const runtimeLocalhost = [];

    frontendFiles.forEach(file => {
        const source = read(file);
        if (!/localhost|127\.0\.0\.1|:5500|:3000/.test(source)) return;
        const developmentGuarded = /location\.port\s*={2,3}\s*"5500"|location\.hostname\s*={2,3}\s*"localhost"|127\.0\.0\.1/.test(source);
        if (!developmentGuarded && !file.endsWith(".xml")) runtimeLocalhost.push(file);
    });

    if (!security.includes("credentials: true") || !security.includes("getAllowedOrigins")) {
        addFinding(findings, "BLOCKER", "CORS_POLICY_NOT_CENTRALIZED", "Express/Socket CORS ownership is not centrally auditable.", "origin");
    }

    if (!security.includes("env.NODE_ENV === \"production\"")) {
        addFinding(findings, "BLOCKER", "PROD_ORIGIN_POLICY_MISSING", "Production origins are not separated from development origins.", "origin");
    }

    if (runtimeLocalhost.length) {
        addFinding(findings, "BLOCKER", "FRONTEND_LOCALHOST_RUNTIME_LEAK", `Potential unguarded localhost references: ${runtimeLocalhost.join(", ")}`, "frontend");
    } else {
        addFinding(findings, "INFO", "FRONTEND_LOCALHOST_DEVELOPMENT_ONLY", "Localhost frontend references are guarded for local development workflows.", "frontend");
    }

    addFinding(findings, "INFO", "DEVELOPMENT_ORIGINS", `Development origins: ${developmentOrigins.join(", ")}`, "origin");
}

function verifyStartupAndHealth(findings) {
    const server = read("backend/server.js");

    [
        ["validateProductionReadiness();", "STARTUP_READINESS_BEFORE_DB"],
        ["const mongoConnection = await connectDB();", "STARTUP_AWAITS_MONGO"],
        ["configureApplication(mongoConnection);", "STARTUP_CONFIGURES_AFTER_MONGO"],
        ["server.listen(PORT", "STARTUP_LISTENS_AFTER_CONFIG"],
        ["process.once(\"SIGTERM\"", "SHUTDOWN_SIGTERM"],
        ["process.once(\"SIGINT\"", "SHUTDOWN_SIGINT"],
        ["io.close()", "SHUTDOWN_SOCKET_CLOSE"],
        ["mongoose.connection.close(false)", "SHUTDOWN_MONGO_CLOSE"],
        ["app.get(\"/health\"", "HEALTH_ENDPOINT"],
        ["app.get(\"/ready\"", "READINESS_ENDPOINT"]
    ].forEach(([needle, code]) => {
        if (!server.includes(needle)) {
            addFinding(findings, "BLOCKER", code, `${needle} not found in backend/server.js.`, "startup");
        }
    });
}

function verifyIndexes(findings) {
    const expected = {
        "backend/models/Order.js": ["createdAt: -1, _id: -1", "status: 1, createdAt: -1", "username: 1, createdAt: -1"],
        "backend/models/User.js": ["username: 1, createdAt: -1", "email: 1, createdAt: -1"],
        "backend/models/WalletTopup.js": ["status: 1, createdAt: -1", "username: 1, createdAt: -1"],
        "backend/models/WalletTransaction.js": ["username: 1, createdAt: -1", "referenceType: 1, referenceId: 1"],
        "backend/models/FulfillmentAttempt.js": ["status: 1, createdAt: -1", "idempotencyKey: 1"],
        "backend/models/AdminAuditLog.js": ["createdAt: -1", "action: 1, createdAt: -1"],
        "backend/models/SupportTicket.js": ["status: 1, createdAt: -1", "unreadByAdmin: 1, status: 1"],
        "backend/models/LiveChat.js": ["status: 1, lastMessageAt: -1", "username: 1, status: 1"],
        "backend/models/Notification.js": ["userId: 1, createdAt: -1", "username: 1, createdAt: -1"],
        "backend/models/ManualPaymentAttempt.js": ["username: 1, status: 1, expiresAt: 1", "expireAfterSeconds"]
    };

    Object.entries(expected).forEach(([file, snippets]) => {
        const source = read(file);
        snippets.forEach(snippet => {
            if (!source.includes(snippet)) {
                addFinding(findings, "BLOCKER", "MONGO_INDEX_DECLARATION_MISSING", `${file} missing expected index intent: ${snippet}`, "database");
            }
        });
    });

    addFinding(findings, "INFO", "MONGO_INDEX_SYNC_POLICY", "Schema index declarations are audited; verifier does not call syncIndexes() or mutate production indexes.", "database");
}

function verifyStorage(findings) {
    const storage = read("backend/services/storageService.js");
    const profile = read("backend/routes/profile.js");
    const localDiskUploads = listFiles("backend/routes", file => read(file).includes("multer.diskStorage"));

    if (!storage.includes("mode === \"cloudinary\"") || !storage.includes("mode === \"local\"")) {
        addFinding(findings, "BLOCKER", "DURABLE_STORAGE_POLICY_MISSING", "Storage service does not expose durable/local mode ownership.", "storage");
    }

    if (localDiskUploads.length) {
        addFinding(findings, "BLOCKER", "LOCAL_PERSISTENT_UPLOAD_ROUTE", `Persistent upload route still writes directly to local disk: ${localDiskUploads.join(", ")}`, "storage");
    }

    if (!profile.includes("uploadFile") || !profile.includes("profilePhoto")) {
        addFinding(findings, "BLOCKER", "PROFILE_PHOTO_DURABLE_STORAGE_MISSING", "Profile photo upload is not using shared durable storage.", "storage");
    }
}

function verifySecurity(findings) {
    const routeFiles = listFiles("backend/routes", file => file.endsWith(".js"));
    const criticalAdminPatterns = [
        ["/admin/orders", "backend/routes/order.js"],
        ["/admin/wallet", "backend/routes/wallet.js"],
        ["/admin/suppliers", "backend/routes/supplier.js"],
        ["/admin/fulfillments", "backend/routes/supplier.js"],
        ["/admin/catalog", "backend/routes/catalog.js"],
        ["/admin/promos", "backend/routes/promos.js"],
        ["/admin/campaigns", "backend/routes/campaigns.js"],
        ["/admin/site-placements", "backend/routes/sitePlacements.js"],
        ["/admin/home-banners", "backend/routes/homeBanners.js"],
        ["/admin/support", "backend/routes/support.js"],
        ["/admin/audit-logs", "backend/routes/adminAuth.js"]
    ];

    criticalAdminPatterns.forEach(([route, file]) => {
        const source = read(file);
        if (!source.includes(route) || !source.includes("adminMiddleware") || !source.includes("requireAdminPermission")) {
            addFinding(findings, "BLOCKER", "ADMIN_ROUTE_PROTECTION_MISSING", `${file} does not prove protected ownership for ${route}.`, "security");
        }
    });

    const unprotectedMutations = [];
    routeFiles.forEach(file => {
        const lines = read(file).split("\n");
        lines.forEach((line, index) => {
            if (!/router\.(post|put|patch|delete)\(/.test(line)) return;
            const declaration = lines.slice(index, index + 8).join(" ");
            const intentionallyPublic = (
                file === "backend/routes/password.js" ||
                /\/register|\/login|\/verify-email|\/auth\/2fa|\/payment\/webhook|\/promos\/quote|\/campaigns\/entry-popup\/claim|router\.post\("\/ai"/.test(declaration)
            );
            if (intentionallyPublic) return;
            if (!declaration.includes("authMiddleware") && !declaration.includes("adminMiddleware") && !declaration.includes("optionalAuthMiddleware")) {
                unprotectedMutations.push(`${file}:${index + 1}`);
            }
        });
    });

    if (unprotectedMutations.length) {
        addFinding(findings, "BLOCKER", "UNPROTECTED_MUTATION_ROUTE", `Potential unprotected mutation routes: ${unprotectedMutations.join(", ")}`, "security");
    }
}

function verifyRunbook(findings) {
    if (!exists("docs/production-launch-runbook.md")) {
        addFinding(findings, "BLOCKER", "PRODUCTION_RUNBOOK_MISSING", "Production launch runbook is missing.", "operations");
        return;
    }

    const runbook = read("docs/production-launch-runbook.md");
    ["PRE-DEPLOY", "DEPLOY", "POST-DEPLOY SMOKE", "ROLLBACK", "INCIDENT STOP CONDITIONS"].forEach(section => {
        if (!runbook.includes(section)) {
            addFinding(findings, "BLOCKER", "PRODUCTION_RUNBOOK_INCOMPLETE", `Runbook missing ${section}.`, "operations");
        }
    });
}

function printSection(title, findings, scope) {
    console.log(`\n${title}`);
    findings
        .filter(finding => finding.scope === scope)
        .forEach(finding => {
            console.log(`[${finding.severity}] ${finding.code} - ${finding.message}`);
        });
}

function main() {
    const findings = [];

    verifyConfiguration(findings);
    verifyEmailPolicy(findings);
    verifyPayment(findings);
    verifyOrigins(findings);
    verifyStartupAndHealth(findings);
    verifyIndexes(findings);
    verifyStorage(findings);
    verifySecurity(findings);
    verifyRunbook(findings);

    addFinding(findings, "WARNING", "MANUAL_PROVIDER_DASHBOARD_CHECK_REQUIRED", "Confirm Render env, payment dashboard mode, webhook URL, email mailbox health, and Mongo backup before launch.", "operations");
    addFinding(findings, "WARNING", "MANUAL_FRONTEND_SMOKE_REQUIRED", "Run the Phase 16 mobile/desktop public and Admin smoke matrix before launch.", "frontend");
    addFinding(findings, "INFO", "CATALOG_ADMIN_MANAGED_PRICE_DRIFT_POLICY", "Admin-managed catalog price drift is informational unless server-side runtime catalog verification fails.", "catalog");

    const blockers = findings.filter(finding => finding.severity === "BLOCKER");
    const warnings = findings.filter(finding => finding.severity === "WARNING");
    const decision = blockers.length ? "FAIL" : warnings.length ? "CONDITIONAL PASS" : "PASS";

    console.log("PUBLIC LAUNCH READINESS");
    printSection("CONFIGURATION", findings, "configuration");
    printSection("PAYMENTS", findings, "payment");
    printSection("EMAIL", findings, "email");
    printSection("DATABASE", findings, "database");
    printSection("STORAGE", findings, "storage");
    printSection("SECURITY", findings, "security");
    printSection("FRONTEND", findings, "frontend");
    printSection("ORIGIN / PROXY", findings, "origin");
    printSection("STARTUP", findings, "startup");
    printSection("CATALOG", findings, "catalog");
    printSection("OPERATIONS", findings, "operations");

    console.log(`\nSUMMARY: ${blockers.length} blocker(s), ${warnings.length} warning(s), ${findings.length - blockers.length - warnings.length} info item(s).`);
    console.log(`FINAL DECISION: ${decision}`);

    if (blockers.length) process.exitCode = 1;
}

main();
