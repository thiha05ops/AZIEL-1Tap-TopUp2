(function () {
    const fallbackLogo = "/assets/logo/aziel-icon.webp";

    function markSvg(titleId, variant) {
        const compact = variant === "compact";
        return `
            <svg class="aziel-os-svg-mark ${compact ? "is-compact" : ""}" viewBox="0 0 128 128" role="img" aria-labelledby="${titleId}" focusable="false">
                <title id="${titleId}">AZIEL OS</title>
                <defs>
                    <linearGradient id="${titleId}-beam" x1="18" y1="116" x2="88" y2="8" gradientUnits="userSpaceOnUse">
                        <stop offset="0" stop-color="#5b21b6"/>
                        <stop offset=".48" stop-color="#a855f7"/>
                        <stop offset="1" stop-color="#d8b4fe"/>
                    </linearGradient>
                    <linearGradient id="${titleId}-edge" x1="72" y1="106" x2="112" y2="22" gradientUnits="userSpaceOnUse">
                        <stop offset="0" stop-color="#2e1065"/>
                        <stop offset=".55" stop-color="#7c3aed"/>
                        <stop offset="1" stop-color="#c084fc"/>
                    </linearGradient>
                    <linearGradient id="${titleId}-inner" x1="48" y1="104" x2="78" y2="52" gradientUnits="userSpaceOnUse">
                        <stop offset="0" stop-color="#7c3aed"/>
                        <stop offset=".7" stop-color="#c084fc"/>
                        <stop offset="1" stop-color="#f5d0fe"/>
                    </linearGradient>
                    <filter id="${titleId}-glow" x="-24%" y="-24%" width="148%" height="148%">
                        <feGaussianBlur stdDeviation="3.2" result="blur"/>
                        <feColorMatrix in="blur" type="matrix" values="0.45 0 0 0 0.38 0 0.12 0 0 0.10 0 0 0.95 0 0.90 0 0 0 .42 0" result="purpleGlow"/>
                        <feMerge>
                            <feMergeNode in="purpleGlow"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                <g filter="url(#${titleId}-glow)">
                    <path d="M21 111 L58 27 C63 16 76 12 86 19 C91 23 93 29 90 35 L55 93 C52 98 48 102 43 104 L24 113 C21 114 19 113 21 111 Z" fill="url(#${titleId}-beam)" stroke="rgba(245,208,254,.74)" stroke-width="1.6"/>
                    <path d="M80 23 L116 110 C117 113 115 115 112 115 L99 115 C92 115 88 111 85 105 L66 58 C64 53 64 48 67 43 L76 25 C77 22 79 21 80 23 Z" fill="url(#${titleId}-edge)" stroke="rgba(192,132,252,.52)" stroke-width="1.35"/>
                    <path d="M48 108 L69 60 C73 51 82 49 87 57 L97 76 C100 81 99 86 93 89 L51 111 C49 112 47 111 48 108 Z" fill="url(#${titleId}-inner)" stroke="rgba(245,208,254,.66)" stroke-width="1.45"/>
                    <path d="M55 101 L71 72 L84 92 Z" fill="rgba(4,7,20,.46)"/>
                </g>
            </svg>
        `;
    }

    function renderWordmark() {
        return `
            <div class="aziel-os-wordmark" aria-hidden="true">
                <span>AZIEL</span><b>OS</b>
            </div>
            <div class="aziel-os-subtitle">Commerce Operating System</div>
        `;
    }

    function renderBrand(target, index) {
        const variant = target.dataset.azielOsBrand || "sidebar";
        const titleId = `aziel-os-mark-${variant}-${index}`;
        const includeWordmark = variant !== "compact";
        target.innerHTML = `
            <div class="aziel-os-brand-inner ${variant === "login" ? "is-login" : ""}">
                ${markSvg(titleId, variant)}
                ${includeWordmark ? renderWordmark() : ""}
            </div>
            <img class="admin-logo-fallback" src="${fallbackLogo}" alt="AZIEL OS" loading="lazy" decoding="async">
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
