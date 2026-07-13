const assert = require("assert");
const fs = require("fs");
const path = require("path");

const Session = require("../models/Session");
const {
    parseDeviceInfo,
    parseDeviceInfoFromRequest,
    normalizePersistedDeviceInfo
} = require("../services/deviceInfoService");
const { getDeviceMetadata } = require("../services/authSessionService");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function expectDevice(label, input, expected) {
    const actual = parseDeviceInfo(typeof input === "string" ? { userAgent: input } : input);

    assert.strictEqual(actual.deviceType, expected.deviceType, `${label}: deviceType`);
    assert.strictEqual(actual.deviceLabel, expected.deviceLabel, `${label}: deviceLabel`);
    assert.strictEqual(actual.deviceName, expected.deviceLabel, `${label}: deviceName`);
    assert.strictEqual(actual.browser, expected.browser, `${label}: browser`);
    assert.strictEqual(actual.platform, expected.platform, `${label}: platform`);
}

function verifyUaFixtures() {
    expectDevice(
        "iPhone Safari",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        { deviceType: "ios", deviceLabel: "iOS Device", browser: "Safari", platform: "iOS" }
    );

    expectDevice(
        "iPhone Chrome",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
        { deviceType: "ios", deviceLabel: "iOS Device", browser: "Chrome", platform: "iOS" }
    );

    expectDevice(
        "iPad Safari",
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        { deviceType: "ios", deviceLabel: "iOS Device", browser: "Safari", platform: "iOS" }
    );

    expectDevice(
        "iPad desktop-style Apple context",
        {
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
            clientContext: {
                userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
                platform: "iPad"
            }
        },
        { deviceType: "ios", deviceLabel: "iOS Device", browser: "Safari", platform: "iOS" }
    );

    expectDevice(
        "Android Chrome phone",
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
        { deviceType: "android", deviceLabel: "Android Device", browser: "Chrome", platform: "Android" }
    );

    expectDevice(
        "Android Chrome tablet",
        "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        { deviceType: "android", deviceLabel: "Android Device", browser: "Chrome", platform: "Android" }
    );

    expectDevice(
        "Samsung Internet Android",
        "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
        { deviceType: "android", deviceLabel: "Android Device", browser: "Samsung Internet", platform: "Android" }
    );

    expectDevice(
        "Android Firefox",
        "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
        { deviceType: "android", deviceLabel: "Android Device", browser: "Firefox", platform: "Android" }
    );

    expectDevice(
        "Windows Chrome",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        { deviceType: "windows", deviceLabel: "Windows Device", browser: "Chrome", platform: "Windows" }
    );

    expectDevice(
        "Windows Edge",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
        { deviceType: "windows", deviceLabel: "Windows Device", browser: "Edge", platform: "Windows" }
    );

    expectDevice(
        "macOS Safari",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
        { deviceType: "macos", deviceLabel: "macOS Device", browser: "Safari", platform: "macOS" }
    );

    expectDevice(
        "macOS Chrome",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        { deviceType: "macos", deviceLabel: "macOS Device", browser: "Chrome", platform: "macOS" }
    );

    expectDevice(
        "Linux Firefox",
        "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
        { deviceType: "linux", deviceLabel: "Linux Device", browser: "Firefox", platform: "Linux" }
    );

    expectDevice(
        "unknown UA",
        "UnknownAgent/1.0",
        { deviceType: "unknown", deviceLabel: "Unknown Device", browser: "Other", platform: "Other" }
    );

    const hinted = parseDeviceInfoFromRequest({
        headers: {
            "user-agent": "Mozilla/5.0 AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
            "sec-ch-ua-platform": "\"iOS\""
        }
    });

    assert.strictEqual(hinted.deviceType, "ios", "Client hints should classify iOS");
    assert.strictEqual(hinted.deviceLabel, "iOS Device", "Client hints should use iOS label");
    assert.strictEqual(hinted.platform, "iOS", "Client hints platform should classify iOS");
}

function verifyRuntimeIntegration() {
    const realIphoneSafariUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const metadata = getDeviceMetadata({
        headers: {
            "user-agent": realIphoneSafariUa
        },
        socket: {
            remoteAddress: "127.0.0.1"
        }
    });

    assert.strictEqual(metadata.deviceType, "ios", "issue path should classify iPhone UA as iOS");
    assert.strictEqual(metadata.deviceLabel, "iOS Device", "issue path should classify iPhone UA label");
    assert.strictEqual(metadata.browser, "Safari", "issue path should classify Safari");
    assert.strictEqual(metadata.platform, "iOS", "issue path should classify iOS before Mac OS X");

    const desktopMasked = getDeviceMetadata({
        headers: {
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
        },
        body: {
            deviceContext: {
                userAgent: realIphoneSafariUa,
                platform: "iPhone"
            }
        },
        socket: {
            remoteAddress: "127.0.0.1"
        }
    });

    assert.strictEqual(desktopMasked.deviceType, "ios", "desktop-masked iPhone context should classify iOS");
    assert.strictEqual(desktopMasked.deviceLabel, "iOS Device", "desktop-masked iPhone context should classify iOS Device");
    assert.strictEqual(desktopMasked.browser, "Safari", "desktop-masked iPhone context should preserve Safari");
    assert.strictEqual(desktopMasked.platform, "iOS", "desktop-masked iPhone context should classify iOS");

    const missingUa = getDeviceMetadata({
        headers: {},
        socket: {
            remoteAddress: "127.0.0.1"
        }
    });

    assert.strictEqual(missingUa.deviceType, "unknown", "missing UA must not default to desktop");
    assert.strictEqual(missingUa.deviceLabel, "Unknown Device", "missing UA label must be neutral");
    assert.strictEqual(missingUa.platform, "Other", "missing UA platform must be neutral");
}

