const LIMITS = Object.freeze({
    shortDescription: 280,
    aboutSummary: 500,
    aboutDetails: 3000,
    purchaseNotes: 12,
    noteTitle: 100,
    noteBody: 800,
    guideIntro: 800,
    guideGroups: 12,
    guideTitle: 100,
    guideDescription: 800,
    packageCodes: 30,
    faq: 20,
    faqQuestion: 180,
    faqAnswer: 1200,
    customerNote: 500
});

class ProductKnowledgeError extends Error {
    constructor(message) {
        super(message);
        this.name = "ProductKnowledgeError";
        this.code = "PRODUCT_KNOWLEDGE_INVALID";
        this.statusCode = 400;
    }
}

function plainText(value, field, max) {
    if (value == null) return "";
    if (typeof value !== "string") throw new ProductKnowledgeError(`${field} must be plain text.`);
    const result = value.trim();
    if (/[<>]/.test(result)) throw new ProductKnowledgeError(`${field} cannot contain HTML.`);
    if (result.length > max) throw new ProductKnowledgeError(`${field} must be ${max} characters or fewer.`);
    return result;
}

function objectValue(value, field) {
    if (value == null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new ProductKnowledgeError(`${field} must be an object.`);
    return value;
}

function arrayValue(value, field, max) {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new ProductKnowledgeError(`${field} must be an array.`);
    if (value.length > max) throw new ProductKnowledgeError(`${field} supports at most ${max} items.`);
    return value;
}

const SUPPORTED_LOCALES = Object.freeze(["en", "my", "th"]);

function normalizeKnowledgeLocale(value = {}, prefix = "productKnowledge") {
    const input = objectValue(value, "productKnowledge");
    const about = objectValue(input.about, "productKnowledge.about");
    const guide = objectValue(input.packageGuide, "productKnowledge.packageGuide");
    return {
        shortDescription: plainText(input.shortDescription, `${prefix}.shortDescription`, LIMITS.shortDescription),
        about: {
            summary: plainText(about.summary, "about.summary", LIMITS.aboutSummary),
            details: plainText(about.details, "about.details", LIMITS.aboutDetails)
        },
        purchaseNotes: arrayValue(input.purchaseNotes, "purchaseNotes", LIMITS.purchaseNotes).map((item, index) => {
            const row = objectValue(item, `purchaseNotes[${index}]`);
            return {
                title: plainText(row.title, `purchaseNotes[${index}].title`, LIMITS.noteTitle),
                body: plainText(row.body, `purchaseNotes[${index}].body`, LIMITS.noteBody)
            };
        }).filter(item => item.title || item.body),
        packageGuide: {
            intro: plainText(guide.intro, "packageGuide.intro", LIMITS.guideIntro),
            groups: arrayValue(guide.groups, "packageGuide.groups", LIMITS.guideGroups).map((item, index) => {
                const row = objectValue(item, `packageGuide.groups[${index}]`);
                const codes = arrayValue(row.packageCodes, `packageGuide.groups[${index}].packageCodes`, LIMITS.packageCodes)
                    .map((code, codeIndex) => plainText(code, `packageGuide.groups[${index}].packageCodes[${codeIndex}]`, 80).toUpperCase())
                    .filter(Boolean);
                return {
                    title: plainText(row.title, `packageGuide.groups[${index}].title`, LIMITS.guideTitle),
                    description: plainText(row.description, `packageGuide.groups[${index}].description`, LIMITS.guideDescription),
                    packageCodes: [...new Set(codes)]
                };
            }).filter(item => item.title || item.description || item.packageCodes.length)
        },
        faq: arrayValue(input.faq, "faq", LIMITS.faq).map((item, index) => {
            const row = objectValue(item, `faq[${index}]`);
            return {
                question: plainText(row.question, `faq[${index}].question`, LIMITS.faqQuestion),
                answer: plainText(row.answer, `faq[${index}].answer`, LIMITS.faqAnswer)
            };
        }).filter(item => item.question || item.answer)
    };
}

function normalizeProductKnowledge(value = {}) {
    const input = objectValue(value, "productKnowledge");
    const localeInput = objectValue(input.locales, "productKnowledge.locales");
    const legacyEnglish = normalizeKnowledgeLocale(input, "productKnowledge");
    const english = localeInput.en == null
        ? legacyEnglish
        : normalizeKnowledgeLocale(localeInput.en, "productKnowledge.locales.en");
    const locales = { en: english };
    ["my", "th"].forEach(locale => {
        locales[locale] = normalizeKnowledgeLocale(localeInput[locale] || {}, `productKnowledge.locales.${locale}`);
    });
    return { ...english, locales };
}

function hasKnowledgeContent(value = {}) {
    const knowledge = normalizeKnowledgeLocale(value);
    return Boolean(
        knowledge.shortDescription || knowledge.about.summary || knowledge.about.details ||
        knowledge.purchaseNotes.length || knowledge.packageGuide.intro || knowledge.packageGuide.groups.length || knowledge.faq.length
    );
}

function resolveLocalizedProductKnowledge(value = {}, locale = "en") {
    const knowledge = normalizeProductKnowledge(value);
    const normalizedLocale = SUPPORTED_LOCALES.includes(String(locale || "").toLowerCase()) ? String(locale).toLowerCase() : "en";
    const requested = knowledge.locales[normalizedLocale];
    const english = knowledge.locales.en;
    if (normalizedLocale === "en") return english;
    return {
        shortDescription: requested.shortDescription || english.shortDescription,
        about: {
            summary: requested.about.summary || english.about.summary,
            details: requested.about.details || english.about.details
        },
        purchaseNotes: requested.purchaseNotes.length ? requested.purchaseNotes : english.purchaseNotes,
        packageGuide: {
            intro: requested.packageGuide.intro || english.packageGuide.intro,
            groups: requested.packageGuide.groups.length ? requested.packageGuide.groups : english.packageGuide.groups
        },
        faq: requested.faq.length ? requested.faq : english.faq
    };
}

function normalizeCustomerNote(value) {
    return plainText(value, "customerNote", LIMITS.customerNote);
}

function normalizeCustomerNoteLocales(value = {}, legacyEnglish = "") {
    const input = objectValue(value, "customerNoteLocales");
    return Object.fromEntries(SUPPORTED_LOCALES.map(locale => [locale,
        normalizeCustomerNote(locale === "en" ? (input.en ?? legacyEnglish) : input[locale])
    ]));
}

function resolveLocalizedCustomerNote(locales = {}, locale = "en", legacyEnglish = "") {
    const normalized = normalizeCustomerNoteLocales(locales, legacyEnglish);
    const requested = SUPPORTED_LOCALES.includes(String(locale || "").toLowerCase()) ? String(locale).toLowerCase() : "en";
    return normalized[requested] || normalized.en || "";
}

module.exports = { LIMITS, SUPPORTED_LOCALES, ProductKnowledgeError, hasKnowledgeContent, normalizeKnowledgeLocale, normalizeProductKnowledge, resolveLocalizedProductKnowledge, normalizeCustomerNote, normalizeCustomerNoteLocales, resolveLocalizedCustomerNote };
