(function () {
    "use strict";

    const daily = {
        loaded: false, loading: false, products: [], policies: [], suppliers: [], region: "ALL",
        supplierId: "", selectedProductId: "", edits: new Map(), previews: new Map(), search: "", previewSeq: 0,
        previewController: null, previewTimer: null, saveTimer: null, publishing: false,
        loadController: null, loadSeq: 0
    };
    const settings = { loaded: false, loading: false, policies: [], region: "TH", saving: false };

    const $ = (id) => document.getElementById(id);
    const text = (value) => String(value || "").trim();
    const upper = (value) => text(value).toUpperCase();
    const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const rowKey = (row) => `${upper(row.productCode)}:${upper(row.packageCode)}`;
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
        if (!response.ok || body.success === false) throw new Error(body.message || body.code || "Pricing request failed.");
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

    function regionProducts() {
        return daily.products;
    }

    function renderProductSelect() {
        const select = $("pricingProductSelect");
        if (!select) return;
        const products = regionProducts();
        if (!products.some(product => product.productId === daily.selectedProductId)) daily.selectedProductId = products[0]?.productId || "";
        select.innerHTML = products.length
            ? products.map(product => `<option value="${product.productId}">${text(product.productName)}</option>`).join("")
            : '<option value="">No products available</option>';
        select.value = daily.selectedProductId;
    }

    function dailyBlockingReason() {
        if (!daily.products.length) return "Failed to load products.";
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

    function setDailyError(message) {
        const box = $("pricingDailyBlocking");
        if (!box) return;
        box.hidden = !message;
        box.textContent = message || "";
    }

    function renderSupplierSelect() {
        const select = $("pricingSupplierSelect");
        if (!select) return;
        const suppliers = eligibleSuppliers();
        if (!suppliers.some(item => String(item.id || item.supplierId || item._id) === daily.supplierId)) {
            daily.supplierId = suppliers.length ? String(suppliers[0].id || suppliers[0].supplierId || suppliers[0]._id) : "";
        }
        select.innerHTML = suppliers.length
            ? suppliers.map(supplier => `<option value="${String(supplier.id || supplier.supplierId || supplier._id)}">${text(supplier.name || supplier.supplierName)}</option>`).join("")
            : '<option value="">No configured suppliers</option>';
        select.value = daily.supplierId;
        const supplier = activeSupplier();
        $("pricingSupplierCurrency").textContent = supplier?.supplierCurrency || "-";
        setDailyError(dailyBlockingReason());
    }

    function previewFor(row) {
        return daily.previews.get(rowKey(row)) || null;
    }

    function statusView(row, preview, regionFilter = ["TH", "MM"]) {
        if (row.previewEligible === false) return { status: "BLOCKED", reason: row.previewabilityReason || "Supplier cost is unavailable for preview", regions: [] };
        if (!daily.edits.has(rowKey(row)) && row.supplierCost == null && row.savedDraftSupplierCost == null && row.publishedSupplierPrice == null) return { status: "MISSING", reason: "Supplier cost required", regions: [] };
        const regions = (preview?.regions || []).filter(item => row.regionalRows?.[item.region] && regionFilter.includes(item.region));
        if (!regions.length) return { status: "WARNING", reason: "Preview pending", regions: [] };
        const blocked = regions.find(item => item.blockingErrors?.length || ["NEGATIVE_MARGIN", "PRICE_BELOW_COST", "INVALID_CONFIGURATION", "EXCHANGE_RATE_MISSING"].includes(item.profitabilityStatus));
        if (blocked) return { status: "BLOCKED", reason: `${blocked.region}: ${blocked.blockingErrors?.[0]?.message || "Pricing blocked"}`, regions };
        const warned = regions.find(item => item.warnings?.length || item.profitabilityStatus === "LOW_MARGIN");
        if (warned) return { status: "WARNING", reason: `${warned.region}: ${warned.warnings?.[0]?.message || "Commercial warning"}`, regions };
        if (row.offered === false) return { status: "WARNING", reason: `Preview only · ${row.offerabilityReason || "Production mapping is disabled"}`, regions };
        return { status: "READY", reason: "All active regions ready", regions };
    }

    function regionalResult(row, preview, region) {
        if (!row.regionalRows?.[region]) return `<span class="pricing-region-empty">Not offered${row.offerabilityReason && daily.region === region ? ` · ${text(row.offerabilityReason)}` : ""}</span>`;
        const result = preview?.regions?.find(item => item.region === region);
        const published = row.regionalRows[region];
        const canonicalPublished = published.publishedPriceMode === "POLICY_DERIVED" && published.publishedSupplierCostConfigured === true && published.publishedSupplierId;
        const sellingPrice = result?.recommendedSellingPrice ?? (canonicalPublished ? published.publishedPrice : null);
        const currency = result?.currency || published.currency;
        const profit = result?.netProfit;
        const margin = result?.marginPercent;
        const reason = result?.blockingErrors?.[0]?.message || result?.warnings?.[0]?.message || "";
        const rawCost = result?.rawSupplierCost ?? result?.supplierCost;
        const rawCurrency = result?.rawSupplierCurrency || result?.supplierCurrency || activeSupplier()?.supplierCurrency;
        const landed = result?.landedCost;
        const fx = result?.conversionRequired ? `${result.exchangeRatePair} @ ${result.exchangeRate}` : "rate 1";
        return `<div class="pricing-region-result"><strong>${money(sellingPrice, currency)}</strong><span>Raw ${money(rawCost, rawCurrency)}</span><span>FX ${text(fx)}</span><span>Landed ${money(landed, result?.landedCurrency || currency)}</span><span>Profit ${money(profit, currency)}</span><span>Margin ${margin == null ? "-" : `${Number(margin).toFixed(2)}%`}</span>${reason ? `<small>${reason}</small>` : ""}</div>`;
    }

    function renderRows() {
        const body = $("pricingPackageRows");
        if (!body) return;
        const query = daily.search.toLowerCase();
        const rows = regionRows().filter(row => !query || `${row.productName} ${row.packageName} ${row.packageCode}`.toLowerCase().includes(query));
        if (!rows.length) {
            const product = daily.products.find(item => item.productId === daily.selectedProductId);
            body.innerHTML = `<tr><td colspan="5" class="empty"><strong>No pricing packages are configured for ${text(product?.productName || "this product")} yet.</strong><br><small>Configure packages in Admin Catalog to make pricing rows available.</small></td></tr>`;
            $("pricingDailySummary").textContent = "0 packages";
            return;
        }
        const supplier = activeSupplier();
        body.innerHTML = rows.map(row => {
            const key = rowKey(row);
            const value = daily.edits.has(key) ? daily.edits.get(key).value : (row.supplierCost ?? row.savedDraftSupplierCost ?? row.publishedSupplierPrice ?? "");
            const preview = previewFor(row);
            const view = statusView(row, preview);
            const blocked = dailyBlockingReason();
            return `<tr data-pricing-row="${key}">
                <td><strong>${text(row.packageName)}</strong><small>${text(row.productName)} · ${upper(row.packageCode)}</small><details class="pricing-mobile-regions"><summary>Regional prices</summary><div><b>Thailand</b>${regionalResult(row, preview, "TH")}</div><div><b>Myanmar</b>${regionalResult(row, preview, "MM")}</div></details></td>
                <td><label class="pricing-cost-input"><input type="number" min="0.000001" step="0.000001" value="${value}" data-supplier-cost="${key}" ${blocked ? `disabled title="${blocked}"` : ""}><span>${supplier?.supplierCurrency || "-"}</span></label></td>
                <td class="pricing-desktop-region">${regionalResult(row, preview, "TH")}</td><td class="pricing-desktop-region">${regionalResult(row, preview, "MM")}</td>
                <td><span class="pricing-status is-${view.status.toLowerCase()}">${view.status}</span><small>${view.reason}</small></td>
            </tr>`;
        }).join("");
        $("pricingDailySummary").textContent = `${rows.length} packages · ${daily.edits.size} changed`;
        updatePublishState();
    }

    function updatePublishState() {
        const regions = daily.region === "ALL" ? ["TH", "MM"] : [daily.region];
        const publishable = regionRows().filter(row => row.offered !== false && daily.edits.has(rowKey(row)) && ["READY", "WARNING"].includes(statusView(row, previewFor(row), regions).status));
        $("pricingPublishBtn").disabled = daily.publishing || !activeSupplier() || !publishable.length;
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

    function buildPreviewRows() {
        const supplier = activeSupplier();
        return regionRows().filter(row => row.previewEligible !== false && (daily.edits.has(rowKey(row)) || row.supplierCost != null || row.savedDraftSupplierCost != null || row.publishedSupplierPrice != null)).map(row => ({
            rowId: rowKey(row), productCode: row.productCode, packageCode: row.packageCode,
            mappingId: row.mappingId,
            newSupplierCost: daily.edits.has(rowKey(row)) ? daily.edits.get(rowKey(row)).value : (row.supplierCost ?? row.savedDraftSupplierCost ?? row.publishedSupplierPrice),
            supplierCurrency: supplier.supplierCurrency, supplierName: supplier.name,
            expectedUpdatedAt: row.updatedAt, selected: daily.edits.has(rowKey(row))
        }));
    }

    function authoritativePreviewRegion(rows) {
        if (daily.region !== "ALL") return daily.region;
        const regions = [...new Set(rows.map(row => upper(row.mappingRegion)).filter(Boolean))];
        return regions.length === 1 ? regions[0] : "ALL";
    }

    function schedulePreview() {
        clearTimeout(daily.previewTimer);
        daily.previewTimer = setTimeout(runPreview, 350);
    }

    async function runPreview() {
        if (!daily.supplierId || !activeSupplier()) return;
        const rows = buildPreviewRows();
        if (!rows.length) return renderRows();
        const seq = ++daily.previewSeq;
        daily.previewController?.abort();
        daily.previewController = new AbortController();
        $("pricingDailyState").textContent = "Calculating";
        try {
            const result = await pricingFetch("/api/admin/pricing-engine/workspace/preview", {
                method: "POST", signal: daily.previewController.signal,
                body: JSON.stringify({ supplierId: daily.supplierId, region: authoritativePreviewRegion(regionRows()), rows })
            });
            if (seq !== daily.previewSeq) return;
            (result.rows || []).forEach(row => daily.previews.set(rowKey(row), row));
            $("pricingDailyState").textContent = "Preview ready";
            renderRows();
            if (daily.edits.size) scheduleDraftSave();
        } catch (error) {
            if (error.name === "AbortError" || seq !== daily.previewSeq) return;
            $("pricingDailyState").textContent = "Preview failed";
            setDailyError(error.message);
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
        const publishRegion = authoritativePreviewRegion(regionRows());
        const regions = publishRegion === "ALL" ? ["TH", "MM"] : [publishRegion];
        const offeredKeys = new Set(regionRows().filter(row => row.offered !== false).map(rowKey));
        const rows = buildWorkspaceRows().filter(row => offeredKeys.has(rowKey(row)) && ["READY", "WARNING"].includes(statusView(row, daily.previews.get(rowKey(row)), regions).status));
        if (!rows.length) return;
        const hasWarning = rows.some(row => statusView(row, daily.previews.get(rowKey(row)), regions).status === "WARNING");
        if (hasWarning && !window.confirm("Some rows have commercial warnings. Publish these server-calculated prices?")) return;
        daily.publishing = true;
        updatePublishState();
        $("pricingDailyState").textContent = "Publishing";
        try {
            const result = await pricingFetch("/api/admin/pricing-engine/workspace/publish", { method: "POST", body: JSON.stringify({ supplierId: daily.supplierId, region: publishRegion, rows }) });
            const successKeys = new Set((result.draftCleanup?.clearedKeys || []).map(upper));
            successKeys.forEach(key => { daily.edits.delete(key); daily.previews.delete(key); });
            $("pricingDailyState").textContent = `${result.summary?.published || 0} published`;
            await loadDaily(true);
        } catch (error) {
            setDailyError(error.message);
            $("pricingDailyState").textContent = "Publish failed";
        } finally {
            daily.publishing = false;
            updatePublishState();
        }
    }

    async function loadDaily(force = false) {
        if ((daily.loading && !force) || (daily.loaded && !force)) return;
        const previousProductId = daily.selectedProductId;
        const seq = ++daily.loadSeq;
        daily.loadController?.abort();
        daily.loadController = new AbortController();
        daily.loading = true;
        setDailyError("");
        $("pricingDailyState").textContent = "Loading";
        try {
            const requestOptions = { signal: daily.loadController.signal };
            const workspaceParams = new URLSearchParams({ region: daily.region });
            if (daily.supplierId) workspaceParams.set("supplierId", daily.supplierId);
            const [pricing, workspace] = await Promise.all([pricingFetch("/api/admin/pricing-engine", requestOptions), pricingFetch(`/api/admin/pricing-engine/workspace?${workspaceParams}`, requestOptions)]);
            if (seq !== daily.loadSeq) return;
            daily.products = Array.isArray(workspace.products) ? workspace.products : [];
            daily.policies = Array.isArray(pricing.policies) ? pricing.policies : [];
            daily.suppliers = Array.isArray(workspace.suppliers) ? workspace.suppliers : [];
            daily.supplierId = workspace.selectedSupplierId || daily.supplierId;
            if (!daily.products.length) throw new Error("Failed to load products: production catalog returned no products.");
            if (!daily.policies.length) throw new Error("Failed to load pricing policy.");
            const rows = regionRows();
            daily.supplierId = restoredSupplierId(rows) || daily.supplierId;
            daily.edits.clear();
            rows.forEach(row => { if (row.savedDraftSupplierCost != null) daily.edits.set(rowKey(row), { value: row.savedDraftSupplierCost, restored: true }); });
            daily.loaded = true;
            daily.selectedProductId = daily.products.some(product => product.productId === previousProductId) ? previousProductId : "";
            $("pricingDailyState").textContent = "Ready";
            renderProductSelect();
            renderSupplierSelect();
            renderRows();
            schedulePreview();
        } catch (error) {
            if (error.name === "AbortError" || seq !== daily.loadSeq) return;
            daily.loaded = false;
            setDailyError(error.message);
            $("pricingDailyState").textContent = "Unavailable";
            $("pricingPackageRows").innerHTML = '<tr><td colspan="6" class="empty">Failed to load production pricing.</td></tr>';
        } finally { if (seq === daily.loadSeq) daily.loading = false; }
    }

    function fillSettings() {
        const form = $("pricingSettingsForm");
        const config = policyConfig(settings.region, "settings");
        const currency = settings.region === "TH" ? "THB" : "MMK";
        form.elements.supplierCurrency.value = config.supplierCurrency || "THB";
        form.elements.exchangeRate.value = number(config.exchangeRate, 1);
        form.elements.exchangeRateSource.value = config.exchangeRateSource || "manual_admin";
        form.elements.exchangeRateCapturedAt.value = config.exchangeRateCapturedAt ? new Date(config.exchangeRateCapturedAt).toISOString().slice(0, 16) : "";
        form.elements.exchangeRateMaxAgeSeconds.value = number(config.exchangeRateMaxAgeSeconds, 86400);
        form.elements.profitType.value = config.profitRule?.type || "PERCENT";
        form.elements.profitValue.value = number(config.profitRule?.value);
        form.elements.gatewayType.value = config.gatewayFee?.type || "PERCENT";
        form.elements.gatewayValue.value = number(config.gatewayFee?.value);
        form.elements.platformType.value = config.platformCost?.type || "FIXED";
        form.elements.platformValue.value = number(config.platformCost?.value);
        form.elements.roundingMode.value = config.roundingRule?.mode || "NONE";
        form.elements.roundingIncrement.value = number(config.roundingRule?.increment);
        form.elements.minimumProfitAmount.value = number(config.minimumProfitAmount);
        $("pricingSettingsStoreCurrency").textContent = currency;
        $("pricingExchangeDirection").textContent = `1 ${form.elements.supplierCurrency.value} = ${form.elements.exchangeRate.value} ${currency}`;
        $("pricingRoundingUnit").textContent = currency;
        $("pricingMinimumProfitUnit").textContent = currency;
        updateSettingUnits();
    }

    function updateSettingUnits() {
        const form = $("pricingSettingsForm");
        const currency = settings.region === "TH" ? "THB" : "MMK";
        [["profit", "profitType"], ["gateway", "gatewayType"], ["platform", "platformType"]].forEach(([unit, field]) => {
            form.querySelector(`[data-unit-for="${unit}"]`).textContent = form.elements[field].value === "PERCENT" ? "%" : currency;
        });
        $("pricingExchangeDirection").textContent = `1 ${form.elements.supplierCurrency.value} = ${form.elements.exchangeRate.value || 0} ${currency}`;
    }

    async function loadSettings(force = false) {
        if (settings.loading || (settings.loaded && !force)) return;
        settings.loading = true;
        try {
            const pricing = await pricingFetch("/api/admin/pricing-engine");
            settings.policies = Array.isArray(pricing.policies) ? pricing.policies : [];
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
            supplierCurrency: form.elements.supplierCurrency.value,
            exchangeRate: number(form.elements.exchangeRate.value),
            exchangeRateSource: form.elements.exchangeRateSource.value.trim(),
            exchangeRateCapturedAt: form.elements.exchangeRateCapturedAt.value ? new Date(form.elements.exchangeRateCapturedAt.value).toISOString() : "",
            exchangeRateMaxAgeSeconds: number(form.elements.exchangeRateMaxAgeSeconds.value, 86400),
            minimumProfitAmount: number(form.elements.minimumProfitAmount.value),
            profitRule: { type: form.elements.profitType.value, value: number(form.elements.profitValue.value) },
            gatewayFee: { enabled: number(form.elements.gatewayValue.value) > 0, type: form.elements.gatewayType.value, value: number(form.elements.gatewayValue.value) },
            platformCost: { enabled: number(form.elements.platformValue.value) > 0, type: form.elements.platformType.value, value: number(form.elements.platformValue.value) },
            roundingRule: { enabled: form.elements.roundingMode.value !== "NONE", mode: form.elements.roundingMode.value, increment: number(form.elements.roundingIncrement.value), psychologicalEnding: 0 }
        };
    }

    async function saveSettings() {
        const form = $("pricingSettingsForm");
        if (!form.reportValidity() || settings.saving) return;
        settings.saving = true;
        $("pricingSettingsSave").disabled = true;
        $("pricingSettingsState").textContent = "Saving";
        try {
            const policies = settings.policies.map(item => ({ region: item.region, currency: item.currency, config: item.region === settings.region ? readSettingsConfig() : structuredClone(item.draft?.config || item.active?.config || {}) }));
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
        $("pricingRegionSelect")?.addEventListener("change", event => { daily.region = event.target.value; daily.edits.clear(); daily.previews.clear(); loadDaily(true); });
        $("pricingProductSelect")?.addEventListener("change", event => { daily.selectedProductId = event.target.value; daily.search = ""; $("pricingPackageSearch").value = ""; daily.previews.clear(); renderRows(); schedulePreview(); });
        $("pricingSupplierSelect")?.addEventListener("change", event => { daily.supplierId = event.target.value; daily.edits.clear(); daily.previews.clear(); loadDaily(true); });
        $("pricingPackageSearch")?.addEventListener("input", event => { daily.search = event.target.value; renderRows(); });
        $("pricingPackageRows")?.addEventListener("input", event => { const key = event.target.dataset.supplierCost; if (!key) return; const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) daily.edits.set(key, { value }); else daily.edits.delete(key); daily.previews.delete(key); $("pricingDraftState").textContent = "Unsaved Changes"; schedulePreview(); updatePublishState(); });
        $("pricingPublishBtn")?.addEventListener("click", publishRows);
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
