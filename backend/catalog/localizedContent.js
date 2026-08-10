const SUPPORTED_CONTENT_LOCALES = Object.freeze(["en", "my", "th"]);

class LocalizedContentError extends Error {
    constructor(message) {
        super(message);
        this.name = "LocalizedContentError";
        this.code = "LOCALIZED_CONTENT_INVALID";
        this.statusCode = 400;
    }
}

function normalizeLocale(value) {
    const locale = String(value || "").trim().toLowerCase();
    return SUPPORTED_CONTENT_LOCALES.includes(locale) ? locale : "en";
}

function text(value, field, max, { required = false } = {}) {
    if (value == null) value = "";
    if (typeof value !== "string") throw new LocalizedContentError(`${field} must be plain text.`);
    const normalized = value.trim();
    if (/[<>]/.test(normalized)) throw new LocalizedContentError(`${field} cannot contain HTML.`);
    if (normalized.length > max) throw new LocalizedContentError(`${field} must be ${max} characters or fewer.`);
    if (required && normalized.length < 2) throw new LocalizedContentError(`${field} is required.`);
    return normalized;
}

function normalizeCampaignLocales(locales = {}, english = {}) {
    if (locales == null) locales = {};
    if (typeof locales !== "object" || Array.isArray(locales)) throw new LocalizedContentError("locales must be an object.");
    return Object.fromEntries(SUPPORTED_CONTENT_LOCALES.map(locale => {
        const source = locale === "en" ? (locales.en || english) : (locales[locale] || {});
        if (typeof source !== "object" || Array.isArray(source)) throw new LocalizedContentError(`locales.${locale} must be an object.`);
        return [locale, {
            title: text(source.title, `locales.${locale}.title`, 120, { required: locale === "en" }),
            body: text(source.body, `locales.${locale}.body`, 700, { required: locale === "en" }),
            ctaLabel: text(source.ctaLabel, `locales.${locale}.ctaLabel`, 40)
        }];
    }));
}

function resolveCampaignLocale(locales = {}, locale = "en", english = {}) {
    const normalized = normalizeCampaignLocales(locales, english);
    const requested = normalized[normalizeLocale(locale)];
    return {
        title: requested.title || normalized.en.title,
        body: requested.body || normalized.en.body,
        ctaLabel: requested.ctaLabel || normalized.en.ctaLabel
    };
}

function normalizeTextLocales(locales = {}, legacyEnglish = "", field = "locales", max = 120) {
    if (locales == null) locales = {};
    if (typeof locales !== "object" || Array.isArray(locales)) throw new LocalizedContentError(`${field} must be an object.`);
    return Object.fromEntries(SUPPORTED_CONTENT_LOCALES.map(locale => [locale,
        text(locale === "en" ? (locales.en ?? legacyEnglish) : locales[locale], `${field}.${locale}`, max)
    ]));
}

function resolveTextLocale(locales = {}, locale = "en", legacyEnglish = "", field = "locales", max = 120) {
    const normalized = normalizeTextLocales(locales, legacyEnglish, field, max);
    return normalized[normalizeLocale(locale)] || normalized.en || "";
}

module.exports = {
    SUPPORTED_CONTENT_LOCALES,
    LocalizedContentError,
    normalizeLocale,
    normalizeCampaignLocales,
    resolveCampaignLocale,
    normalizeTextLocales,
    resolveTextLocale
};
