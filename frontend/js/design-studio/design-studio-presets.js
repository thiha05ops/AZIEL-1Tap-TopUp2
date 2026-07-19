(function () {
    const presets = Object.freeze([
        {
            id: "home-hero",
            name: "Home Hero",
            width: 2560,
            height: 900,
            format: "image/webp",
            safeArea: 0.6,
            destination: "Home banners",
            warning: "Artwork must survive responsive desktop and mobile crops."
        },
        {
            id: "game-hero",
            name: "Game Hero",
            width: 2560,
            height: 900,
            format: "image/webp",
            safeArea: 0.65,
            destination: "Game page banners",
            warning: "Artwork must survive responsive desktop and mobile crops."
        },
        {
            id: "campaign-popup",
            name: "Campaign Popup",
            width: 1600,
            height: 1200,
            format: "image/webp",
            safeArea: 0.7,
            destination: "Campaign entry popup"
        },
        {
            id: "product-image",
            name: "Product Image",
            width: 1200,
            height: 1500,
            format: "image/webp",
            safeArea: 0.7,
            destination: "Product cards and catalog"
        },
        {
            id: "package-icon",
            name: "Package Icon",
            width: 512,
            height: 512,
            format: "image/png",
            safeArea: 0.8,
            destination: "Package icon",
            transparency: true
        },
        {
            id: "open-graph",
            name: "Open Graph",
            width: 1200,
            height: 630,
            format: "image/webp",
            safeArea: 0.7,
            destination: "Social preview"
        },
        {
            id: "custom",
            name: "Custom",
            width: 1200,
            height: 630,
            format: "image/webp",
            safeArea: 0.7,
            destination: "Custom export"
        }
    ]);

    const minCustomSize = 256;
    const maxCustomSize = 4096;

    function getPreset(id) {
        return presets.find(preset => preset.id === id) || presets[0];
    }

    function clampCustomSize(value, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(maxCustomSize, Math.max(minCustomSize, Math.round(number)));
    }

    function normalizePreset(id, custom = {}) {
        const preset = { ...getPreset(id) };
        if (preset.id !== "custom") return preset;

        preset.width = clampCustomSize(custom.width, preset.width);
        preset.height = clampCustomSize(custom.height, preset.height);
        preset.format = ["image/webp", "image/png", "image/jpeg"].includes(custom.format)
            ? custom.format
            : preset.format;
        return preset;
    }

    function aspectRatioLabel(preset) {
        const width = Number(preset?.width || 0);
        const height = Number(preset?.height || 0);
        if (!width || !height) return "-";

        function gcd(a, b) {
            return b ? gcd(b, a % b) : a;
        }

        const divisor = gcd(width, height);
        return `${width / divisor}:${height / divisor}`;
    }

    window.AZIEL_DESIGN_STUDIO_PRESETS = {
        all: presets,
        getPreset,
        normalizePreset,
        aspectRatioLabel,
        minCustomSize,
        maxCustomSize
    };
})();
