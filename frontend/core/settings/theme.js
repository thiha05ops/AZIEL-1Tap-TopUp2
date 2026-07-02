// frontend/js/theme.js
// AZIEL V2.5 Shared Theme Controller

(function () {
    const STORAGE_KEY = "azielTheme";
    const DARK_CLASS = "theme-dark";
    const LIGHT_CLASS = "theme-light";

    function getSystemTheme() {
        return window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
    }

    function getSavedTheme() {
        const saved = localStorage.getItem(STORAGE_KEY);

        if (saved === "light" || saved === "dark" || saved === "system") {
            return saved;
        }

        return "system";
    }

    function resolveTheme(mode) {
        if (mode === "system") {
            return getSystemTheme();
        }

        return mode === "light" ? "light" : "dark";
    }

    function applyTheme(mode) {
        const resolved = resolveTheme(mode);

        document.body.classList.remove(DARK_CLASS, LIGHT_CLASS);
        document.documentElement.classList.remove(DARK_CLASS, LIGHT_CLASS);

        document.body.classList.add(
            resolved === "light" ? LIGHT_CLASS : DARK_CLASS
        );

        document.documentElement.classList.add(
            resolved === "light" ? LIGHT_CLASS : DARK_CLASS
        );

        document.documentElement.setAttribute("data-theme", resolved);
        document.body.setAttribute("data-theme", resolved);

        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.setAttribute(
                "content",
                resolved === "light" ? "#f5f6fb" : "#070b1d"
            );
        }

        window.AZIEL = window.AZIEL || {};
        window.AZIEL.theme = {
            mode,
            resolved
        };
    }

    function setTheme(mode) {
        if (!["light", "dark", "system"].includes(mode)) return;

        localStorage.setItem(STORAGE_KEY, mode);
        applyTheme(mode);
    }

    function toggleTheme() {
        const current = window.AZIEL?.theme?.resolved || resolveTheme(getSavedTheme());
        setTheme(current === "dark" ? "light" : "dark");
    }

    const savedMode = getSavedTheme();

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            applyTheme(savedMode);
        });
    } else {
        applyTheme(savedMode);
    }

    if (window.matchMedia) {
        const media = window.matchMedia("(prefers-color-scheme: light)");

        media.addEventListener?.("change", () => {
            const saved = getSavedTheme();

            if (saved === "system") {
                applyTheme("system");
            }
        });
    }

    window.AZIEL = window.AZIEL || {};
    window.AZIEL.setTheme = setTheme;
    window.AZIEL.toggleTheme = toggleTheme;
    window.AZIEL.getTheme = function () {
        return {
            mode: getSavedTheme(),
            resolved: resolveTheme(getSavedTheme())
        };
    };
})();