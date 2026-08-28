(function (root, factory) {
    const authority = factory();
    if (typeof module === "object" && module.exports) module.exports = authority;
    if (root) root.AZIEL_DAILY_PRICING_SELECTION = authority;
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    function text(value) {
        return String(value || "").trim();
    }

    function rowId(row = {}) {
        const productCode = text(row.productCode).toUpperCase();
        const packageCode = text(row.packageCode).toUpperCase();
        return productCode && packageCode ? `${productCode}:${packageCode}` : "";
    }

    function classify({ row = {}, visible = true, preview, previewPending = false, status = "", expectedRegions = [] } = {}) {
        if (visible !== true) return { selectable: false, code: "NOT_VISIBLE", missingRegions: [] };
        if (!rowId(row)) return { selectable: false, code: "ROW_IDENTITY_MISSING", missingRegions: [] };
        if (previewPending === true) return { selectable: false, code: "PREVIEW_PENDING", missingRegions: [] };
        if (preview == null) {
            return {
                selectable: false,
                code: "PREVIEW_IDENTITY_MISMATCH",
                missingRegions: []
            };
        }
        if (typeof preview !== "object" || Array.isArray(preview)) return { selectable: false, code: "PREVIEW_INVALID", missingRegions: [] };
        const returnedRegions = new Set((Array.isArray(preview.regions) ? preview.regions : []).map(item => text(item?.region).toUpperCase()).filter(Boolean));
        const missingRegions = expectedRegions.map(region => text(region).toUpperCase()).filter(Boolean).filter(region => !returnedRegions.has(region));
        if (missingRegions.length) return { selectable: false, code: "PREVIEW_REGION_MISMATCH", missingRegions };
        if (preview.publishEligible !== true) return { selectable: false, code: "PREVIEW_NOT_READY", missingRegions: [] };
        if (!["READY", "WARNING"].includes(text(status).toUpperCase())) return { selectable: false, code: "STATUS_NOT_READY", missingRegions: [] };
        return { selectable: true, code: "READY", missingRegions: [] };
    }

    function isSelectable(input = {}) {
        return classify(input).selectable;
    }

    function createSelectionState() {
        const selected = new Set();
        return Object.freeze({
            selected,
            set(row, checked, selectable) {
                const id = rowId(row);
                if (!id || selectable !== true) {
                    selected.delete(id);
                    return false;
                }
                if (checked) selected.add(id);
                else selected.delete(id);
                return selected.has(id);
            },
            clear() {
                selected.clear();
            },
            reconcile(rows = []) {
                const allowed = new Set(rows.filter(item => item.selectable === true).map(item => rowId(item.row)).filter(Boolean));
                [...selected].forEach(id => {
                    if (!allowed.has(id)) selected.delete(id);
                });
                return selected.size;
            },
            payload(rows = []) {
                return rows.filter(row => selected.has(rowId(row)));
            }
        });
    }

    return Object.freeze({ rowId, classify, isSelectable, createSelectionState });
});
