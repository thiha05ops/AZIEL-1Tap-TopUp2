const DEVICE_LABELS = Object.freeze({
    windows: "Windows Device",
    macos: "macOS Device",
    ios: "iOS Device",
    android: "Android Device",
    linux: "Linux Device",
    unknown: "Unknown Device"
});

const PLATFORM_DISPLAY = Object.freeze({
    windows: "Windows",
    macos: "macOS",
    ios: "iOS",
    android: "Android",
    linux: "Linux",
    unknown: "Other"
});

function headerValue(headers = {}, key) {
    const direct = headers[key] || headers[key.toLowerCase()];
    if (Array.isArray(direct)) return direct.join(", ");
    return String(direct || "");
}

function normalizeClientHint(value) {
    return String(value || "")
        .replaceAll("\"", "")
        .trim();
}

function normalizePlatformValue(value) {
    return String(value || "")
        .replaceAll("\"", "")
        .trim();
}

function getClientContext(input = {}) {
    const context = input.clientContext && typeof input.clientContext === "object"
        ? input.clientContext
        : {};
    const userAgentData = context.userAgentData && typeof context.userAgentData === "object"
        ? context.userAgentData
        : {};

    return {
        platform: normalizePlatformValue(context.platform),
        userAgent: String(context.userAgent || ""),
        userAgentData: {
            mobile: Boolean(userAgentData.mobile),
            platform: normalizePlatformValue(userAgentData.platform),
            brands: Array.isArray(userAgentData.brands) ? userAgentData.brands : []
        }
    };
}

function getAppleFamilyFromClientContext(input = {}) {
    const context = getClientContext(input);
    const combined = `${context.platform} ${context.userAgent} ${context.userAgentData.platform}`;

    if (/iphone|ipod|ipad|\bios\b/i.test(combined)) {
        return "ios";
    }

    return null;
}

function parseBrowser(userAgent = "") {
    const ua = String(userAgent || "");

    if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
    if (/EdgiOS|EdgA|Edg\//i.test(ua)) return "Edge";
    if (/CriOS/i.test(ua)) return "Chrome";
    if (/FxiOS/i.test(ua)) return "Firefox";
    if (/Chrome|Chromium|CriOS/i.test(ua) && !/Edg\//i.test(ua)) return "Chrome";
    if (/Firefox|FxiOS/i.test(ua)) return "Firefox";
    if (/Version\/[\d.]+.*Safari/i.test(ua) || (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg/i.test(ua))) {
        return "Safari";
    }

    return "Other";
}

function parsePlatformFamily(userAgent = "", headers = {}, input = {}) {
    const ua = String(userAgent || "");
    const chPlatform = normalizeClientHint(headerValue(headers, "sec-ch-ua-platform"));
    const context = getClientContext(input);
    const appleFamily = getAppleFamilyFromClientContext(input);
    const clientPlatform = context.userAgentData.platform || context.platform;

    if (/iphone|ipod|ipad/i.test(ua)) return "ios";
    if (/android/i.test(ua)) return "android";
    if (appleFamily) return appleFamily;
    if (/windows/i.test(ua) || /^windows$/i.test(chPlatform) || /^windows$/i.test(clientPlatform)) return "windows";
    if (/linux/i.test(ua) && !/android/i.test(ua)) return "linux";

    if (/^android$/i.test(chPlatform) || /^android$/i.test(clientPlatform)) return "android";
    if (/^ios$/i.test(chPlatform) || /^ios$/i.test(clientPlatform)) return "ios";
    if (/^macos$/i.test(chPlatform) || /^macos$/i.test(clientPlatform)) return "macos";
    if (/^linux$/i.test(chPlatform) || /^linux$/i.test(clientPlatform)) return "linux";

    if (/macintosh|mac os x|mac_powerpc/i.test(ua)) {
        return "macos";
    }

    return "unknown";
}

function parsePlatform(userAgent = "", headers = {}, input = {}) {
    return PLATFORM_DISPLAY[parsePlatformFamily(userAgent, headers, input)] || PLATFORM_DISPLAY.unknown;
}

function parseDeviceType(userAgent = "", headers = {}, platform = "", input = {}) {
    const family = parsePlatformFamily(userAgent, headers, input);
    return DEVICE_LABELS[family] ? family : "unknown";
}

function parseDeviceInfo(input = {}) {
    const userAgent = String(input.userAgent || "");
    const headers = input.headers || {};
    const browser = parseBrowser(userAgent);
    const platformFamily = parsePlatformFamily(userAgent, headers, input);
    const platform = PLATFORM_DISPLAY[platformFamily] || PLATFORM_DISPLAY.unknown;
    const deviceType = DEVICE_LABELS[platformFamily] ? platformFamily : "unknown";
    const deviceLabel = DEVICE_LABELS[deviceType] || DEVICE_LABELS.unknown;

    return {
        userAgent,
        deviceType,
        deviceLabel,
        deviceName: deviceLabel,
        browser,
        platform
    };
}

function parseDeviceInfoFromRequest(req) {
    return parseDeviceInfo({
        userAgent: headerValue(req?.headers || {}, "user-agent"),
        headers: req?.headers || {},
        clientContext: req?.body?.deviceContext
    });
}

function normalizePersistedDeviceInfo(session = {}) {
    const platformFamily = normalizePlatformFamily(session.platform) ||
        normalizeDeviceTypeFamily(session.deviceType);
    const deviceType = platformFamily || "unknown";
    const deviceLabel = DEVICE_LABELS[deviceType] || DEVICE_LABELS.unknown;
    const platform = PLATFORM_DISPLAY[deviceType] || PLATFORM_DISPLAY.unknown;

    return {
        deviceType,
        deviceLabel,
        deviceName: deviceLabel,
        browser: session.browser || "Other",
        platform
    };
}

function normalizePlatformFamily(value = "") {
    const normalized = String(value || "").trim().toLowerCase();

    if (normalized === "windows") return "windows";
    if (normalized === "macos" || normalized === "mac os" || normalized === "mac") return "macos";
    if (normalized === "ios" || normalized === "ipados") return "ios";
    if (normalized === "android") return "android";
    if (normalized === "linux") return "linux";

    return "";
}

function normalizeDeviceTypeFamily(value = "") {
    const normalized = String(value || "").trim().toLowerCase();
    return DEVICE_LABELS[normalized] ? normalized : "";
}

module.exports = {
    DEVICE_LABELS,
    PLATFORM_DISPLAY,
    parseBrowser,
    parseDeviceInfo,
    parseDeviceInfoFromRequest,
    parseDeviceType,
    parsePlatformFamily,
    parsePlatform,
    getAppleFamilyFromClientContext,
    normalizePersistedDeviceInfo
};
