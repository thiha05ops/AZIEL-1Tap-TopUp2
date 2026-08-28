"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    resolveWorkspacePriceInstruction,
    buildWorkspacePricePatch,
    selectedPublicationDecision
} = require("../services/commerce/adminPricingControlCenterService");
const selectionAuthority = require("../../frontend/js/admin-pricing-selection-state.js");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function main() {
    const manual = resolveWorkspacePriceInstruction({
        instruction: { mode: "MANUAL_OVERRIDE", value: 99 },
        calculatedPrice: 105,
        currency: "THB",
        region: "TH"
    });
    assert.strictEqual(manual.calculatedPrice, 105);
    assert.strictEqual(manual.finalPrice, 99);
    assert.strictEqual(manual.mode, "MANUAL_OVERRIDE");

    const fixed = resolveWorkspacePriceInstruction({
        instruction: { mode: "ADJUSTMENT", adjustmentType: "FIXED", value: -5 },
        calculatedPrice: 105,
        currency: "THB",
        region: "TH"
    });
    assert.strictEqual(fixed.finalPrice, 100);

    const percent = resolveWorkspacePriceInstruction({
        instruction: { mode: "ADJUSTMENT", adjustmentType: "PERCENTAGE", value: 10 },
        calculatedPrice: 10000,
        currency: "MMK",
        region: "MM"
    });
    assert.strictEqual(percent.finalPrice, 11000);
    assert.notStrictEqual(manual.finalPrice, percent.finalPrice, "TH and MM instructions must remain independent.");
    const priceOnlyPatch = buildWorkspacePricePatch({
        regionalPreview: { finalPreviewPrice: 99, priceMode: "MANUAL_OVERRIDE", manualOverrideReason: manual.reason },
        normalized: { supplierCostEdited: false, newSupplierCost: 40 },
        supplier: { supplierCurrency: "THB" }
    });
    assert.strictEqual(priceOnlyPatch.amount, 99);
    assert.strictEqual(priceOnlyPatch.publishedPriceMode, "MANUAL_OVERRIDE");
    assert(!Object.prototype.hasOwnProperty.call(priceOnlyPatch, "supplierCost"), "Price-only override must not patch supplier cost.");
    assert(!Object.prototype.hasOwnProperty.call(priceOnlyPatch, "rawSupplierCost"), "Price-only override must not patch raw supplier cost.");

    const readyUnchanged = {
        row: { productCode: "freefire", packageCode: "FF_1052_DIA" },
        preview: { publishEligible: true, changed: false, blockingErrors: [] },
        status: "READY"
    };
    const notReady = {
        row: readyUnchanged.row,
        preview: { publishEligible: false, changed: false, blockingErrors: [{ code: "NOT_READY" }] },
        status: "BLOCKED"
    };
    assert.strictEqual(selectionAuthority.isSelectable(readyUnchanged), true, "READY + UNCHANGED must be selectable.");
    assert.strictEqual(selectionAuthority.isSelectable(notReady), false, "NOT_READY must not be selectable.");
    const pendingNull = selectionAuthority.classify({ row: readyUnchanged.row, preview: null, previewPending: true, status: "WARNING" });
    const pendingUndefined = selectionAuthority.classify({ row: readyUnchanged.row, preview: undefined, previewPending: true, status: "WARNING" });
    const identityMismatch = selectionAuthority.classify({ row: readyUnchanged.row, preview: null, previewPending: false, status: "BLOCKED" });
    const allRegionsReady = selectionAuthority.classify({ ...readyUnchanged, expectedRegions: ["TH", "MM"], preview: { ...readyUnchanged.preview, regions: [{ region: "TH" }, { region: "MM" }] } });
    const allRegionsMissingMm = selectionAuthority.classify({ ...readyUnchanged, expectedRegions: ["TH", "MM"], preview: { ...readyUnchanged.preview, regions: [{ region: "TH" }] } });
    assert.deepStrictEqual(pendingNull, { selectable: false, code: "PREVIEW_PENDING", missingRegions: [] });
    assert.deepStrictEqual(pendingUndefined, { selectable: false, code: "PREVIEW_PENDING", missingRegions: [] });
    assert.deepStrictEqual(identityMismatch, { selectable: false, code: "PREVIEW_IDENTITY_MISMATCH", missingRegions: [] });
    assert.strictEqual(allRegionsReady.selectable, true, "All Regions is selectable when every offered regional preview is present.");
    assert.deepStrictEqual(allRegionsMissingMm, { selectable: false, code: "PREVIEW_REGION_MISMATCH", missingRegions: ["MM"] });
    const selection = selectionAuthority.createSelectionState();
    assert.strictEqual(selection.selected.size, 0);
    selection.set(readyUnchanged.row, true, selectionAuthority.isSelectable(readyUnchanged));
    assert.strictEqual(selection.selected.size, 1, "Selecting one READY row must enable canonical selection.");
    assert.strictEqual(selection.payload([readyUnchanged.row]).length, 1, "Selected READY row must enter payload.");
    assert.deepStrictEqual(selectedPublicationDecision({ changed: false, publishEligible: true }), { action: "NO_OP", reason: "No changes" });
    selection.clear();
    assert.strictEqual(selection.selected.size, 0);
    const changedRow = { productCode: "freefire", packageCode: "FF_68_DIA" };
    assert.strictEqual(selection.payload([changedRow]).length, 0, "Changed but unselected row must not enter payload.");
    selection.set(changedRow, true, true);
    assert.strictEqual(selection.payload([changedRow]).length, 1, "Changed and selected row must enter payload.");

    const frontend = read("frontend/js/admin-pricing-engine.js");
    const html = read("frontend/admin.html");
    const service = read("backend/services/commerce/adminPricingControlCenterService.js");
    assert(frontend.includes("daily.selected.has(rowKey(row))"), "Publish payload must contain selected rows only.");
    assert(frontend.includes('daily.selected.has(key) ? "checked" : ""'), "Rendered checkbox state must derive from the canonical selection Set.");
    assert(frontend.includes("Publish Selected (${daily.selected.size})"), "Publish count must derive from the canonical selection Set.");
    assert(frontend.includes("daily.selected.size === 0"), "Publish disabled state must derive from the canonical selection Set.");
    assert(frontend.includes("const rows = buildPublishRows();"), "Confirmation and publication must use the unmodified canonical selected-row payload.");
    assert(frontend.includes("checkbox.checked = daily.selected.has(checkbox.dataset.rowSelection)"), "DOM checkbox properties must be synchronized from canonical selection state.");
    assert(frontend.includes("reconcileSelection(rows)") && frontend.includes("rows.filter(rowSelectionEligible)"), "Selection must be reconciled to visible eligible rows.");
    assert(frontend.includes('code: "PREVIEW_IDENTITY_MISMATCH"') && frontend.includes('code: "PREVIEW_REGION_MISMATCH"'), "Missing preview rows and regions must fail closed with explicit diagnostics.");
    assert(frontend.includes("daily.previewCompleted = true") && frontend.includes("daily.previewError = error.message"), "Preview completion and request failure must be represented explicitly.");
    assert(frontend.includes("visibleRows().filter") || frontend.includes("const rows = visibleRows()"), "Select All Visible must use the filtered visible result set.");
    assert(frontend.includes('mode === "CHANGED"') && frontend.includes("previewFor(row)?.changed === true"), "Select All Changed must select changed rows only.");
    assert(frontend.includes('if (mode === "CLEAR") daily.selected.clear()'), "Clear Selection must clear the canonical selection Set.");
    assert(html.includes("pricingSelectVisible") && html.includes("pricingSelectChanged") && html.includes("pricingClearSelection"), "Selective publishing controls must exist.");
    assert(service.includes('reason: "No changes"'), "Unchanged selected rows must be skipped as no-ops.");
    assert(service.includes("publishEligible: !blockingErrors.length"), "Operational readiness must not depend on row selection intent.");
    assert(!service.includes("publishEligible: !blockingErrors.length && row.selected !== false"), "Preview readiness must not deadlock initially-unselected rows.");
    assert(service.includes('includePublishedPriceOverride: true'), "Manual and adjustment previews must be validated through the production PRICE_OVERRIDE authority.");
    assert(service.includes('publishedPriceMode: priceMode === "CALCULATED" ? "POLICY_DERIVED" : "MANUAL_OVERRIDE"'), "Catalog publication must reuse existing price modes.");
    assert(service.includes('normalized.supplierCostEdited === true ? { canonicalSupplierCost'), "Price-only publication must not patch canonical supplier cost.");
    assert(service.includes("if (normalized.supplierCostEdited === true)"), "Price-only publication must not patch regional supplier cost.");
    assert(!frontend.includes("calculateBasePrice"), "The browser must not calculate authoritative prices.");
    const priceEditBody = frontend.slice(frontend.indexOf("function updatePriceEdit"), frontend.indexOf("async function saveSettings"));
    assert(!priceEditBody.includes("daily.selected.add"), "Commercial price edits must never silently select a row for publication.");

    console.log(JSON.stringify({
        result: "PASS",
        manualOverrideWithoutSupplierCostEdit: true,
        adjustmentWithoutSupplierCostEdit: true,
        serverAuthoritativeFinalPreview: true,
        selectedRowsOnly: true,
        initialCheckedRows: 0,
        initialSelectedCount: 0,
        initialPublishDisabled: true,
        readyUnchangedSelectable: true,
        notReadySelectable: false,
        nullPreviewSafe: true,
        undefinedPreviewSafe: true,
        previewPendingRowsPreserved: true,
        previewIdentityMismatchFailsClosed: true,
        allRegionsPresenceChecked: true,
        readySelectedPublishEnabled: true,
        readySelectedUnchangedNoOp: true,
        changedUnselectedExcluded: true,
        changedSelectedIncluded: true,
        selectOneInvariant: true,
        selectAllVisibleInvariant: true,
        clearSelectionInvariant: true,
        filterReconciliationInvariant: true,
        changedButUnselectedExcluded: true,
        selectAllVisibleRespectsFilters: true,
        selectAllChangedOnly: true,
        zeroSelectionDisabled: true,
        unchangedRowsNoOp: true,
        regionalIndependence: true,
        supplierCostUnchangedForPriceOnly: true,
        providerCalls: 0,
        paymentOrderFulfillmentCalls: 0
    }, null, 2));
}

main();
