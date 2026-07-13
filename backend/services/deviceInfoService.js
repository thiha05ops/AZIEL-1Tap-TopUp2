const DEVICE_LABELS = Object.freeze({
    mobile: "Mobile Device",
    tablet: "Tablet Device",
    desktop: "Desktop Device",
    unknown: "Unknown Device"
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

    return {
        platform: normalizePlatformValue(context.platform),
        userAgent: String(context.userAgent || ""),
        maxTouchPoints: Number(context.maxTouchPoints || 0)
    };
}

function hasAppleMobileClientEvidence(input = {}) {
    const context = getClientContext(input);
    const combined = `${context.platform} ${context.userAgent}`;

    if (/iphone|ipod/i.test(combined)) {
        return {
            platform: "iOS",
            deviceType: "mobile"
        };
    }

    if (/ipad/i.test(combined)) {
        return {
            platform: "iPadOS",
            deviceType: "tablet"
        };
    }

    if (
        /^macintel$/i.test(context.platform) &&
        context.maxTouchPoints > 1
    ) {
        return {
            platform: "iPadOS",
            deviceType: "tablet"
        };
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

function parsePlatform(userAgent = "", headers = {}, input = {}) {
    const ua = String(userAgent || "");
    const chPlatform = normalizeClientHint(headerValue(headers, "sec-ch-ua-platform"));
    const chMobile = normalizeClientHint(headerValue(headers, "sec-ch-ua-mobile"));
    const appleClientEvidence = hasAppleMobileClientEvidence(input);

    if (/iphone|ipod/i.test(ua)) return "iOS";
    if (/ipad/i.test(ua)) return "iPadOS";
    if (/android/i.test(ua)) return "Android";
    if (appleClientEvidence?.platform) return appleClientEvidence.platform;
    if (/windows/i.test(ua) || /^windows$/i.test(chPlatform)) return "Windows";
    if (/linux/i.test(ua) && !/android/i.test(ua)) return "Linux";

    if (/^android$/i.test(chPlatform)) return "Android";
    if (/^ios$/i.test(chPlatform)) return chMobile === "?1" ? "iOS" : "iPadOS";
    if (/^macos$/i.test(chPlatform)) return "macOS";
    if (/^linux$/i.test(chPlatform)) return "Linux";

    if (/macintosh|mac os x|mac_powerpc/i.test(ua)) {
        return "macOS";
    }

    return "Other";
}

function parseDeviceType(userAgent = "", headers = {}, platform = "", input = {}) {
    const ua = String(userAgent || "");
    const chMobile = normalizeClientHint(headerValue(headers, "sec-ch-ua-mobile"));
    const appleClientEvidence = hasAppleMobileClientEvidence(input);

    if (/ipad/i.test(ua)) return "tablet";
    if (/iphone|ipod/i.test(ua)) return "mobile";
    if (/android/i.test(ua)) {
        return /mobile/i.test(ua) ? "mobile" : "tablet";
    }

    if (chMobile === "?1") return "mobile";
    if (appleClientEvidence?.deviceType) return appleClientEvidence.deviceType;

    if (platform === "Windows" || platform === "macOS" || platform === "Linux") {
        return "desktop";
    }

    return "unknown";
}

function parseDeviceInfo(input = {}) {
    const userAgent = String(input.userAgent || "");
    const headers = input.headers || {};
    const browser = parseBrowser(userAgent);
    const platform = parsePlatform(userAgent, headers, input);
    const deviceType = parseDeviceType(userAgent, headers, platform, input);

    return {
        userAgent,
        deviceType,
        deviceLabel: DEVICE_LABELS[deviceType] || DEVICE_LABELS.unknown,
        deviceName: DEVICE_LABELS[deviceType] || DEVICE_LABELS.unknown,
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
    const deviceType = ["mobile", "tablet", "desktop", "unknown"].includes(session.deviceType)
        ? session.deviceType
        : inferLegacyDeviceType(session.deviceName);

    return {
        deviceType,
        deviceLabel: session.deviceLabel || session.deviceName || DEVICE_LABELS[deviceType] || DEVICE_LABELS.unknown,
        deviceName: session.deviceName || session.deviceLabel || DEVICE_LABELS[deviceType] || DEVICE_LABELS.unknown,
        browser: session.browser || "",
        platform: session.platform || ""
    };
}

function inferLegacyDeviceType(deviceName = "") {
    const value = String(deviceName || "").toLowerCase();
    if (value.includes("mobile")) return "mobile";
    if (value.includes("tablet")) return "tablet";
    if (value.includes("desktop")) return "desktop";
    return "unknown";
}

module.exports = {
    DEVICE_LABELS,
    parseBrowser,
    parseDeviceInfo,
    parseDeviceInfoFromRequest,
    parseDeviceType,
    parsePlatform,
    hasAppleMobileClientEvidence,
    normalizePersistedDeviceInfo
};
