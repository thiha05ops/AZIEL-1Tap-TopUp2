(function () {
    "use strict";
    let rememberedDaily={};try{rememberedDaily=JSON.parse(sessionStorage.getItem("aziel.dailyPricing.scope")||"{}")||{}}catch{rememberedDaily={}}
    const rememberDailyScope=state=>sessionStorage.setItem("aziel.dailyPricing.scope",JSON.stringify({supplierMarket:state.supplierMarket,product:state.selectedProductId,customerMarket:state.region}));

    const daily = {
        loaded: false, loading: false, products: [], navigationProducts: [], policies: [], suppliers: [], supplierMarkets: [], region: ["TH","MM"].includes(rememberedDaily.customerMarket)?rememberedDaily.customerMarket:"TH",
        supplierId: "", supplierMarket: String(rememberedDaily.supplierMarket||"").toUpperCase(), selectedProductId: String(rememberedDaily.product||""), edits: new Map(), priceEdits: new Map(), selected: new Set(), previews: new Map(), search: "", previewSeq: 0,
        previewCompleted: false, previewError: "",
        previewController: null, previewTimer: null, saveTimer: null, publishing: false,
        loadController: null, loadSeq: 0
    };
    const settings = { loaded: false, loading: false, policies: [], fxAuthorities: [], region: "TH", saving: false };

    const $ = (id) => document.getElementById(id);
    const text = (value) => String(value || "").trim();
    const upper = (value) => text(value).toUpperCase();
    const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const rowKey = (row) => `${upper(row.productCode)}:${upper(row.packageCode)}`;
    const priceEditKey = (row, region) => `${rowKey(row)}:${region}`;
    const money = (value, currency) => value == null ? "-" : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;

    async function pricingFetch(url, options = {}) {
        const token = localStorage.getItem("adminToken") || "";
        if (!token) throw new Error("Admin session missing.");
        const response = await fetch(url, {
            ...options,
            cache: "no-store",
            headers: { "Content-Type": "application/json", ...(options.headers || {}), Authorization: `Bearer ${token}` }
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) { const error = new Error(body.message || body.code || "Pricing request failed."); error.code = body.code || ""; error.status = response.status; throw error; }
        return body;
    }

    function policyConfig(region, source = "draft") {
        const item = (source === "settings" ? settings.policies : daily.policies).find(policy => policy.region === region);
        return structuredClone(item?.draft?.config || item?.active?.config || {});
    }

    function policyPayload(policies) {
        return policies.map(item => ({
            region: item.region,
            currency: item.currency,
            config: structuredClone(item.draft?.config || item.active?.config || {})
        }));
    }

    function eligibleSuppliers() {
        return daily.suppliers.filter(supplier => supplier.enabled !== false &&
            ["MMK", "THB", "USD"].includes(upper(supplier.supplierCurrency)));
    }

    function activeSupplier() {
        return daily.suppliers.find(supplier => String(supplier.id || supplier.supplierId || supplier._id) === daily.supplierId) || null;
    }

    function regionRows() {
        const rows = new Map();
        daily.products.filter(product => !daily.selectedProductId || product.productId === daily.selectedProductId).forEach(product => {
            (product.packages || []).forEach(pkg => {
                const key = `${upper(product.productCode)}:${upper(pkg.packageCode)}`;
                if (!rows.has(key)) rows.set(key, { ...pkg, productName: product.productName, productCode: product.productCode, regionalRows: {} });
                const row = rows.get(key);
                row.regionalRows[upper(pkg.region)] = pkg;
                if (pkg.savedDraftSupplierCost != null) {
                    row.savedDraftSupplierCost = pkg.savedDraftSupplierCost;
                    row.savedDraftSupplierId = pkg.savedDraftSupplierId;
                    row.savedDraftSupplierCurrency = pkg.savedDraftSupplierCurrency;
                }
                if (row.publishedSupplierPrice == null && pkg.publishedSupplierPrice != null) {
                    row.publishedSupplierPrice = pkg.publishedSupplierPrice;
                    row.publishedSupplierCurrency = pkg.publishedSupplierCurrency;
                }
            });
        });
        return [...rows.values()];
    }

    function visibleRows() {
        const query = daily.search.toLowerCase();
        return regionRows().filter(row => !query || `${row.productName} ${row.packageName} ${row.packageCode}`.toLowerCase().includes(query));
    }

    function priceInstruction(row, region) {
        return daily.priceEdits.get(priceEditKey(row, region)) || { mode: "CALCULATED", adjustmentType: "FIXED", value: "" };
    }

    function priceInstructions(row) {
        return Object.fromEntries(["TH", "MM"].map(region => [region, priceInstruction(row, region)]));
    }

    function regionProducts() {
        return daily.navigationProducts;
    }

    function renderProductSelect() {
        const select = $("pricingProductSelect");
        if (!select) return;
        const products = regionProducts();
        if (!products.some(product => product.productId === daily.selectedProductId)) daily.selectedProductId = products[0]?.productId || "";
        $("pricingProductOptions").innerHTML = products.map(product => `<option value="${product.productId}">${text(product.productName)} (${product.mappingCount ?? product.packages?.length ?? 0} mappings)</option>`).join("");
        select.value = daily.selectedProductId;
    }

    function dailyBlockingReason() {
        if (!daily.navigationProducts.length) return "Add a product to the Store Catalog before setting prices.";
        if (!daily.products.length) return "This Store Catalog product has no selected packages for this selling region.";
        if (!["TH", "MM"].every(region => daily.policies.some(policy => policy.region === region && (policy.active || policy.draft)))) return "Failed to load active Thailand and Myanmar pricing policies.";
        if (!daily.selectedProductId) return "Select a product.";
        const supplier = activeSupplier();
        if (!supplier) return "Select an enabled canonical supplier for this region.";
        if (!["MMK", "THB", "USD"].includes(upper(supplier.supplierCurrency))) return "Selected supplier has no canonical pricing currency.";
        return "";
    }

    function restoredSupplierId(rows) {
        return text(rows.find(row => row.savedDraftSupplierId)?.savedDraftSupplierId);
    }

    function setDailyError(message, retryable = false) {
        const box = $("pricingDailyBlocking");
        if (!box) return;
        box.hidden = !message;
        box.textContent = message || "";
        const retry = $("pricingRetryRefresh");
        if (retry) retry.hidden = !retryable;
    }

    function renderSupplierSelect() {
        const select = $("pricingSupplierSelect");
        if (!select) return;
        const suppliers = eligibleSuppliers();
        if (!suppliers.some(item => String(item.id || item.supplierId || item._id) === daily.supplierId)) {
            daily.supplierId = suppliers.length ? String(suppliers[0].id || suppliers[0].supplierId || suppliers[0]._id) : "";
        }
        $("pricingSupplierOptions").innerHTML = suppliers.map(supplier => `<option value="${upper(supplier.supplierCode)}">${text(supplier.name || supplier.supplierName)}</option>`).join("");
        select.value = upper(activeSupplier()?.supplierCode);
        const supplier = activeSupplier();
        $("pricingSupplierCurrency").textContent = supplier?.supplierCurrency || "-";
        setDailyError(dailyBlockingReason());
    }

    function renderSupplierMarketSelect() {
        const select = $("pricingSupplierMarketSelect");
        if (!select) return;
        $("pricingSupplierMarketOptions").innerHTML = daily.supplierMarkets.map(item => `<option value="${item.value}">${text(item.label)} (${item.count})</option>`).join("");
        select.value = daily.supplierMarket;
        select.disabled = !daily.supplierMarkets.length;
    }

    function previewFor(row) {
        return daily.previews.get(rowKey(row)) || null;
    }

    function statusView(row, preview, regionFilter = ["TH", "MM"]) {
        if (row.previewEligible === false) return { status: "BLOCKED", reason: row.previewabilityReason || "Supplier cost is unavailable for preview", regions: [] };
        if (!daily.edits.has(rowKey(row)) && row.supplierCost == null && row.savedDraftSupplierCost == null && row.publishedSupplierPrice == null) return { status: "MISSING", reason: "Supplier cost required", regions: [] };
        if (preview == null) {
            if (daily.previewError) return { status: "BLOCKED", reason: `Pricing preview unavailable: ${daily.previewError}`, regions: [], code: "PREVIEW_FAILED" };
            if (daily.previewCompleted) return { status: "BLOCKED", reason: `Preview identity mismatch for ${rowKey(row)}`, regions: [], code: "PREVIEW_IDENTITY_MISMATCH" };
            return { status: "WARNING", reason: "Preview pending", regions: [], code: "PREVIEW_PENDING" };
        }
        const regions = (preview?.regions || []).filter(item => row.regionalRows?.[item.region] && regionFilter.includes(item.region));
        const expectedRegions = regionFilter.filter(region => row.regionalRows?.[region]);
        const returnedRegions = new Set(regions.map(item => item.region));
        const missingRegions = expectedRegions.filter(region => !returnedRegions.has(region));
        if (missingRegions.length) {
            if (daily.previewCompleted) return { status: "BLOCKED", reason: `Preview response missing ${missingRegions.join("/")} for ${rowKey(row)}`, regions, code: "PREVIEW_REGION_MISMATCH" };
            return { status: "WARNING", reason: "Preview pending", regions, code: "PREVIEW_PENDING" };
        }
        if (!regions.length) return { status: "WARNING", reason: "Preview pending", regions: [], code: "PREVIEW_PENDING" };
        const blocked = regions.find(item => item.blockingErrors?.length || ["NEGATIVE_MARGIN", "PRICE_BELOW_COST", "INVALID_CONFIGURATION", "EXCHANGE_RATE_MISSING"].includes(item.profitabilityStatus));
        if (blocked) return { status: "BLOCKED", reason: `${blocked.region}: ${blocked.blockingErrors?.[0]?.message || "Pricing blocked"}`, regions };
        const warned = regions.find(item => item.warnings?.length);
        if (warned) return { status: "WARNING", reason: `${warned.region}: ${warned.warnings?.[0]?.message || "Commercial warning"}`, regions };
        if (row.offered === false) return { status: "WARNING", reason: `Preview only · ${row.offerabilityReason || "Production mapping is disabled"}`, regions };
        return { status: "READY", reason: "All active regions ready", regions };
    }

    function rowSelectionEligible(row) {
        const regions = daily.region === "ALL" ? ["TH", "MM"] : [daily.region];
        const preview = previewFor(row);
        const expectedRegions = regions.filter(region => row.regionalRows?.[region]);
        return window.AZIEL_DAILY_PRICING_SELECTION?.isSelectable({
            row,
            visible: true,
            preview,
            previewPending: !daily.previewCompleted && !daily.previewError,
            expectedRegions,
            status: statusView(row, preview, regions).status
        }) === true;
    }

    function reconcileSelection(rows = visibleRows()) {
        const allowed = new Set(rows.filter(rowSelectionEligible).map(rowKey));
        [...daily.selected].forEach(key => {
            if (!allowed.has(key)) daily.selected.delete(key);
        });
        document.querySelectorAll("[data-row-selection]").forEach(checkbox => {
            checkbox.checked = daily.selected.has(checkbox.dataset.rowSelection);
        });
    }

    function regionalResult(row, preview, region) {
        if (!row.regionalRows?.[region]) {
            const reason = row.regionalAvailability?.[region]?.reason || (row.offerabilityReason && daily.region === region ? row.offerabilityReason : "");
            return `<span class="pricing-region-empty">Not offered${reason ? ` · ${text(reason)}` : ""}</span>`;
        }
        const result = preview?.regions?.find(item => item.region === region);
        const published = row.regionalRows[region];
        const canonicalPublished = published.publishedPriceMode === "POLICY_DERIVED" && published.publishedSupplierCostConfigured === true && published.publishedSupplierId;
        const calculatedPrice = result?.calculatedPrice ?? result?.recommendedSellingPrice;
        const sellingPrice = result?.finalPreviewPrice ?? result?.recommendedSellingPrice ?? (canonicalPublished ? published.publishedPrice : null);
        const currency = result?.currency || published.currency;
        const profit = result?.netProfit;
        const margin = result?.marginPercent;
        const publishedPrice = result?.currentPublishedPrice ?? published.publishedPrice;
        const difference = result?.publishedPriceDifference;
        const percent = publishedPrice > 0 && difference != null ? (difference / publishedPrice) * 100 : null;
        const changeEvidence = result
            ? `<span>Current ${money(publishedPrice, currency)}</span><span>New ${money(sellingPrice, currency)}</span><b class="pricing-change-value">${difference == null ? "No change" : `${difference >= 0 ? "+" : ""}${money(difference, currency)}${percent == null ? "" : ` (${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%)`}`}</b>`
            : "";
        const reason = result?.blockingErrors?.[0]?.message || result?.warnings?.[0]?.message || "";
        const rawCost = result?.rawSupplierCost ?? result?.supplierCost;
        const rawCurrency = result?.rawSupplierCurrency || result?.supplierCurrency || activeSupplier()?.supplierCurrency;
        const landed = result?.landedCost;
        const fx = result?.conversionRequired ? `${result.exchangeRatePair} @ ${result.exchangeRate}` : "rate 1";
        const override = result?.packageProfitOverride || { mode: "INHERIT", value: null };
        const profitEvidence = override.mode !== "INHERIT"
            ? `Package override ${override.mode === "PERCENTAGE" ? `${override.value}%` : money(override.value, currency)}`
            : `Default profit ${money(result?.baseProfit, currency)}`;
        const guardrails = override.mode === "FIXED_AMOUNT" ? "Exact fixed override" : `Min ${money(result?.minimumProfitAmount, currency)} · Max ${result?.maximumProfitAmount == null ? "Unlimited" : money(result.maximumProfitAmount, currency)}`;
        const edit = priceInstruction(row, region);
        const manual = edit.mode === "MANUAL_OVERRIDE";
        const adjustment = edit.mode === "ADJUSTMENT";
        return `<div class="pricing-region-result operator-price-result">
            <strong>${money(sellingPrice, currency)}</strong>${changeEvidence}
            <div class="pricing-price-control" data-price-control data-product-code="${text(row.productCode)}" data-package-code="${text(row.packageCode)}" data-region="${region}">
                <select data-price-mode aria-label="${region} price mode"><option value="CALCULATED" ${edit.mode === "CALCULATED" ? "selected" : ""}>Calculated</option><option value="MANUAL_OVERRIDE" ${manual ? "selected" : ""}>Manual override</option><option value="ADJUSTMENT" ${adjustment ? "selected" : ""}>Adjustment</option></select>
                <select data-adjustment-type aria-label="${region} adjustment type" ${adjustment ? "" : "hidden disabled"}><option value="FIXED" ${edit.adjustmentType !== "PERCENTAGE" ? "selected" : ""}>Fixed +/-</option><option value="PERCENTAGE" ${edit.adjustmentType === "PERCENTAGE" ? "selected" : ""}>Percent +/-</option></select>
                <input data-price-value type="number" step="0.01" value="${edit.value ?? ""}" placeholder="${adjustment && edit.adjustmentType === "PERCENTAGE" ? "%" : currency}" aria-label="${region} manual or adjustment value" ${manual || adjustment ? "" : "hidden disabled"}>
            </div>
            <details class="operator-pricing-details"><summary>Calculation details</summary><span>Approved supplier cost ${money(rawCost, rawCurrency)}</span><span>FX ${text(fx)}</span><span>Landed ${money(landed, result?.landedCurrency || currency)}</span><span>${profitEvidence}</span><span>${guardrails}</span><span>Applied profit ${money(profit, currency)}</span><span>Margin ${margin == null ? "-" : `${Number(margin).toFixed(2)}%`}</span><span>Calculated ${money(calculatedPrice, currency)}</span>${reason ? `<small>${reason}</small>` : ""}</details></div>`;
    }

    function renderRows() {
        const body = $("pricingPackageRows");
        if (!body) return;
        const rows = visibleRows();
        reconcileSelection(rows);
        if (!rows.length) {
            const product = daily.products.find(item => item.productId === daily.selectedProductId);
            body.innerHTML = `<tr><td colspan="7" class="empty"><strong>No pricing packages are configured for ${text(product?.productName || "this product")} yet.</strong><br><small>Configure packages in Admin Catalog to make pricing rows available.</small></td></tr>`;
            $("pricingDailySummary").textContent = "0 packages";
            return;
        }
        const supplier = activeSupplier();
        body.innerHTML = rows.map(row => {
            const key = rowKey(row);
            const value = daily.edits.has(key) ? daily.edits.get(key).value : (row.supplierCost ?? row.savedDraftSupplierCost ?? row.publishedSupplierPrice ?? "");
            const preview = previewFor(row);
            const view = statusView(row, preview);
            const priceModes = (preview?.regions || []).map(item => item.priceMode);
            const displayStatus = ["BLOCKED", "MISSING", "WARNING"].includes(view.status)
                ? (view.status === "BLOCKED" || view.status === "MISSING" ? "NOT_READY" : view.status)
                : priceModes.some(mode => mode && mode !== "CALCULATED")
                    ? "MANUAL_OVERRIDE"
                    : preview?.costDelta
                        ? "COST_CHANGED"
                        : preview?.changed
                            ? "PRICE_CHANGED"
                            : "UNCHANGED";
            const blocked = dailyBlockingReason();
            const selectionEligible = rowSelectionEligible(row);
            const overrideRegions = daily.region === "ALL" ? ["TH", "MM"] : [daily.region];
            const profitControls = overrideRegions.map(region => {
                const override = row.regionalRows[region]?.profitOverride || { mode: "INHERIT", value: null };
                const currency = region === "TH" ? "THB" : "MMK";
                return `<div class="pricing-profit-control" data-profit-control data-product-code="${text(row.productCode)}" data-package-code="${text(row.packageCode)}" data-region="${region}"><small>${region}</small><select data-profit-mode><option value="INHERIT" ${override.mode === "INHERIT" ? "selected" : ""}>Inherit</option><option value="FIXED_AMOUNT" ${override.mode === "FIXED_AMOUNT" ? "selected" : ""}>Fixed Amount</option><option value="PERCENTAGE" ${override.mode === "PERCENTAGE" ? "selected" : ""}>Percentage</option></select><input data-profit-value type="number" min="0" step="0.01" value="${override.value ?? ""}" placeholder="${override.mode === "PERCENTAGE" ? "%" : currency}" ${override.mode === "INHERIT" ? "disabled" : ""}></div>`;
            }).join("");
            return `<tr data-pricing-row="${key}">
                <td><input type="checkbox" data-row-selection="${key}" aria-label="Select ${text(row.packageName)}" ${daily.selected.has(key) ? "checked" : ""} ${selectionEligible ? "" : "disabled"}></td>
                <td><strong>${text(row.packageName)}</strong><small>${text(row.productName)} · ${upper(row.packageCode)}</small><details class="pricing-mobile-regions"><summary>Regional prices</summary><div><b>Thailand</b>${regionalResult(row, preview, "TH")}</div><div><b>Myanmar</b>${regionalResult(row, preview, "MM")}</div></details></td>
                <td><label class="pricing-cost-input"><input type="number" min="0.000001" step="0.000001" value="${value}" placeholder="${row.observedSupplierCost ?? ""}" data-supplier-cost="${key}" ${(blocked || row.supplierCostStatus === "COST_REVIEW_REQUIRED") ? `disabled title="${row.supplierCostStatus === "COST_REVIEW_REQUIRED" ? "Observed cost requires explicit approval in Supplier Cost Coverage" : blocked}"` : ""}><span>${row.supplierCurrency || supplier?.supplierCurrency || "-"}</span></label><small>${row.supplierCostStatus || "COST_MISSING"}${row.observedSupplierCost != null ? ` · observed ${row.observedSupplierCost} ${row.observedSupplierCurrency}` : ""}</small></td>
                <td>${profitControls}</td>
                <td class="pricing-desktop-region">${regionalResult(row, preview, "TH")}</td><td class="pricing-desktop-region">${regionalResult(row, preview, "MM")}</td>
                <td><span class="pricing-status is-${displayStatus.toLowerCase()}">${displayStatus}</span><small>${view.reason}</small></td>
            </tr>`;
        }).join("");
        $("pricingDailySummary").textContent = `${rows.length} visible · ${daily.selected.size} selected`;
        updatePublishState();
    }

    async function saveProfitOverride(control) {
        const mode = control.querySelector("[data-profit-mode]").value;
        const input = control.querySelector("[data-profit-value]");
        input.disabled = mode === "INHERIT";
        const value = mode === "INHERIT" ? null : Number(input.value);
        if (mode !== "INHERIT" && (!Number.isFinite(value) || value < 0)) return;
        await pricingFetch("/api/admin/pricing-engine/workspace/profit-override", { method: "PUT", body: JSON.stringify({ productCode: control.dataset.productCode, packageCode: control.dataset.packageCode, region: control.dataset.region, profitOverride: { mode, value } }) });
        daily.loaded = false; daily.previews.clear(); await loadDaily(true);
    }

    function updatePublishState() {
        reconcileSelection();
        const button = $("pricingPublishBtn");
        button.disabled = daily.publishing || !activeSupplier() || daily.selected.size === 0;
        button.innerHTML = `<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Publish Changes (${daily.selected.size})`;
    }

    function buildWorkspaceRows() {
        const supplier = activeSupplier();
        return regionRows().filter(row => daily.edits.has(rowKey(row))).map(row => ({
            rowId: rowKey(row), productCode: row.productCode, packageCode: row.packageCode,
            mappingId: row.mappingId,
            newSupplierCost: daily.edits.get(rowKey(row)).value,
            supplierCurrency: supplier.supplierCurrency, supplierName: supplier.name,
            expectedUpdatedAt: row.updatedAt, selected: true
        }));
    }

    function buildPublishRows() {
        const supplier = activeSupplier();
        return regionRows().filter(row => daily.selected.has(rowKey(row))).map(row => ({
            rowId: rowKey(row), productCode: row.productCode, packageCode: row.packageCode,
            mappingId: row.mappingId,
            newSupplierCost: daily.edits.has(rowKey(row)) ? daily.edits.get(rowKey(row)).value : (row.supplierCost ?? row.savedDraftSupplierCost ?? row.publishedSupplierPrice),
            supplierCostEdited: daily.edits.has(rowKey(row)),
            supplierCurrency: supplier.supplierCurrency, supplierName: supplier.name,
            expectedUpdatedAt: row.updatedAt, priceInstructions: priceInstructions(row), selected: true
        }));
    }

    function buildPreviewRows() {
        const supplier = activeSupplier();
        return regionRows().filter(row => row.previewEligible !== false && (daily.edits.has(rowKey(row)) || row.supplierCost != null || row.savedDraftSupplierCost != null || row.publishedSupplierPrice != null)).map(row => ({
            rowId: rowKey(row), productCode: row.productCode, packageCode: row.packageCode,
            mappingId: row.mappingId,
            newSupplierCost: daily.edits.has(rowKey(row)) ? daily.edits.get(rowKey(row)).value : (row.supplierCost ?? row.savedDraftSupplierCost ?? row.publishedSupplierPrice),
            supplierCurrency: supplier.supplierCurrency, supplierName: supplier.name,
            expectedUpdatedAt: row.updatedAt, priceInstructions: priceInstructions(row),
            supplierCostEdited: daily.edits.has(rowKey(row)), selected: daily.selected.has(rowKey(row))
        }));
    }

    function authoritativePreviewRegion() {
        // Supplier mapping region is fulfillment/provider scope. Daily Pricing
        // target region is canonical storefront authority and is independent.
        return daily.region;
    }

    function schedulePreview() {
        clearTimeout(daily.previewTimer);
        daily.previewController?.abort();
        daily.previewSeq += 1;
        daily.previewCompleted = false;
        daily.previewError = "";
        daily.previewTimer = setTimeout(runPreview, 350);
    }

    async function runPreview() {
        if (!daily.supplierId || !activeSupplier()) return;
        const rows = buildPreviewRows();
        if (!rows.length) {
            daily.previewCompleted = true;
            daily.previewError = "";
            return renderRows();
        }
        const seq = ++daily.previewSeq;
        daily.previewController?.abort();
        daily.previewController = new AbortController();
        daily.previewCompleted = false;
        daily.previewError = "";
        $("pricingDailyState").textContent = "Calculating";
        try {
            const result = await pricingFetch("/api/admin/pricing-engine/workspace/preview", {
                method: "POST", signal: daily.previewController.signal,
                body: JSON.stringify({ supplierId: daily.supplierId, region: authoritativePreviewRegion(), rows })
            });
            if (seq !== daily.previewSeq) return;
            daily.previews.clear();
            (result.rows || []).forEach(row => daily.previews.set(rowKey(row), row));
            daily.previewCompleted = true;
            $("pricingDailyState").textContent = "Preview ready";
            renderRows();
            if (daily.edits.size) scheduleDraftSave();
        } catch (error) {
            if (error.name === "AbortError" || seq !== daily.previewSeq) return;
            daily.previewCompleted = false;
            daily.previewError = error.message || "Pricing preview request failed.";
            $("pricingDailyState").textContent = "Preview failed";
            setDailyError(error.message);
            renderRows();
        }
    }

    function scheduleDraftSave() {
        clearTimeout(daily.saveTimer);
        daily.saveTimer = setTimeout(saveDraft, 500);
    }

    async function saveDraft() {
        const rows = buildWorkspaceRows();
        if (!rows.length || !daily.supplierId) return;
        $("pricingDraftState").textContent = "Saving draft...";
        try {
            await pricingFetch("/api/admin/pricing-engine/draft", {
                method: "PUT",
                body: JSON.stringify({ policies: policyPayload(daily.policies), workspaceRows: rows, workspaceRegion: daily.region, supplierId: daily.supplierId })
            });
            $("pricingDraftState").textContent = "Draft Saved";
        } catch (error) {
            $("pricingDraftState").textContent = `Draft failed: ${error.message}`;
        }
    }

    async function publishRows() {
        const publishRegion = authoritativePreviewRegion();
        const regions = publishRegion === "ALL" ? ["TH", "MM"] : [publishRegion];
        reconcileSelection();
        const rows = buildPublishRows(),publicationIntent=rows.map(row=>({productCode:row.productCode,packageCode:row.packageCode,mappingId:row.mappingId}));
        if (!rows.length) return;
        const reviewLines = rows.flatMap(row => {
            const preview = daily.previews.get(rowKey(row));
            return (preview?.regions || []).filter(item => regions.includes(item.region)).map(item => {
                const oldPrice = item.currentPublishedPrice;
                const finalPrice = item.finalPreviewPrice ?? item.recommendedSellingPrice;
                const delta = finalPrice - oldPrice;
                const percent = oldPrice > 0 ? (delta / oldPrice) * 100 : 0;
                return `${row.productCode} / ${row.packageCode} / ${item.region}: ${money(oldPrice, item.currency)} → ${money(finalPrice, item.currency)} (${delta >= 0 ? "+" : ""}${money(delta, item.currency)}, ${percent.toFixed(2)}%)${item.priceMode === "CALCULATED" ? "" : " · MANUAL OVERRIDE"}`;
            });
        });
        if (!window.confirm(`Publish ${rows.length} selected package row(s)?\n\n${reviewLines.join("\n")}`)) return;
        daily.publishing = true;
        updatePublishState();
        $("pricingDailyState").textContent = "Publishing";
        const publishScope = `${daily.supplierId}|${daily.supplierMarket}|${daily.selectedProductId}|${daily.region}`;
        try {
            const result = await pricingFetch("/api/admin/pricing-engine/workspace/publish", { method: "POST", body: JSON.stringify({ supplierId: daily.supplierId, region: publishRegion, rows }) });
            const successKeys = new Set((result.draftCleanup?.clearedKeys || []).map(upper));
            successKeys.forEach(key => { daily.edits.delete(key); daily.previews.delete(key); });
            successKeys.forEach(key => { daily.selected.delete(key); daily.priceEdits.delete(key); });
            const publishedCount = Number(result.summary?.published || 0);
            const failedCount = Number(result.summary?.failed || 0);
            if (failedCount > 0) {
                const reasons = (result.results || []).filter(item => item.failed).map(item => `${item.productCode}/${item.packageCode}/${item.region}: ${item.reason || item.code || "Publish failed"}`);
                setDailyError(`${publishedCount} published; ${failedCount} failed.${reasons.length ? ` ${reasons.join(" · ")}` : ""}`, false);
                $("pricingDailyState").textContent = publishedCount > 0 ? "Partially published" : "Publish failed";
            } else {
                $("pricingDailyState").textContent = `${publishedCount} published`;
            }
            const currentScope = `${daily.supplierId}|${daily.supplierMarket}|${daily.selectedProductId}|${daily.region}`;
            if (publishedCount > 0 && currentScope === publishScope) {
                const activation=await pricingFetch(`/api/admin/product-activation?productCode=${encodeURIComponent(daily.selectedProductId)}&supplierMarket=${encodeURIComponent(daily.supplierMarket)}&customerMarket=${encodeURIComponent(publishRegion)}`);
                const selections=publicationIntent.map(intent=>activation.packages.find(item=>item.mappingId===intent.mappingId&&item.packageCode===intent.packageCode)).filter(Boolean);
                if(selections.length===publicationIntent.length&&selections.every(item=>item.readiness?.ready)){await pricingFetch(`/api/admin/product-activation/products/${encodeURIComponent(daily.selectedProductId)}/publication`,{method:"POST",body:JSON.stringify({customerMarket:publishRegion,selections:selections.map(item=>({packageCode:item.packageCode,mappingId:item.mappingId,expectedMappingUpdatedAt:item.mappingUpdatedAt,expectedDecisionVersion:item.publication.decisionVersion})),decisionNote:"Daily Pricing explicit Publish Changes decision"})});const store=await pricingFetch(`/api/admin/store-catalog-selections?productCode=${encodeURIComponent(daily.selectedProductId)}&supplierMarket=${encodeURIComponent(daily.supplierMarket)}&sellingRegion=${encodeURIComponent(publishRegion)}`),selection=store.selections?.[0];if(selection&&!selection.visibleRegions?.includes(publishRegion))await pricingFetch(`/api/admin/store-catalog-selections/${encodeURIComponent(selection._id)}/regions/${encodeURIComponent(publishRegion)}/visibility`,{method:"PATCH",body:JSON.stringify({visible:true,expectedDecisionVersion:selection.decisionVersion})})}
                else setDailyError("Prices were saved, but one or more packages cannot be published yet. View issue for details; unsafe packages remain private.",false);
                await loadDaily(true, { preserveOnError: true, postPublish: true });
            }
        } catch (error) {
            if (!error.status || error.status >= 500) {
                $("pricingDailyState").textContent = "Publish result uncertain · reconciling";
                const reconciled = await loadDaily(true, { preserveOnError: true, postPublish: true, failureMessage: `Publish response was uncertain and authoritative refresh also failed: ${error.message}` });
                if (reconciled) {
                    setDailyError("Publish response was uncertain. Authoritative workspace was reloaded; verify the published value before retrying.", false);
                    $("pricingDailyState").textContent = "Reconciled · verify before retry";
                }
            } else {
                setDailyError(error.message);
                $("pricingDailyState").textContent = "Publish failed";
            }
        } finally {
            daily.publishing = false;
            updatePublishState();
        }
    }

    async function loadDaily(force = false, { preserveOnError = false, postPublish = false, failureMessage = "" } = {}) {
        if ((daily.loading && !force) || (daily.loaded && !force)) return;
        const previousProductId = daily.selectedProductId;
        const seq = ++daily.loadSeq;
        daily.loadController?.abort();
        daily.loadController = new AbortController();
        daily.loading = true;
        daily.previewCompleted = false;
        daily.previewError = "";
        daily.previews.clear();
        setDailyError("");
        $("pricingDailyState").textContent = postPublish ? "Published · revalidating" : "Loading";
        try {
            const requestOptions = { signal: daily.loadController.signal };
            const workspaceParams = new URLSearchParams({ region: daily.region });
            if (daily.supplierId) workspaceParams.set("supplierId", daily.supplierId);
            if (daily.supplierMarket) workspaceParams.set("supplierMarket", daily.supplierMarket);
            if (daily.selectedProductId) workspaceParams.set("productCode", daily.selectedProductId);
            const [pricing, workspace] = await Promise.all([pricingFetch("/api/admin/pricing-engine", requestOptions), pricingFetch(`/api/admin/pricing-engine/workspace?${workspaceParams}`, requestOptions)]);
            if (seq !== daily.loadSeq) return;
            daily.products = Array.isArray(workspace.products) ? workspace.products : [];
            daily.navigationProducts = Array.isArray(workspace.navigationProducts) ? workspace.navigationProducts : [];
            daily.policies = Array.isArray(pricing.policies) ? pricing.policies : [];
            daily.suppliers = Array.isArray(workspace.suppliers) ? workspace.suppliers : [];
            daily.supplierId = workspace.selectedSupplierId || daily.supplierId;
            daily.supplierMarkets = Array.isArray(workspace.supplierMarkets) ? workspace.supplierMarkets : [];
            daily.supplierMarket = workspace.selectedSupplierMarket || "";
            if (!daily.policies.length) throw new Error("Failed to load pricing policy.");
            const rows = regionRows();
            daily.supplierId = restoredSupplierId(rows) || daily.supplierId;
            daily.edits.clear();
            rows.forEach(row => { if (row.savedDraftSupplierCost != null) daily.edits.set(rowKey(row), { value: row.savedDraftSupplierCost, restored: true }); });
            daily.loaded = true;
            daily.selectedProductId = workspace.selectedProductCode || (daily.navigationProducts.some(product => product.productId === previousProductId) ? previousProductId : "");
            rememberDailyScope(daily);
            $("pricingDailyState").textContent = "Ready";
            $("pricingRegionSelect").value = daily.region;
            renderProductSelect();
            renderSupplierSelect();
            renderSupplierMarketSelect();
            renderRows();
            schedulePreview();
            return true;
        } catch (error) {
            if (error.name === "AbortError" || seq !== daily.loadSeq) return;
            if (preserveOnError) {
                daily.loaded = true;
                setDailyError(failureMessage || `Publication succeeded, but authoritative workspace refresh failed: ${error.message}`, true);
                $("pricingDailyState").textContent = "Published · refresh required";
                renderRows();
            } else {
                daily.loaded = false;
                setDailyError(error.message, true);
                $("pricingDailyState").textContent = "Unavailable";
                $("pricingPackageRows").innerHTML = '<tr><td colspan="7" class="empty">Failed to load production pricing.</td></tr>';
            }
            return false;
        } finally { if (seq === daily.loadSeq) daily.loading = false; }
    }

    function fillSettings() {
        const form = $("pricingSettingsForm");
        const config = policyConfig(settings.region, "settings");
        const currency = settings.region === "TH" ? "THB" : "MMK";
        form.elements.profitType.value = config.profitRule?.type || "PERCENT";
        form.elements.profitValue.value = number(config.profitRule?.value);
        form.elements.gatewayType.value = config.gatewayFee?.type || "PERCENT";
        form.elements.gatewayValue.value = number(config.gatewayFee?.value);
        form.elements.platformType.value = config.platformCost?.type || "FIXED";
        form.elements.platformValue.value = number(config.platformCost?.value);
        form.elements.roundingMode.value = config.roundingRule?.mode || "NONE";
        form.elements.roundingIncrement.value = number(config.roundingRule?.increment);
        form.elements.minimumProfitAmount.value = number(config.minimumProfitAmount);
        form.elements.maximumProfitAmount.value = config.maximumProfitAmount == null ? "" : number(config.maximumProfitAmount);
        $("pricingSettingsStoreCurrency").textContent = currency;
        renderFxAuthorities();
        $("pricingRoundingUnit").textContent = currency;
        $("pricingMinimumProfitUnit").textContent = currency;
        $("pricingMaximumProfitUnit").textContent = currency;
        updateSettingUnits();
    }

    function updateSettingUnits() {
        const form = $("pricingSettingsForm");
        const currency = settings.region === "TH" ? "THB" : "MMK";
        [["profit", "profitType"], ["gateway", "gatewayType"], ["platform", "platformType"]].forEach(([unit, field]) => {
            form.querySelector(`[data-unit-for="${unit}"]`).textContent = form.elements[field].value === "PERCENT" ? "%" : currency;
        });
    }

    function renderFxAuthorities() {
        const pairs = [["USD", "THB"], ["USD", "MMK"], ["THB", "MMK"]];
        $("pricingFxAuthorityRows").innerHTML = pairs.map(([from, to]) => {
            const fx = settings.fxAuthorities.find(item => item.fromCurrency === from && item.toCurrency === to) || {};
            const captured = fx.capturedAt ? new Date(fx.capturedAt).toISOString().slice(0, 16) : "";
            return `<div class="pricing-fx-row" data-fx-pair="${from}_${to}"><strong>${from} → ${to}</strong><input data-fx="rate" type="number" min="0.000001" step="0.000001" value="${fx.rate || ""}" placeholder="Rate"><input data-fx="source" maxlength="80" value="${text(fx.source || "manual_admin")}" placeholder="Authority source"><input data-fx="capturedAt" type="datetime-local" value="${captured}"><input data-fx="maximumAgeSeconds" type="number" min="60" step="60" value="${number(fx.maximumAgeSeconds, 86400)}"></div>`;
        }).join("");
    }

    function readFxAuthorities() {
        return [...document.querySelectorAll("[data-fx-pair]")].map(row => {
            const [fromCurrency, toCurrency] = row.dataset.fxPair.split("_");
            const captured = row.querySelector('[data-fx="capturedAt"]').value;
            return { fromCurrency, toCurrency, rate: number(row.querySelector('[data-fx="rate"]').value), source: row.querySelector('[data-fx="source"]').value.trim(), capturedAt: captured ? new Date(captured).toISOString() : "", maximumAgeSeconds: number(row.querySelector('[data-fx="maximumAgeSeconds"]').value, 86400) };
        }).filter(item => item.rate > 0);
    }

    async function loadSettings(force = false) {
        if (settings.loading || (settings.loaded && !force)) return;
        settings.loading = true;
        try {
            const pricing = await pricingFetch("/api/admin/pricing-engine");
            settings.policies = Array.isArray(pricing.policies) ? pricing.policies : [];
            settings.fxAuthorities = Array.isArray(pricing.fxAuthorities) ? pricing.fxAuthorities : [];
            if (!settings.policies.length) throw new Error("Failed to load pricing policy.");
            settings.loaded = true;
            fillSettings();
            $("pricingSettingsSave").disabled = false;
            $("pricingSettingsState").textContent = "Ready";
        } catch (error) {
            $("pricingSettingsError").hidden = false;
            $("pricingSettingsError").textContent = error.message;
            $("pricingSettingsState").textContent = "Unavailable";
        } finally { settings.loading = false; }
    }

    function readSettingsConfig() {
        const form = $("pricingSettingsForm");
        const base = policyConfig(settings.region, "settings");
        return {
            ...base,
            minimumProfitAmount: number(form.elements.minimumProfitAmount.value),
            maximumProfitAmount: form.elements.maximumProfitAmount.value === "" ? null : number(form.elements.maximumProfitAmount.value),
            profitRule: { type: form.elements.profitType.value, value: number(form.elements.profitValue.value) },
            gatewayFee: { enabled: number(form.elements.gatewayValue.value) > 0, type: form.elements.gatewayType.value, value: number(form.elements.gatewayValue.value) },
            platformCost: { enabled: number(form.elements.platformValue.value) > 0, type: form.elements.platformType.value, value: number(form.elements.platformValue.value) },
            roundingRule: { enabled: form.elements.roundingMode.value !== "NONE", mode: form.elements.roundingMode.value, increment: number(form.elements.roundingIncrement.value), psychologicalEnding: 0 }
        };
    }

    function selectVisible(mode) {
        const rows = visibleRows();
        if (mode === "CLEAR") daily.selected.clear();
        if (mode === "ALL") {
            daily.selected.clear();
            rows.filter(rowSelectionEligible).forEach(row => daily.selected.add(rowKey(row)));
        }
        if (mode === "CHANGED") {
            daily.selected.clear();
            rows.filter(row => rowSelectionEligible(row) && previewFor(row)?.changed === true).forEach(row => daily.selected.add(rowKey(row)));
        }
        renderRows();
    }

    function updatePriceEdit(control) {
        const key = `${upper(control.dataset.productCode)}:${upper(control.dataset.packageCode)}:${control.dataset.region}`;
        const mode = control.querySelector("[data-price-mode]").value;
        const adjustmentType = control.querySelector("[data-adjustment-type]").value;
        const valueInput = control.querySelector("[data-price-value]");
        const needsValue = mode !== "CALCULATED";
        control.querySelector("[data-adjustment-type]").hidden = mode !== "ADJUSTMENT";
        control.querySelector("[data-adjustment-type]").disabled = mode !== "ADJUSTMENT";
        valueInput.hidden = !needsValue;
        valueInput.disabled = !needsValue;
        valueInput.placeholder = mode === "ADJUSTMENT" && adjustmentType === "PERCENTAGE"
            ? "%"
            : (control.dataset.region === "TH" ? "THB" : "MMK");
        if (mode === "CALCULATED") daily.priceEdits.delete(key);
        else daily.priceEdits.set(key, { mode, adjustmentType, value: valueInput.value });
        const packageKey = key.split(":").slice(0, 2).join(":");
        daily.previews.delete(packageKey);
        $("pricingDraftState").textContent = "Price preview pending";
        schedulePreview();
        updatePublishState();
    }

    async function saveSettings() {
        const form = $("pricingSettingsForm");
        if (!form.reportValidity() || settings.saving) return;
        settings.saving = true;
        $("pricingSettingsSave").disabled = true;
        $("pricingSettingsState").textContent = "Saving";
        try {
            const selectedPolicy = settings.policies.find(item => item.region === settings.region);
            const policies = [{ region: selectedPolicy.region, currency: selectedPolicy.currency, config: readSettingsConfig() }];
            await pricingFetch("/api/admin/pricing-engine/fx-authorities", { method: "PUT", body: JSON.stringify({ fxAuthorities: readFxAuthorities() }) });
            await pricingFetch("/api/admin/pricing-engine/draft", { method: "PUT", body: JSON.stringify({ policies }) });
            await pricingFetch("/api/admin/pricing-engine/publish", { method: "POST", body: JSON.stringify({ regions: [settings.region] }) });
            $("pricingSettingsState").textContent = "Settings saved";
            settings.loaded = false;
            daily.loaded = false;
            await loadSettings(true);
        } catch (error) {
            $("pricingSettingsError").hidden = false;
            $("pricingSettingsError").textContent = error.message;
            $("pricingSettingsState").textContent = "Save failed";
        } finally { settings.saving = false; $("pricingSettingsSave").disabled = false; }
    }

    function bind() {
        if (document.documentElement.dataset.pricingV3Bound === "true") return;
        document.documentElement.dataset.pricingV3Bound = "true";
        $("pricingSupplierSelect")?.closest("label")?.setAttribute("hidden","");
        $("pricingSupplierMarketSelect")?.closest("label")?.setAttribute("hidden","");
        const heading=document.querySelector("#section-pricing-engine h2");if(heading)heading.textContent="Daily Pricing";
        $("pricingRegionSelect")?.addEventListener("change", event => { daily.region = event.target.value;rememberDailyScope(daily);daily.edits.clear(); daily.priceEdits.clear(); daily.selected.clear(); daily.previews.clear(); loadDaily(true); });
        $("pricingProductSelect")?.addEventListener("change", event => { const value=event.target.value;daily.selectedProductId=daily.navigationProducts.some(item=>item.productId===value)?value:"";event.target.value=daily.selectedProductId;rememberDailyScope(daily);daily.search = ""; $("pricingPackageSearch").value = ""; daily.selected.clear(); daily.previews.clear();if(daily.selectedProductId)loadDaily(true); });
        $("pricingSupplierSelect")?.addEventListener("change", event => { const supplier=daily.suppliers.find(item=>upper(item.supplierCode)===upper(event.target.value));daily.supplierId=supplier?String(supplier.id||supplier.supplierId||supplier._id):"";daily.supplierMarket="";daily.selectedProductId="";event.target.value=supplier?upper(supplier.supplierCode):"";daily.edits.clear(); daily.priceEdits.clear(); daily.selected.clear(); daily.previews.clear(); if(daily.supplierId)loadDaily(true); });
        $("pricingSupplierMarketSelect")?.addEventListener("change", event => { const value=upper(event.target.value);daily.supplierMarket=daily.supplierMarkets.some(item=>item.value===value)?value:"";event.target.value=daily.supplierMarket;daily.selectedProductId="";rememberDailyScope(daily);daily.edits.clear();daily.priceEdits.clear();daily.selected.clear();daily.previews.clear();if(daily.supplierMarket)loadDaily(true); });
        $("pricingPackageSearch")?.addEventListener("input", event => { daily.search = event.target.value; renderRows(); });
        $("pricingPackageRows")?.addEventListener("input", event => { const key = event.target.dataset.supplierCost; if (key) { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) daily.edits.set(key, { value }); else daily.edits.delete(key); daily.previews.delete(key); $("pricingDraftState").textContent = "Unsaved Changes"; schedulePreview(); updatePublishState(); return; } const control = event.target.closest("[data-price-control]"); if (control && event.target.matches("[data-price-value]")) updatePriceEdit(control); });
        $("pricingPackageRows")?.addEventListener("change", event => {
            if (event.target.matches("[data-row-selection]")) { if (event.target.disabled) return; event.target.checked ? daily.selected.add(event.target.dataset.rowSelection) : daily.selected.delete(event.target.dataset.rowSelection); updatePublishState(); $("pricingDailySummary").textContent = `${visibleRows().length} visible · ${daily.selected.size} selected`; return; }
            const priceControl = event.target.closest("[data-price-control]");
            if (priceControl) { updatePriceEdit(priceControl); return; }
            const control = event.target.closest("[data-profit-control]"); if (!control) return; saveProfitOverride(control).catch(error => setDailyError(error.message));
        });
        $("pricingSelectVisible")?.addEventListener("click", () => selectVisible("ALL"));
        $("pricingSelectChanged")?.addEventListener("click", () => selectVisible("CHANGED"));
        $("pricingClearSelection")?.addEventListener("click", () => selectVisible("CLEAR"));
        $("pricingPublishBtn")?.addEventListener("click", publishRows);
        $("pricingRetryRefresh")?.addEventListener("click", () => loadDaily(true, { preserveOnError: daily.loaded }));
        $("pricingSettingsRegion")?.addEventListener("change", event => { settings.region = event.target.value; fillSettings(); });
        $("pricingSettingsForm")?.addEventListener("input", updateSettingUnits);
        $("pricingSettingsSave")?.addEventListener("click", saveSettings);
        window.addEventListener("aziel:admin-section-opened", event => { if (event.detail?.section === "pricing-engine") loadDaily(); if (event.detail?.section === "pricing-settings") loadSettings(); });
        window.addEventListener("aziel:admin-auth-ready", () => { if (document.body.dataset.adminSection === "pricing-engine") loadDaily(); if (document.body.dataset.adminSection === "pricing-settings") loadSettings(); });
        if (document.body.dataset.adminSection === "pricing-engine") loadDaily();
        if (document.body.dataset.adminSection === "pricing-settings") loadSettings();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
    else bind();
})();
