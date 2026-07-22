const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

function loadTrustRuntime() {
    const context = {
        window: {
            ASSET: {
                payment: name => `/assets/payment/${name}`
            },
            AZIEL_LANG: {
                en: {
                    footer_supported_payments: "Supported Payments"
                }
            }
        },
        location: {
            port: "3000",
            protocol: "http:",
            hostname: "localhost"
        },
        localStorage: {
            getItem: key => key === "region" ? "TH" : ""
        },
        document: {
            documentElement: { lang: "en" },
            querySelectorAll: () => []
        },
        fetch: async () => ({ ok: true, json: async () => ({ success: true, methods: [] }) }),
        setTimeout
    };
    context.window.localStorage = context.localStorage;
    vm.createContext(context);
    vm.runInContext(read("frontend/js/payment-trust-display.js"), context);
    return context.window.AZIEL_PAYMENT_TRUST;
}

function main() {
    const paymentMethodsRoute = require("../routes/paymentMethods");
    const internals = paymentMethodsRoute._test;
    assert(internals, "paymentMethods route internals must be exposed for verification");

    const promptPayDefault = internals.defaultMethods.find(item => item.key === "promptpay");
    assert(promptPayDefault, "PromptPay default must exist");
    assert.strictEqual(promptPayDefault.method, "PromptPay QR", "PromptPay storefront label must be QR-specific");
    assert.strictEqual(promptPayDefault.paymentType, "manual", "PromptPay must use manual attempt flow");
    assert.strictEqual(promptPayDefault.qrMode, "aziel_promptpay_dynamic", "PromptPay must use AZIEL dynamic QR");
    assert.strictEqual(promptPayDefault.openAppMode, "bank_chooser", "PromptPay must own bank chooser mode");
    assert.strictEqual(promptPayDefault.appLaunchMode, "APP_ONLY", "PromptPay bank launch must be app-only guidance");
    assert.strictEqual(promptPayDefault.confirmationMode, "manual_admin", "PromptPay remains manual admin verification");
    assert.strictEqual(promptPayDefault.receiptUploadEnabled, true, "PromptPay must require receipt upload");
    assert.strictEqual(promptPayDefault.slipRequired, true, "PromptPay must require slip upload");
    assert.strictEqual(promptPayDefault.autoVerificationSupported, false, "PromptPay must not auto-verify manual QR");
    assert.strictEqual(promptPayDefault.webhookSupported, false, "PromptPay must not use webhooks in manual dynamic mode");
    assert.deepStrictEqual(
        (promptPayDefault.checklistSteps || []).map(step => step.action),
        ["save_qr", "open_app", "scan_saved_qr", "upload_receipt"],
        "PromptPay checklist must be the approved manual QR guidance sequence"
    );

    const launchers = internals.sanitizeBankLaunchers(promptPayDefault.bankLaunchers || []);
    assert.deepStrictEqual(
        launchers.map(item => item.key),
        ["scb", "bangkok_bank", "krungsri", "krungthai"],
        "PromptPay bank launchers must include only the verified supported banks"
    );
    assert(!launchers.some(item => item.key === "kplus"), "K PLUS must not be a visible launcher");
    assert(launchers.every(item => item.enabled === true), "default supported launchers must be enabled");
    assert(launchers.every(item => item.verificationStatus === "verified"), "default launchers must be verified");
    const disabledLauncherProjection = internals.publicBankLaunchersProjection({
        bankLaunchers: [
            { ...launchers[0], enabled: false },
            { ...launchers[1], enabled: true },
            { ...launchers[2], enabled: true, verificationStatus: "failed" },
            { key: "kplus", displayName: "K PLUS", enabled: true, sortOrder: 99 }
        ]
    });
    assert.deepStrictEqual(
        disabledLauncherProjection.map(item => item.key),
        ["bangkok_bank"],
        "public PromptPay launcher projection must exclude disabled, failed, and K PLUS launchers"
    );
    const mergedLaunchers = internals.mergePromptPayLaunchers([
        { ...launchers[0], enabled: false, logoUrl: "/uploads/admin-scb.png", sortOrder: 99 },
        { ...launchers[1], displayName: "Custom BBL", enabled: true, sortOrder: 5 }
    ], [
        { ...launchers[0], enabled: true, logoUrl: "/assets/payment/scb.png", sortOrder: 10 },
        { ...launchers[1], displayName: "Legacy BBL", enabled: true, sortOrder: 20 }
    ]);
    const mergedScb = mergedLaunchers.find(item => item.key === "scb");
    const mergedBbl = mergedLaunchers.find(item => item.key === "bangkok_bank");
    assert.strictEqual(mergedScb.enabled, false, "PromptPay child disabled state must survive seed/sync merge");
    assert.strictEqual(mergedScb.logoUrl, "/uploads/admin-scb.png", "PromptPay child uploaded logo must win over legacy/default sync data");
    assert.strictEqual(mergedBbl.displayName, "Custom BBL", "PromptPay child display name must win over legacy/default sync data");
    assert.strictEqual(mergedBbl.sortOrder, 5, "PromptPay child sort order must win over legacy/default sync data");

    ["scb", "bangkok_bank", "kplus", "krungsri", "krungthai"].forEach(key => {
        assert.strictEqual(
            internals.isLegacyThailandBankMethod({ key, region: "TH" }),
            true,
            `${key} must be classified as legacy standalone bank method`
        );
    });
    assert.strictEqual(
        internals.isLegacyThailandBankMethod({ key: "promptpay", region: "TH" }),
        false,
        "PromptPay itself must remain public"
    );

    includes("backend/models/PaymentMethod.js", "bankLaunchers", "PaymentMethod must store PromptPay bank launcher children");
    includes("backend/routes/paymentMethods.js", "syncPromptPayBankLaunchers", "seed must map legacy bank records into PromptPay launchers");
    includes("backend/routes/paymentMethods.js", ".filter(method => !isLegacyThailandBankMethod(method))", "public API must hide legacy standalone bank methods");
    includes("backend/routes/paymentMethods.js", "applyPromptPayConsolidation", "PromptPay consolidation migration must exist");
    includes("backend/routes/paymentMethods.js", "trustDisplay", "public API must expose a normalized trust display projection");
    includes("backend/routes/paymentMethods.js", "publicBankLaunchersProjection", "public API must project PromptPay launcher trust logos");
    includes("backend/services/paymentProviderRegistry.js", "hasEnabledBankLauncher", "readiness must require bank chooser launchers");
    const promptPayTrust = internals.publicTrustDisplayForMethod({ ...promptPayDefault, enabled: true }, { ready: true });
    assert.deepStrictEqual(
        { label: promptPayTrust.label, group: promptPayTrust.group, enabled: promptPayTrust.enabled },
        { label: "PromptPay", group: "payment_method", enabled: true },
        "PromptPay parent trust display must be a payment-method trust logo"
    );

    [
        "frontend/js/payment.js",
        "frontend/js/region-payment.js"
    ].forEach(file => {
        includes(file, "isStandaloneThaiBankPaymentMethod", "public loader must hide standalone bank cards");
        includes(file, "AZIEL_PAYMENT_TRUST?.normalizePromptPayLaunchers", "public loader must prefer the shared PromptPay launcher collection");
        includes(file, "payment_promptpay_any_thai_bank", "PromptPay card copy must use i18n");
        includes(file, "pay-bank-chips", "PromptPay card may show informational bank chips");
        includes(file, "pay-bank-chip--mobile-more", "mobile PromptPay chips must collapse to +N");
        includes(file, "const visible = enabled;", "desktop PromptPay chips must render all enabled launchers");
        assert(!/escapeHTML\(app\.displayName \|\| app\.appDisplayName \|\| "Bank"\)\s*<\/span>/.test(read(file)), `${file}: bank chips must not render full vertical bank-name labels`);
    });

    includes("frontend/js/payment-trust-display.js", "normalizeTrustCollection", "shared frontend trust runtime must own footer trust logos");
    includes("frontend/js/payment-trust-display.js", "renderFooterTrustLogos", "shared frontend trust runtime must render footer logos");
    includes("frontend/js/pwa-fix.js", "renderFooterTrustLogos", "footer polish runtime must call the shared trust renderer");
    notIncludes("frontend/home.html", "const logos = {", "home footer must not use a static payment-logo list");
    [
        "frontend/mlbb.html",
        "frontend/pubg.html",
        "frontend/freefire.html",
        "frontend/hok.html",
        "frontend/aov-id.html",
        "frontend/pubg-rp.html",
        "frontend/telegram.html",
        "frontend/genshin.html",
        "frontend/roblox.html"
    ].forEach(file => {
        includes(file, "payment-trust-display.js?v=20260722-region-trust", "game pages must load the shared payment trust runtime");
        notIncludes(file, "const logos = {", "game footers must not use static payment-logo lists");
        includes(file, "footer_supported_payments", "footer trust heading must use localized Supported Payments copy");
    });

    const trustRuntime = loadTrustRuntime();
    const shuffledLaunchers = [
        { key: "krungthai", displayName: "Krungthai NEXT", logoUrl: "/assets/payment/ktb.png", enabled: true, sortOrder: 40, verificationStatus: "verified" },
        { key: "kplus", displayName: "K PLUS", logoUrl: "/assets/payment/kplus.png", enabled: true, sortOrder: 1, verificationStatus: "verified" },
        { key: "scb", displayName: "SCB EASY", logoUrl: "/assets/payment/scb.png", enabled: true, sortOrder: 10, verificationStatus: "verified" },
        { key: "bangkok_bank", displayName: "Bangkok Bank Mobile Banking", logoUrl: "/assets/payment/bbl.png", enabled: false, sortOrder: 20, verificationStatus: "verified" },
        { key: "krungsri", displayName: "Krungsri", logoUrl: "/assets/payment/kma.png", enabled: true, sortOrder: 30, verificationStatus: "failed" }
    ];
    const normalizedLaunchers = trustRuntime.normalizePromptPayLaunchers(shuffledLaunchers, { region: "TH" });
    assert.deepStrictEqual(
        normalizedLaunchers.map(item => item.key),
        ["scb", "krungthai"],
        "shared launcher collection must filter K PLUS, disabled, failed, and preserve Admin sort order"
    );
    const trustCollection = trustRuntime.normalizeTrustCollection([
        {
            key: "promptpay",
            provider: "promptpay",
            method: "PromptPay QR",
            region: "TH",
            enabled: true,
            publicReady: true,
            logoUrl: "/assets/payment/promptpay.png",
            sortOrder: 10,
            qrMode: "aziel_promptpay_dynamic",
            trustDisplay: { enabled: true, logo: "/assets/payment/promptpay.png", label: "PromptPay", sortOrder: 10, group: "payment_method" },
            bankLaunchers: shuffledLaunchers
        },
        {
            key: "wallet",
            provider: "wallet",
            method: "AZIEL Wallet",
            region: "TH",
            enabled: true,
            publicReady: true,
            logoUrl: "/assets/logo.png",
            sortOrder: 90,
            paymentType: "wallet",
            trustDisplay: { enabled: true, logo: "/assets/logo.png", label: "AZIEL Wallet", sortOrder: 90, group: "wallet" }
        },
        {
            key: "kbzpay",
            provider: "kbzpay",
            method: "KBZPay",
            region: "MM",
            enabled: true,
            publicReady: true,
            logoUrl: "/assets/payment/kbzpay.png"
        },
        {
            key: "scb",
            provider: "scb",
            method: "SCB",
            region: "TH",
            enabled: true,
            publicReady: true,
            logoUrl: "/assets/payment/scb.png"
        }
    ], "TH");
    assert.deepStrictEqual(
        Array.from(trustCollection.map(item => `${item.group}:${item.key}`)),
        ["payment_method:promptpay", "bank_launcher:scb", "bank_launcher:krungthai", "wallet:wallet"],
        "footer trust collection must be region-aware and hide legacy standalone bank methods"
    );
    const chipHtml = read("frontend/js/payment.js");
    assert(chipHtml.includes("Math.max(0, enabled.length - 3)"), "mobile +X must be calculated from actual enabled launcher count");

    includes("frontend/js/payment/payment-checkout-sheet.js", "activeState?.bankLaunchers", "checkout sheet must use selected PromptPay launcher children");
    includes("frontend/js/payment/payment-checkout-sheet.js", "AZIEL_PAYMENT_TRUST?.normalizePromptPayLaunchers?.(activeState.bankLaunchers, activeState)", "checkout chooser must use the shared PromptPay launcher collection");
    includes("frontend/js/payment/payment-checkout-sheet.js", "payment_choose_banking_app_hint", "bank chooser copy must use i18n");
    includes("frontend/js/payment/payment-checkout-sheet.js", "payment_checklist_scan_saved_qr", "checkout sheet must render the scan saved QR guidance step");
    includes("frontend/js/payment/payment-checkout-sheet.js", "azPaymentSheetQrExpiry", "checkout sheet must show dynamic QR expiry/countdown");
    includes("frontend/js/payment/payment-checkout-sheet.js", "az-payment-sheet__fallback-details", "account details must be secondary fallback details for dynamic QR");
    includes("frontend/js/payment/payment-checkout-sheet.js", "setMobilePromptPayStep", "mobile PromptPay must use explicit QR/receipt steps");
    includes("frontend/js/payment/payment-checkout-sheet.js", "azPaymentMobileBankChooser", "mobile bank chooser must be isolated from the main sheet");
    includes("frontend/js/payment/payment-checkout-sheet.js", "payment_continue_to_receipt", "mobile QR step must continue to receipt upload");
    includes("frontend/js/payment/payment-checkout-sheet.js", "isDesktopPromptPayFlow", "desktop PromptPay must have explicit platform ownership");
    includes("frontend/js/payment/payment-checkout-sheet.js", "renderDesktopSupportedBanks", "desktop PromptPay must render informational supported-bank logos");
    includes("frontend/js/payment/payment-checkout-sheet.js", "const canOpenApp = !desktopPromptPay", "desktop PromptPay must hide bank-launch action");
    includes("frontend/js/payment/payment-checkout-sheet.js", "payment_desktop_checklist_scan_or_save_qr", "desktop PromptPay checklist must avoid Open Banking App requirement");
    includes("frontend/js/payment/payment-checkout-sheet.js", "el.hidden = true;\n        el.textContent = \"\";", "customer-visible QR diagnostics must stay hidden");
    includes("frontend/css/payment/payment-checkout-sheet.css", ".az-payment-sheet.is-mobile-step-qr", "mobile QR step must have dedicated layout rules");
    includes("frontend/css/payment/payment-checkout-sheet.css", ".az-payment-sheet.is-mobile-step-receipt", "mobile receipt step must have dedicated layout rules");
    includes("frontend/css/payment/payment-checkout-sheet.css", ".az-payment-sheet__mobile-chooser", "mobile chooser must be a separate nested sheet");
    includes("frontend/css/payment/payment-checkout-sheet.css", ".az-payment-sheet.is-desktop-promptpay #azPaymentSheetOpenBankApp", "desktop PromptPay must hide Open Banking App");
    includes("frontend/css/payment/payment-checkout-sheet.css", ".az-payment-sheet__desktop-bank-logos img", "desktop bank logos must use fixed image containers");
    includes("frontend/css/payment/payment-checkout-sheet.css", "grid-template-columns: 34px minmax(0, 1fr) auto", "mobile bank chooser rows must have logo/text/chevron structure");
    includes("frontend/css/payment/payment-checkout-sheet.css", "min-height: 56px", "mobile bank chooser rows must have comfortable tap height");
    includes("frontend/css/game/payment-grid.css", "width: 34px;", "storefront PromptPay bank chips must use consistent fixed boxes");
    includes("frontend/css/game/payment-grid.css", "gap: 8px;", "storefront PromptPay bank chips must use clear horizontal spacing");
    includes("frontend/css/payment/payment-checkout-sheet.css", "body.az-payment-sheet-open", "checkout sheet must prevent background scroll");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", "data-bank-fallback=\"other\"", "PromptPay chooser must contain only approved bank launchers plus cancel");
    includes("backend/services/manualPaymentAttemptService.js", "bankLaunchers", "manual attempt instructions must snapshot bank launchers");
    includes("backend/routes/payment.js", "normalizePromptPayAttemptMethod", "manual attempt route must normalize PromptPay before projection");
    includes("backend/routes/payment.js", "bankLaunchers: instructions.bankLaunchers", "manual attempt public payload must expose bank launchers");
    includes("frontend/js/admin-payments.js", "Supported Banking Apps", "admin PromptPay editor must expose bank launcher children");
    includes("frontend/js/admin-payments.js", "collectBankLaunchers", "admin must save bank launchers");
    includes("frontend/js/admin-payments.js", "Legacy / Hidden from storefront", "admin legacy standalone Thai bank rows must be labeled as hidden");
    includes("frontend/js/admin-payments.js", "Managed under PromptPay", "admin legacy standalone Thai bank rows must point to PromptPay child launchers");
    includes("frontend/js/admin-payments.js", "Unsupported / Broken", "admin must clearly mark K PLUS as unsupported");
    includes("frontend/js/admin-payments.js", "Error 116", "admin must explain K PLUS customer visibility is forced off");
    includes("frontend/js/admin-payments.js", "lockLegacyThailandBankEditor", "admin must prevent legacy standalone banks from competing as storefront controls");
    includes("frontend/css/admin/admin.css", ".payment-method-card.is-legacy-thai-bank", "admin legacy payment rows must have visible legacy treatment");

    [
        "frontend/lang/en.js",
        "frontend/lang/my.js",
        "frontend/lang/th.js"
    ].forEach(file => {
        includes(file, "payment_promptpay_qr", "PromptPay QR i18n key missing");
        includes(file, "payment_promptpay_any_thai_bank", "PromptPay helper i18n key missing");
        includes(file, "payment_open_banking_app", "Open Banking App i18n key missing");
        includes(file, "payment_choose_banking_app", "Choose Banking App i18n key missing");
        includes(file, "payment_upload_receipt", "Upload Receipt i18n key missing");
        includes(file, "payment_checklist_scan_saved_qr", "Scan saved QR checklist i18n key missing");
        includes(file, "payment_continue_to_receipt", "Mobile continue to receipt i18n key missing");
        includes(file, "payment_back_to_qr", "Mobile back to QR i18n key missing");
        includes(file, "payment_supported_banking_apps", "Desktop supported banking apps i18n key missing");
        includes(file, "payment_desktop_checklist_pay_with_bank_app", "Desktop checklist i18n key missing");
    });

    const paymentRoute = read("backend/routes/payment.js");
    includes("backend/routes/payment.js", "ManualPaymentAttempt.create", "manual flow must still create ManualPaymentAttempt");
    includes("backend/routes/payment.js", "createOrderFromManualAttempt", "receipt upload must still convert attempt to Order");
    const manualAttemptRoute = paymentRoute.match(/router\.post\("\/payment\/manual\/attempt"[\s\S]*?\/\/ MANUAL \/ DEEPLINK PAYMENT SLIP SUBMIT/)?.[0] || "";
    assert(manualAttemptRoute.includes("createManualAttemptRecord"), "manual attempt route must create a ManualPaymentAttempt record");
    assert(!/Order\.create|createOrderFromManualAttempt/.test(manualAttemptRoute), "manual attempt route must not create an Order before receipt upload");
    notIncludes("backend/routes/payment.js", "ORDER_CREATED_BEFORE_RECEIPT", "Phase 1 must not introduce pre-receipt Order creation");

    console.log("PromptPay consolidation verification passed.");
}

main();
