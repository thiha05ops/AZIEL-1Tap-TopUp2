(function () {
    function safeText(value = "") {
        return String(value || "").trim();
    }

    function isAndroidPackageName(value = "") {
        return /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(safeText(value).toLowerCase());
    }

    function isHttpsUrl(value = "") {
        try {
            const url = new URL(safeText(value));
            return url.protocol === "https:" && Boolean(url.hostname);
        } catch (error) {
            return false;
        }
    }

    function isSafeLaunchUrl(value = "") {
        const url = safeText(value);
        if (!url || /[\u0000-\u001f\u007f\s]/.test(url)) return false;
        if (/^(javascript|data|file|blob):/i.test(url)) return false;
        return /^(https:\/\/|intent:\/\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(url);
    }

    function parseLaunchUrl(value = "") {
        const url = safeText(value);
        const match = url.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
        if (!match) return null;
        return {
            scheme: match[1],
            body: match[2] || ""
        };
    }

    function buildAndroidIntentUrl(options = {}) {
        const packageName = safeText(options.androidPackageName).toLowerCase();
        const fallbackUrl = safeText(options.playStoreFallbackUrl || options.playStoreUrl);
        const launchUrl = safeText(options.androidLaunchUrl || options.androidAppLaunchUrl || "");

        if (!isAndroidPackageName(packageName) || !isHttpsUrl(fallbackUrl)) return "";

        if (/^intent:\/\//i.test(launchUrl) && isSafeLaunchUrl(launchUrl)) {
            return launchUrl.includes("S.browser_fallback_url=")
                ? launchUrl
                : launchUrl.replace(/;end$/i, `;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`);
        }

        const parsed = parseLaunchUrl(launchUrl);
        if (parsed && parsed.scheme.toLowerCase() !== "https") {
            return `intent://${parsed.body}#Intent;scheme=${encodeURIComponent(parsed.scheme)};package=${encodeURIComponent(packageName)};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
        }

        return `intent://open#Intent;package=${encodeURIComponent(packageName)};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
    }

    function resolvePlatform() {
        const nav = window.navigator || {};
        const userAgent = nav.userAgent || "";
        const platform = nav.platform || "";
        const isIOS = /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && nav.maxTouchPoints > 1);
        const isAndroid = /Android/i.test(userAgent);
        if (isIOS) return "ios";
        if (isAndroid) return "android";
        return "desktop";
    }

    window.AZIEL_ANDROID_APP_LAUNCH = Object.freeze({
        buildAndroidIntentUrl,
        isAndroidPackageName,
        isHttpsUrl,
        isSafeLaunchUrl,
        resolvePlatform
    });
})();
