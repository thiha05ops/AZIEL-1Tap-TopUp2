// frontend/js/theme.js
// AZIEL V2.5 Auto Theme Status Controller

(function () {
    const DARK_CLASS = "theme-dark";
    const LIGHT_CLASS = "theme-light";

    function getSystemTheme() {
        return window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
    }

    function applyTheme() {
        const resolved = getSystemTheme();

        document.body.classList.remove("dark", "light", DARK_CLASS, LIGHT_CLASS);
        document.documentElement.classList.remove("dark", "light", DARK_CLASS, LIGHT_CLASS);

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
            mode: "system",
            resolved
        };

        updateThemeStatus();
    }

    function updateThemeStatus() {
        const themeBtn = document.getElementById("themeToggleBtn");
        if (!themeBtn) return;

        const resolved =
            window.AZIEL?.theme?.resolved ||
            getSystemTheme();

        themeBtn.type = "button";
        themeBtn.disabled = true;
        themeBtn.classList.add("theme-status-btn");

        themeBtn.innerHTML =
            resolved === "light"
                ? `
                    <i class="fa-solid fa-sun"></i>
                    <span>Auto Light</span>
                  `
                : `
                    <i class="fa-solid fa-moon"></i>
                    <span>Auto Dark</span>
                  `;
    }

    function initTheme() {
        applyTheme();
        updateThemeStatus();

        window.addEventListener("aziel:headerLoaded", updateThemeStatus);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initTheme);
    } else {
        initTheme();
    }

    if (window.matchMedia) {
        const media = window.matchMedia("(prefers-color-scheme: light)");

        media.addEventListener?.("change", () => {
            applyTheme();
        });
    }

    window.AZIEL = window.AZIEL || {};

    window.AZIEL.applyTheme = applyTheme;

    window.AZIEL.getTheme = function () {
        return {
            mode: "system",
            resolved: getSystemTheme()
        };
    };
})();