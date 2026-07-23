const { ConfigurationAdapter } = require("./configurationAdapter");
const { cloneSnapshot, SUPPORTED_REGIONS } = require("../configurationDefinition");
const {
    SUPPORTED_PLACEMENTS,
    listAdminPlacements,
    resolveHomePlacements
} = require("../../services/sitePlacementService");

const FALLBACK_SOURCE = "frontend/home.html static sections + home-placement-runtime fallback";

function createHomePlacementAdapter() {
    return new HomePlacementAdapter();
}

class HomePlacementAdapter extends ConfigurationAdapter {
    constructor() {
        super({
            id: "home-placement-adapter",
            name: "Home Placement Adapter",
            sourceType: "DATABASE",
            capabilities: ["READ", "VALIDATE", "PREVIEW"]
        });
    }

    async read(context = {}) {
        const region = SUPPORTED_REGIONS.includes(context.region) ? context.region : "MM";
        const configured = await listAdminPlacements();
        const effective = await resolveHomePlacements({ region });
        const configuredValue = projectConfiguredValue(configured);
        const fallbackValue = projectFallbackValue(configured);
        const effectiveValue = projectEffectiveValue(effective);
        const validation = this.validate(configuredValue);
        const fallbackActive = fallbackValue.placements.some(placement => placement.fallbackState === "ACTIVE");

        return {
            configuredValue,
            fallbackValue,
            effectiveValue,
            source: {
                type: "DATABASE",
                reference: "SitePlacement"
            },
            readiness: readinessFromState({ validation, fallbackActive, configuredValue, effectiveValue }),
            validation,
            diagnostics: buildDiagnostics({ validation, fallbackActive, configuredValue, effectiveValue })
        };
    }

    validate(value = {}) {
        const errors = [];
        const warnings = [];
        const placements = Array.isArray(value.placements) ? value.placements : [];
        const seen = new Set();
        const supportedCodes = Object.keys(SUPPORTED_PLACEMENTS);

        placements.forEach(placement => {
            if (!supportedCodes.includes(placement.placementCode)) {
                errors.push({ code: "INVALID_PLACEMENT_KEY", message: "Placement key is unsupported." });
            }
            if (seen.has(placement.placementCode)) {
                errors.push({ code: "DUPLICATE_PLACEMENT_KEY", message: "Placement key is duplicated." });
            }
            seen.add(placement.placementCode);
            if (!Number.isFinite(Number(placement.order)) || Number(placement.order) < 1) {
                errors.push({ code: "INVALID_ORDER", message: "Placement order must be a positive number." });
            }
            const itemCodes = new Set();
            (placement.items || []).forEach(item => {
                const code = item.productCode || item.promoCode || "";
                if (!code) errors.push({ code: "ITEM_REFERENCE_REQUIRED", message: "Placement item reference is required." });
                if (itemCodes.has(code)) errors.push({ code: "DUPLICATE_ITEM_REFERENCE", message: "Placement item reference is duplicated." });
                itemCodes.add(code);
            });
            if (!placement.managed) warnings.push({ code: "FALLBACK_ACTIVE", message: `${placement.placementCode} is using fallback behavior.` });
        });

        supportedCodes.forEach(placementCode => {
            if (!seen.has(placementCode)) warnings.push({ code: "REGION_VALUE_MISSING", message: `${placementCode} has no configured record.` });
        });

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            normalizedValue: cloneSnapshot(value)
        };
    }

    health() {
        return {
            adapterId: this.id,
            status: "READY",
            capabilities: this.capabilities,
            sourceType: this.sourceType
        };
    }
}

function projectConfiguredValue(placements = []) {
    return {
        valueType: "configured",
        placements: placements.map((placement, index) => ({
            placementId: placement.placementCode,
            placementCode: placement.placementCode,
            displayName: placement.label,
            region: "ALL",
            enabled: placement.managed !== false,
            managed: Boolean(placement.managed),
            order: index + 1,
            sourceReference: "SitePlacement",
            assignedContentReference: (placement.items || []).map(item => item.productCode || item.promoCode).filter(Boolean),
            items: (placement.items || []).map(item => ({
                itemType: item.itemType,
                productCode: item.productCode || "",
                promoCode: item.promoCode || "",
                sortOrder: Number(item.sortOrder || 0)
            })),
            validationState: "OBSERVED",
            lastUpdated: placement.updatedAt || null,
            metadata: {
                itemType: placement.itemType,
                itemCount: placement.items?.length || 0
            }
        }))
    };
}

function projectFallbackValue(placements = []) {
    return {
        valueType: "fallback",
        fallbackSource: FALLBACK_SOURCE,
        placements: placements.map((placement, index) => ({
            placementId: placement.placementCode,
            placementCode: placement.placementCode,
            displayName: placement.label,
            region: "ALL",
            enabled: !placement.managed,
            order: index + 1,
            fallbackState: placement.managed ? "INACTIVE" : "ACTIVE",
            fallbackSource: FALLBACK_SOURCE,
            metadata: {
                reason: placement.managed ? "Managed configuration exists." : "Managed configuration is absent or disabled."
            }
        }))
    };
}

function projectEffectiveValue(result = {}) {
    const placements = result.placements || {};
    return {
        valueType: "effective",
        region: result.region || "MM",
        placements: Object.keys(SUPPORTED_PLACEMENTS).map((placementCode, index) => {
            const placement = placements[placementCode] || {};
            const managed = placement.managed === true;
            return {
                placementId: placementCode,
                placementCode,
                displayName: placement.label || SUPPORTED_PLACEMENTS[placementCode].label,
                region: result.region || "MM",
                enabled: managed ? (placement.items || []).length > 0 : true,
                managed,
                order: index + 1,
                effectiveState: managed ? "MANAGED" : "FALLBACK",
                itemCount: placement.items?.length || 0,
                items: (placement.items || []).map(item => ({
                    itemType: item.itemType,
                    productCode: item.productCode || "",
                    promoCode: item.promoCode || "",
                    name: item.name || "",
                    supportedRegions: item.supportedRegions || item.regions || []
                })),
                metadata: {
                    itemType: placement.itemType || SUPPORTED_PLACEMENTS[placementCode].itemType
                }
            };
        })
    };
}

function readinessFromState({ validation, fallbackActive, effectiveValue }) {
    if (!validation?.valid) {
        return { state: "BLOCKED", reason: "Home placement validation failed." };
    }
    if (!effectiveValue?.placements?.length) {
        return { state: "BLOCKED", reason: "Effective home placement value could not be resolved." };
    }
    if (fallbackActive) {
        return { state: "PARTIAL", reason: "At least one Home placement still uses fallback behavior." };
    }
    return { state: "READY", reason: "Home placements resolve from configured SitePlacement records." };
}

function buildDiagnostics({ validation, fallbackActive, configuredValue, effectiveValue }) {
    return {
        warnings: validation?.warnings || [],
        errors: validation?.errors || [],
        fallbackActive,
        configuredPlacementCount: configuredValue?.placements?.length || 0,
        effectivePlacementCount: effectiveValue?.placements?.length || 0
    };
}

module.exports = {
    HomePlacementAdapter,
    createHomePlacementAdapter
};
