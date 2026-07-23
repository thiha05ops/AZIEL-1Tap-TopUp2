(function () {
    const REGION_KEYS = ["selectedRegion", "region"];
    const LEGACY_TH_BANK_KEYS = new Set(["scb", "bangkokbank", "bangkok_bank", "kplus", "krungsri", "krungthai"]);
    const HIDDEN_LAUNCHER_KEYS = new Set(["kplus"]);
    const USABLE_LAUNCHER_STATUSES = new Set(["", "verified", "usable", "ready", "active"]);
    const cache = new Map();

    function getApiBase() {
        if (location.port === "5500") {
            const host = location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
            return `${location.protocol}//${host}:3000`;
        }
        return "";
    }

    function currentRegion() {
        return String(
            window.AZIEL?.getShopRegion?.() ||
            window.AZIEL?.getRegion?.() ||
            REGION_KEYS.map(key => localStorage.getItem(key)).find(Boolean) ||
            "MM"
        ).toUpperCase();
    }

    function canonicalKey(value = "") {
        const compact = String(value || "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, "");
        const aliases = {
            ayapay: "ayapay",
            aya: "ayapay",
            kbzpay: "kbzpay",
            wavepay: "wavepay",
            promptpay: "promptpay",
            promptpayqr: "promptpay",
            scbeasy: "scb",
            scb: "scb",
            bangkokbank: "bangkok_bank",
            bualuang: "bangkok_bank",
            kplus: "kplus",
            kasikorn: "kplus",
            krungsri: "krungsri",
            krungthainext: "krungthai",
            krungthai: "krungthai",
            azielwallet: "wallet",
            wallet: "wallet"
        };
        return aliases[compact] || compact;
    }

    function assetLogo(name) {
        if (window.ASSET?.payment) {
            const fromAsset = window.ASSET.payment(name);
            if (fromAsset) return fromAsset;
        }
        return `/assets/payment/${name}`;
    }

    function fallbackLogo(key) {
        const normalized = canonicalKey(key);
        const logos = {
            ayapay: assetLogo("ayapay.png"),
            kbzpay: assetLogo("kbzpay.png"),
            wavepay: assetLogo("wavepay.png"),
            promptpay: assetLogo("promptpay.png"),
            scb: assetLogo("scb.png"),
            bangkok_bank: assetLogo("bank-neutral.svg"),
            krungsri: assetLogo("bank-neutral.svg"),
            krungthai: assetLogo("bank-neutral.svg"),
            wallet: "/assets/logo.png"
        };
        return logos[normalized] || assetLogo("payment-neutral.svg");
    }

    function isLegacyThailandBankMethod(method = {}) {
        return String(method.region || "").toUpperCase() === "TH" &&
            LEGACY_TH_BANK_KEYS.has(canonicalKey(method.key || method.provider || method.method));
    }

    function isPublicPaymentMethodUsable(method = {}) {
        const key = canonicalKey(method.key || method.provider || method.method);
        const type = String(method.paymentType || "manual").toLowerCase();
        const provider = canonicalKey(method.provider || key);
        if (method.enabled !== true) return false;
        if (method.publicReady === false) return false;
        if (String(method.maintenanceMessage || "").trim()) return false;
        if (key === "wallet" || provider === "wallet" || type === "wallet") return true;
        if (type === "auto") return true;
        if (method.qrMode === "aziel_promptpay_dynamic") return true;
        return Boolean(method.qrImage || method.qrImageUrl || method.uploadedQrImage || method.finalQrImage);
    }

    function sortByTrustOrder(a = {}, b = {}) {
        const orderA = Number(a.sortOrder || 0);
        const orderB = Number(b.sortOrder || 0);
        if (orderA !== orderB) return orderA - orderB;
        return String(a.label || a.displayName || a.key || "").localeCompare(String(b.label || b.displayName || b.key || ""));
    }

    function normalizePromptPayLaunchers(launchers = [], parent = {}) {
        if (!Array.isArray(launchers)) return [];
        const region = String(parent.region || "TH").toUpperCase();
        const seen = new Set();
        return launchers
            .map(item => {
                if (!item) return null;
                const key = canonicalKey(item.key || item.provider || item.displayName || item.appDisplayName);
                const status = String(item.verificationStatus || "").trim().toLowerCase();
                if (!key || seen.has(key) || HIDDEN_LAUNCHER_KEYS.has(key)) return null;
                if (item.enabled === false || item.enabled === "false") return null;
                if (!USABLE_LAUNCHER_STATUSES.has(status)) return null;
                seen.add(key);
                const label = item.displayName || item.appDisplayName || item.label || "Banking App";
                const logo = item.logoUrl || item.logo || item.trustDisplay?.logo || fallbackLogo(key);
                return {
                    ...item,
                    key,
                    region,
                    displayName: label,
                    label,
                    logoUrl: logo,
                    logo,
                    enabled: true,
                    appLaunchMode: item.appLaunchMode || "APP_ONLY",
                    sortOrder: Number(item.sortOrder || item.trustDisplay?.sortOrder || 0),
                    trustDisplay: {
                        enabled: true,
                        logo,
                        label,
                        sortOrder: Number(item.sortOrder || item.trustDisplay?.sortOrder || 0),
                        group: "bank_launcher"
                    }
                };
            })
            .filter(Boolean)
            .sort(sortByTrustOrder);
    }

    function uniqueByIdentity(items = []) {
        const seen = new Set();
        return items.filter(item => {
            const key = `${item.group || "payment"}:${canonicalKey(item.key || item.label)}:${item.logo}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function normalizeTrustCollection(methods = [], region = currentRegion()) {
        const targetRegion = String(region || "MM").toUpperCase();
        const entries = [];

        methods
            .filter(method => String(method.region || "").toUpperCase() === targetRegion)
            .filter(method => !isLegacyThailandBankMethod(method))
            .filter(isPublicPaymentMethodUsable)
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
            .forEach(method => {
                const key = canonicalKey(method.key || method.provider || method.method);
                const trust = method.trustDisplay || {};
                const label = trust.label || method.method || method.appDisplayName || key || "Payment";
                const logo = trust.logo || method.logoUrl || method.logo || fallbackLogo(key);
                entries.push({
                    key,
                    region: targetRegion,
                    group: trust.group || (key === "wallet" ? "wallet" : "payment_method"),
                    label,
                    logo,
                    enabled: true,
                    sortOrder: Number(trust.sortOrder || method.sortOrder || 0)
                });

                if (targetRegion === "TH" && key === "promptpay") {
                    normalizePromptPayLaunchers(method.bankLaunchers || [], method).forEach(launcher => {
                        entries.push({
                            key: launcher.key,
                            region: targetRegion,
                            group: "bank_launcher",
                            label: launcher.label,
                            logo: launcher.logo,
                            enabled: true,
                            sortOrder: Number(launcher.sortOrder || 0)
                        });
                    });
                }
            });

        return uniqueByIdentity(entries).sort(sortByTrustOrder);
    }

    async function fetchPublicPaymentMethods(region = currentRegion(), options = {}) {
        const targetRegion = String(region || "MM").toUpperCase();
        if (options.refresh) cache.delete(targetRegion);
        if (!cache.has(targetRegion)) {
            cache.set(targetRegion, fetch(`${getApiBase()}/api/payment-methods?region=${encodeURIComponent(targetRegion)}`, {
                headers: { Accept: "application/json" },
                cache: "no-store"
            })
                .then(async response => {
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok || data.success === false) {
                        throw new Error(data.message || "Payment methods failed to load");
                    }
                    return Array.isArray(data.methods) ? data.methods : [];
                })
                .catch(error => {
                    cache.delete(targetRegion);
                    throw error;
                }));
        }
        return cache.get(targetRegion);
    }

    function translate(key, fallback = "") {
        const translated = window.AZIEL_I18N?.t?.(key, fallback);
        if (translated && translated !== key) return translated;
        const lang =
            localStorage.getItem("azielLanguage") ||
            document.documentElement?.lang ||
            "en";
        return window.AZIEL_LANG?.[lang]?.[key] || window.AZIEL_LANG?.en?.[key] || fallback;
    }

    async function renderFooterTrustLogos(options = {}) {
        const boxes = Array.from(document.querySelectorAll(".payment-logos"));
        if (!boxes.length) return [];
        const region = String(options.region || currentRegion()).toUpperCase();
        const methods = await fetchPublicPaymentMethods(region, { refresh: options.refresh });
        const trustLogos = normalizeTrustCollection(methods, region);

        boxes.forEach(box => {
            box.setAttribute("aria-label", translate("footer_supported_payments", "Supported Payments"));
            box.innerHTML = "";
            trustLogos.forEach(item => {
                const img = document.createElement("img");
                img.src = item.logo;
                img.alt = item.label;
                img.title = item.label;
                img.loading = "lazy";
                img.decoding = "async";
                img.dataset.paymentTrustGroup = item.group;
                img.dataset.paymentTrustKey = item.key;
                img.addEventListener("error", () => {
                    img.src = fallbackLogo("payment-neutral");
                }, { once: true });
                box.appendChild(img);
            });
        });

        return trustLogos;
    }

    window.AZIEL_PAYMENT_TRUST = {
        canonicalKey,
        currentRegion,
        fetchPublicPaymentMethods,
        normalizePromptPayLaunchers,
        normalizeTrustCollection,
        renderFooterTrustLogos
    };
})();
