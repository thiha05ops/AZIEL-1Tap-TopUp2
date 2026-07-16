// frontend/js/site-settings.js

const SITE_API_BASE =
    location.port === "5500"
        ? `${location.protocol}//${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000`
        : "";

function siteApiUrl(path) {
    return `${SITE_API_BASE}${path}`;
}

document.addEventListener("DOMContentLoaded", () => {
    loadSiteSettings();
});

async function loadSiteSettings() {
    try {
        const res = await fetch(siteApiUrl("/api/settings"));
        const data = await res.json();

        if (!data.success) return;

        const s = data.settings || {};

        if (s.maintenanceMode) {
            document.body.innerHTML = `
                <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070716;color:white;text-align:center;padding:30px;">
                    <div>
                        <h1>AZIEL is under maintenance</h1>
                        <p>Please come back later.</p>
                    </div>
                </div>
            `;
            return;
        }

        if (s.announcement) {
            const bar = document.createElement("div");
            bar.className = "az-announcement-bar";
            bar.innerText = s.announcement;
            document.body.prepend(bar);
        }

        if (s.liveChatEnabled === false) {
            document.querySelector(".aziel-support-tab")?.remove();
            document.querySelector(".live-chat-panel")?.remove();
        }
    } catch (error) {
        console.log("Site settings error:", error);
    }
}

(function autoSystemTheme() {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
        const theme = media.matches ? "dark" : "light";

        document.documentElement.classList.remove(
            "light", "dark", "theme-light", "theme-dark"
        );
        document.body.classList.remove(
            "light", "dark", "theme-light", "theme-dark"
        );

        document.documentElement.classList.add(theme);
        document.body.classList.add(theme);

        document.documentElement.dataset.theme = theme;
        document.body.dataset.theme = theme;

        localStorage.setItem("theme", theme);
    }

    applyTheme();

    media.addEventListener("change", applyTheme);
})();