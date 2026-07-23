const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const {
    buildWebsiteRuntimeProjection,
    isAllowedPreviewRoute,
    normalizePreviewRegion,
    normalizePreviewRoute
} = require("../services/websiteRuntimeService");

router.get("/admin/website-runtime", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const projection = await buildWebsiteRuntimeProjection({ baseUrl });
        res.set("Cache-Control", "no-store");
        return res.json(projection);
    } catch (error) {
        console.log("Website runtime observation error:", error?.code || error?.name || "WEBSITE_RUNTIME_FAILED");
        return res.status(200).json({
            success: true,
            runtime: {
                id: "website-runtime",
                name: "AZIEL Public Website Runtime",
                version: "0.1.0",
                environment: process.env.NODE_ENV || "development",
                status: "DEGRADED",
                capabilities: ["inventory", "region-awareness", "public-preview", "ownership-diagnostics", "configuration-readiness"],
                metadata: {
                    publicBaseUrl: `${req.protocol}://${req.get("host")}`,
                    supportedRegions: ["MM", "TH"],
                    observedRoutes: [],
                    lastObservedAt: new Date().toISOString()
                }
            },
            summary: {
                total: 0,
                fullyManagedCount: 0,
                partiallyManagedCount: 0,
                hardcodedCount: 0,
                unknownCount: 0,
                degradedCount: 1
            },
            regions: [
                { code: "MM", label: "Myanmar", currency: "MMK", status: "OBSERVED" },
                { code: "TH", label: "Thailand", currency: "THB", status: "OBSERVED" }
            ],
            publicRoutes: [],
            inventory: [],
            ownershipSummary: [],
            diagnostics: {
                runtimeStatus: "DEGRADED",
                observationDurationMs: 0,
                sourceFailures: [{ source: "website-runtime", code: "OBSERVATION_FAILED", message: "Observation failed safely." }],
                hardcodedItemCount: 0,
                unknownItemCount: 0,
                missingPublicRoutes: [],
                missingAssets: [],
                previewAvailability: "SAME_ORIGIN_ROUTES_ONLY",
                regionReadiness: "MM_TH_OBSERVED",
                localizationReadiness: "STATIC_DICTIONARIES_OBSERVED",
                apiReachabilityStatus: "DEGRADED",
                lastSuccessfulObservation: null
            }
        });
    }
});

router.get("/admin/website-runtime/preview-url", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), (req, res) => {
    const route = normalizePreviewRoute(req.query.route);
    const region = normalizePreviewRegion(req.query.region);

    if (!route || !isAllowedPreviewRoute(route)) {
        return res.status(400).json({
            success: false,
            code: "WEBSITE_PREVIEW_ROUTE_UNSUPPORTED",
            message: "Preview route is not supported."
        });
    }

    res.set("Cache-Control", "no-store");
    return res.json({
        success: true,
        route,
        region,
        previewUrl: `${route}?azPreviewRegion=${encodeURIComponent(region)}`
    });
});

module.exports = router;