function verifySchemasAndProjection() {
    assert(Session.schema.path("deviceType"), "Session must persist deviceType");
    assert(Session.schema.path("deviceLabel"), "Session must persist deviceLabel");

    const enumValues = Session.schema.path("deviceType").enumValues;
    ["windows", "macos", "ios", "android", "linux", "unknown", "mobile", "tablet", "desktop"].forEach((value) => {
        assert(enumValues.includes(value), `Session schema must accept ${value}`);
    });

    const projected = normalizePersistedDeviceInfo({
        deviceType: "ios",
        deviceLabel: "iOS Device",
        deviceName: "iOS Device",
        browser: "Safari",
        platform: "iOS"
    });

    assert.deepStrictEqual(projected, {
        deviceType: "ios",
        deviceLabel: "iOS Device",
        deviceName: "iOS Device",
        browser: "Safari",
        platform: "iOS"
    });

    const legacyIpad = normalizePersistedDeviceInfo({
        deviceName: "Tablet Device",
        browser: "Safari",
        platform: "iPadOS"
    });

    assert.strictEqual(legacyIpad.deviceType, "ios");
    assert.strictEqual(legacyIpad.deviceLabel, "iOS Device");
    assert.strictEqual(legacyIpad.deviceName, "iOS Device");
    assert.strictEqual(legacyIpad.platform, "iOS");

    const legacyMac = normalizePersistedDeviceInfo({
        deviceName: "Desktop Device",
        browser: "Safari",
        platform: "macOS"
    });

    assert.strictEqual(legacyMac.deviceType, "macos");
    assert.strictEqual(legacyMac.deviceLabel, "macOS Device");
    assert.strictEqual(legacyMac.deviceName, "macOS Device");
    assert.strictEqual(legacyMac.platform, "macOS");

    const legacyFormFactorOnly = normalizePersistedDeviceInfo({
        deviceType: "desktop",
        deviceName: "Desktop Device",
        platform: ""
    });

    assert.strictEqual(legacyFormFactorOnly.deviceType, "unknown");
    assert.strictEqual(legacyFormFactorOnly.deviceLabel, "Unknown Device");
    assert.strictEqual(legacyFormFactorOnly.deviceName, "Unknown Device");
    assert.strictEqual(legacyFormFactorOnly.browser, "Other");
    assert.strictEqual(legacyFormFactorOnly.platform, "Other");
}

function verifySourceOwnership() {
    const authService = read("backend/services/authSessionService.js");
    const deviceInfo = read("backend/services/deviceInfoService.js");
    const securityRoute = read("backend/routes/security.js");
    const socialRoute = read("backend/routes/socialAuth.js");
    const authRoute = read("backend/routes/auth.js");
    const account = read("frontend/js/account.js");
    const login = read("frontend/js/login.js");

    assert(authService.includes("parseDeviceInfoFromRequest"), "authSessionService must own canonical parser integration");
    assert(authService.includes("DEVICE_INFO_DEBUG"), "authSessionService should include gated diagnostics");
    assert(authService.includes("deviceType: metadata.deviceType"), "issueUserSession must persist deviceType metadata");
    assert(authService.includes("browser: metadata.browser"), "security event metadata should use normalized browser");
    assert(!authService.includes("maxTouchPoints"), "authSessionService must not depend on touch points");
    assert(!deviceInfo.includes("maxTouchPoints"), "deviceInfoService must not depend on touch points");
    assert(!login.includes("maxTouchPoints"), "login should not send touch points");
    assert(securityRoute.includes("normalizePersistedDeviceInfo"), "security sessions API must project normalized metadata");
    assert(securityRoute.includes("deviceType: device.deviceType"), "security sessions API must expose deviceType");
    assert(!securityRoute.includes("userAgent:"), "security sessions API must not expose raw userAgent");
    assert(socialRoute.includes("issueUserSession(req.user, req"), "Google login must use canonical session issuer");
    assert(authRoute.includes("issueUserSession(user, req"), "local/2FA login must use canonical session issuer");
    assert(login.includes("getLoginDeviceContext()"), "login should pass advisory device context");
    assert(account.includes("session.deviceLabel || session.deviceName"), "frontend must render backend device label");
}

function main() {
    verifyUaFixtures();
    verifyRuntimeIntegration();
    verifySchemasAndProjection();
    verifySourceOwnership();
    console.log("Device detection verification passed.");
}

main();
