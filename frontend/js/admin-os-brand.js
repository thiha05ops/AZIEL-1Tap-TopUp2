(function () {
    const BRAND_ICON = "/assets/brand/aziel-icon.svg";

    function renderWordmark() {
        return `
            <div class="aziel-os-wordmark" aria-hidden="true">
                <span>AZIEL</span><b>OS</b>
            </div>
            <div class="aziel-os-subtitle">Commerce Operating System</div>
        `;
    }

    function renderBrand(target) {
        const variant = target.dataset.azielOsBrand || "sidebar";
        const compact = variant === "compact";
        target.innerHTML = `
            <div class="aziel-os-brand-inner ${variant === "login" ? "is-login" : ""}">
                <img class="aziel-os-brand-mark ${compact ? "is-compact" : ""}" src="${BRAND_ICON}" alt="" aria-hidden="true" decoding="async">
                ${compact ? "" : renderWordmark()}
            </div>
        `;
        target.setAttribute("aria-label", "AZIEL OS");
        target.setAttribute("title", "AZIEL OS");
    }

    function init() {
        document.querySelectorAll("[data-aziel-os-brand]").forEach(renderBrand);
    }

    window.AZIEL_ADMIN_OS_BRAND = Object.freeze({ init });
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
