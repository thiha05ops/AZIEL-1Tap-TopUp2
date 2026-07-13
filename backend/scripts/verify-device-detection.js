const assert = require("assert");
const fs = require("fs");
const path = require("path");

const Session = require("../models/Session");
const {
    parseDeviceInfo,
    parseDeviceInfoFromRequest,
    normalizePersistedDeviceInfo
} = require("../services/deviceInfoService");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function expectDevice(label, userAgent, expected, headers = {}) {
    const actual = parseDeviceInfo({ userAgent, headers });

    assert.strictEqual(actual.deviceType, expected.deviceType, `${label}: deviceType`);
    assert.strictEqual(actual.deviceLabel, expected.deviceLabel, `${label}: deviceLabel`);
    assert.strictEqual(actual.browser, expected.browser, `${label}: browser`);
    assert.strictEqual(actual.platform, expected.platform, `${label}: platform`);
}

function verifyUaFixtures() {
    expectDevice(
        "iPhone Safari",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        { deviceType: "mobile", deviceLabel: "Mobile Device", browser: "Safari", platform: "iOS" }
    );

    expectDevice(
        "iPhone Chrome",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
        { deviceType: "mobile", deviceLabel: "Mobile Device", browser: "Chrome", platform: "iOS" }
    );

    expectDevice(
        "iPad Safari",
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        { deviceType: "tablet", deviceLabel: "Tablet Device", browser: "Safari", platform: "iPadOS" }
    );

    expectDevice(
        "Android Chrome",
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
        { deviceType: "mobile", deviceLabel: "Mobile Device", browser: "Chrome", platform: "Android" }
    );

    expectDevice(
        "Samsung Internet Android",
        "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
        { deviceType: "mobile", deviceLabel: "Mobile Device", browser: "Samsung Internet", platform: "Android" }
    );

    expectDevice(
        "macOS Safari",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
        { deviceType: "desktop", deviceLabel: "Desktop Device", browser: "Safari", platform: "macOS" }
    );

    expectDevice(
        "macOS Chrome",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        { deviceType: "desktop", deviceLabel: "Desktop Device", browser: "Chrome", platform: "macOS" }
    );

    expectDevice(
        "Windows Chrome",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        { deviceType: "desktop", deviceLabel: "Desktop Device", browser: "Chrome", platform: "Windows" }
    );

    expectDevice(
        "Windows Edge",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
        { deviceType: "desktop", deviceLabel: "Desktop Device", browser: "Edge", platform: "Windows" }
    );

    expectDevice(
        "Firefox Linux",
        "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
        { deviceType: "desktop", deviceLabel: "Desktop Device", browser: "Firefox", platform: "Linux" }
    );

    expectDevice(
        "unknown UA",
        "UnknownAgent/1.0",
        { deviceType: "unknown", deviceLabel: "Unknown Device", browser: "Other", platform: "Other" }
    );

    const hinted = parseDeviceInfoFromRequest({
        headers: {
            "user-agent": "Mozilla/5.0 AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
            "sec-ch-ua-mobile": "?1",
            "sec-ch-ua-platform": "\"iOS\""
        }
    });

    assert.strictEqual(hinted.deviceType, "mobile", "Client hints mobile should classify mobile");
    assert.strictEqual(hinted.platform, "iOS", "Client hints platform should classify iOS");
}

function verifySchemasAndProjection() {
    assert(Session.schema.path("deviceType"), "Session must persist deviceType");
    assert(Session.schema.path("deviceLabel"), "Session must persist deviceLabel");

    const projected = normalizePersistedDeviceInfo({
        deviceType: "mobile",
        deviceLabel: "Mobile Device",
        deviceName: "Mobile Device",
        browser: "Safari",
        platform: "iOS"
    });

    assert.deepStrictEqual(projected, {
        deviceType: "mobile",
        deviceLabel: "Mobile Device",
        deviceName: "Mobile Device",
        browser: "Safari",
        platform: "iOS"
    });

    const legacy = normalizePersistedDeviceInfo({
        deviceName: "Desktop Device",
        browser: "Safari",
        platform: "macOS"
    });

    assert.strictEqual(legacy.deviceType, "desktop");
    assert.strictEqual(legacy.deviceLabel, "Desktop Device");
}

function verifySourceOwnership() {
    const authService = read("backend/services/authSessionService.js");
    const securityRoute = read("backend/routes/security.js");
    const socialRoute = read("backend/routes/socialAuth.js");
    const authRoute = read("backend/routes/auth.js");
    const account = read("frontend/js/account.js");

    assert(authService.includes("parseDeviceInfoFromRequest"), "authSessionService must own canonical parser integration");
    assert(authService.includes("deviceType: metadata.deviceType"), "issueUserSession must persist deviceType metadata");
    assert(authService.includes("browser: metadata.browser"), "security event metadata should use normalized browser");
    assert(securityRoute.includes("normalizePersistedDeviceInfo"), "security sessions API must project normalized metadata");
    assert(securityRoute.includes("deviceType: device.deviceType"), "security sessions API must expose deviceType");
    assert(!securityRoute.includes("userAgent:"), "security sessions API must not expose raw userAgent");
    assert(socialRoute.includes("issueUserSession(req.user, req"), "Google login must use canonical session issuer");
    assert(authRoute.includes("issueUserSession(user, req"), "local/2FA login must use canonical session issuer");
    assert(account.includes("session.deviceLabel || session.deviceName"), "frontend must render backend device label");
}

function main() {
    verifyUaFixtures();
    verifySchemasAndProjection();
    verifySourceOwnership();
    console.log("Device detection verification passed.");
}

main();
