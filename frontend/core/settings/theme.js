// frontend/core/settings/theme.js
// AZIEL public storefront system theme controller

(function () {
    const DARK_CLASS = "theme-dark";
    const LIGHT_CLASS = "theme-light";
    const LEGACY_CLASSES = [DARK_CLASS, LIGHT_CLASS, "dark", "light"];
    const LEGACY_STORAGE_KEYS = ["azielTheme", "theme"];

    function getSystemTheme() {
        return window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
    }

    function clearLegacyManualPreference() {
        try {
            LEGACY_STORAGE_KEYS.forEach(key => {
                const saved = window.localStorage?.getItem(key);
                if (saved === "light" || saved === "dark") {
                    window.localStorage.removeItem(key);
                }
            });
        } catch (error) {
            // Storage may be unavailable in private browsing or embedded contexts.
        }
    }

    function applyTheme() {
        const resolved = getSystemTheme();

        document.documentElement.classList.remove(...LEGACY_CLASSES);
        document.documentElement.classList.add(resolved === "dark" ? DARK_CLASS : LIGHT_CLASS);
        document.documentElement.setAttribute("data-theme", resolved);

        if (document.body) {
            document.body.classList.remove(...LEGACY_CLASSES);
            document.body.classList.add(resolved === "dark" ? DARK_CLASS : LIGHT_CLASS);
            document.body.setAttribute("data-theme", resolved);
        }

        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.setAttribute(
                "content",
                resolved === "light" ? "#f5f6fb" : "#070b1d"
            );
        }

        window.AZIEL = window.AZIEL || {};
        window.AZIEL.theme = {
            mode: "system",
            resolved
        };

        updateThemeStatus();
    }

    function updateThemeStatus() {
        const themeBtn = document.getElementById("themeToggleBtn");
        if (!themeBtn) return;

        const resolved = window.AZIEL?.theme?.resolved || getSystemTheme();

        themeBtn.type = "button";
        themeBtn.disabled = true;
        themeBtn.classList.add("theme-status-btn");
        themeBtn.innerHTML = resolved === "light"
            ? '<i class="fa-solid fa-sun"></i><span>Auto Light</span>'
            : '<i class="fa-solid fa-moon"></i><span>Auto Dark</span>';
    }

    function initTheme() {
        clearLegacyManualPreference();
        applyTheme();
        window.addEventListener("aziel:headerLoaded", updateThemeStatus);
    }

    if (document.readyState === "loading") {
        applyTheme();
        document.addEventListener("DOMContentLoaded", initTheme);
    } else {
        initTheme();
    }

    if (window.matchMedia) {
        const media = window.matchMedia("(prefers-color-scheme: dark)");

        media.addEventListener?.("change", () => {
            applyTheme();
        });
    }

    window.AZIEL = window.AZIEL || {};
    window.AZIEL.applyTheme = applyTheme;
    window.AZIEL.setTheme = applyTheme;
    window.AZIEL.toggleTheme = applyTheme;
    window.AZIEL.getTheme = function () {
        return {
            mode: "system",
            resolved: getSystemTheme()
        };
    };
})();
