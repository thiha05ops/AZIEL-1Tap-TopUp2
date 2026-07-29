(function () {
    const FALLBACK_PRODUCT = Object.freeze({
        productId: "mlbb",
        productCode: "mlbb",
        productName: "Mobile Legends",
        packages: [{
            packageId: "MLBB_7740",
            packageCode: "MLBB_7740",
            packageName: "7740 + 1548 Diamonds",
            region: "TH",
            currency: "THB",
            supplierCurrency: "THB",
            supplierPrice: 1120,
            exchangeRate: 1
        }]
    });

    const state = {
        products: [],
        selectedProductId: "",
        selectedPackageId: "",
        activePolicy: new Map(),
        draftPolicy: new Map(),
        activeVersion: null,
        preview: null,
        affected: null,
        dirty: false,
        loading: false,
        calculating: false,
        saving: false,
        publishing: false,
        apiReady: false,
        productSource: "empty",
        loadError: "",
        previewError: "",
        saveError: "",
        publishError: "",
        renderSeq: 0,
        loadPromise: null,
        workspace: {
            rows: [],
            previewRows: [],
            selectedProductId: "",
            selectedRegion: "TH",
            selectedSupplier: "Primary supplier",
            supplierCurrency: "THB",
            selectedPackageId: "",
            stagedChangesByPackageId: new Map(),
            previewResultsByPackageId: new Map(),
            selectedPackageDetail: null,
            activeRequestSequence: 0,
            selectedRowId: "",
            previewing: false,
            publishing: false,
            filter: "ALL",
            regionView: "TH",
            productFilter: "ALL",
            pasteMatches: [],
            debounce: null,
            previewSeq: 0,
            lastPreviewAt: ""
        }
    };
    const simulationState = state;
    const bootStartedAt = Date.now();

    function trace(label, details = {}) {
        try {
            const enabled = window.location.search.includes("pricingTrace=1") || localStorage.getItem("AZIEL_PRICING_ENGINE_TRACE") === "true";
            if (!enabled) return;
            console.info("[PRICING_ENGINE_ASYNC]", label, {
                elapsedMs: Date.now() - bootStartedAt,
                loading: state.loading,
                products: state.products.length,
                selectedProductId: state.selectedProductId,
                ...details
            });
        } catch (_) {
            // Tracing must never affect Pricing Engine runtime.
        }
    }

    document.addEventListener("DOMContentLoaded", initPricingEngineUi);
    window.addEventListener("aziel:admin-auth-ready", () => {
        trace("AUTH_READY_EVENT");
        const section = document.getElementById("section-pricing-engine");
        if (section?.dataset.pricingEngineBound === "true") requestProductionLoad(section, "admin-auth-ready");
    });

    function initPricingEngineUi() {
        trace("ENTER initPricingEngineUi");
        const section = document.getElementById("section-pricing-engine");
        if (!section || section.dataset.pricingEngineBound === "true") return;
        section.dataset.pricingEngineBound = "true";
        section.addEventListener("click", handleSectionClick);
        section.addEventListener("input", handleWorkspaceInput);
        section.addEventListener("change", handleWorkspaceChange);
        section.querySelector("#pricingProductSearch")?.addEventListener("input", event => filterProducts(section, event.target.value || ""));
        section.querySelector("#pricingScopeSelector")?.addEventListener("change", () => calculateAndRenderPreview(section));
        hydrateFallbackProductsFromDom(section);
        requestProductionLoad(section, "dom-ready");
        trace("EXIT initPricingEngineUi");
    }

    function handleSectionClick(event) {
        const section = event.currentTarget;
        const productButton = event.target.closest("[data-pricing-product-id]");
        if (productButton && section.contains(productButton)) {
            event.preventDefault();
            selectProduct(section, productButton.dataset.pricingProductId, productButton.dataset.pricingPackageId);
            return;
        }
        const editButton = event.target.closest("[data-pricing-edit]");
        if (editButton && section.contains(editButton)) {
            event.preventDefault();
            editDraftValue(section, editButton.dataset.pricingEdit);
            return;
        }
        const saveButton = event.target.closest("#pricingSaveDraftBtn");
        if (saveButton && section.contains(saveButton)) {
            event.preventDefault();
            saveDraft(section);
            return;
        }
        const publishButton = event.target.closest("#pricingPublishBtn");
        if (publishButton && section.contains(publishButton)) {
            event.preventDefault();
            publishDraft(section);
            return;
        }
        const retryButton = event.target.closest("#pricingRetryLoadBtn");
        if (retryButton && section.contains(retryButton)) {
            event.preventDefault();
            requestProductionLoad(section, "retry");
            return;
        }
        const pasteButton = event.target.closest("#pricingPasteBtn");
        if (pasteButton && section.contains(pasteButton)) {
            event.preventDefault();
            togglePanel(section, "#pricingPastePanel", true);
            return;
        }
        const pasteClose = event.target.closest("#pricingPasteCloseBtn");
        if (pasteClose && section.contains(pasteClose)) {
            event.preventDefault();
            togglePanel(section, "#pricingPastePanel", false);
            return;
        }
        const parsePaste = event.target.closest("#pricingParsePasteBtn");
        if (parsePaste && section.contains(parsePaste)) {
            event.preventDefault();
            parseWorkspacePaste(section);
            return;
        }
        const reviewButton = event.target.closest("#pricingReviewBtn");
        if (reviewButton && section.contains(reviewButton)) {
            event.preventDefault();
            renderWorkspaceReview(section, true);
            return;
        }
        const reviewClose = event.target.closest("#pricingReviewCloseBtn");
        if (reviewClose && section.contains(reviewClose)) {
            event.preventDefault();
            togglePanel(section, "#pricingReviewPanel", false);
            return;
        }
        const publishSelected = event.target.closest("#pricingWorkspacePublishSelectedBtn");
        if (publishSelected && section.contains(publishSelected)) {
            event.preventDefault();
            publishWorkspace(section, false);
            return;
        }
        const publishAll = event.target.closest("#pricingWorkspacePublishAllBtn");
        if (publishAll && section.contains(publishAll)) {
            event.preventDefault();
            publishWorkspace(section, true);
            return;
        }
        const detailButton = event.target.closest("[data-pricing-workspace-row]");
        if (detailButton && section.contains(detailButton)) {
            const interactive = event.target.closest("input, button, select, textarea, a");
            if (!interactive || interactive === detailButton) {
                state.workspace.selectedRowId = detailButton.dataset.pricingWorkspaceRow;
                const row = state.workspace.rows.find(item => item.rowId === state.workspace.selectedRowId);
                state.workspace.selectedPackageId = row ? workspacePackageId(row) : "";
                renderWorkspaceGrid(section);
                renderWorkspaceDetail(section);
            }
        }
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[char]));
    }

    function number(value, fallback = 0) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    }

    function parseOptionalPositiveAmount(value) {
        if (value == null || String(value).trim() === "") return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    }

    function inputValue(value) {
        return value == null || value === "" || !Number.isFinite(Number(value)) ? "" : String(value);
    }

    function workspacePackageId(row = {}) {
        return `${slug(row.productCode)}:${String(row.packageCode || row.packageId || "").trim()}`;
    }

    function workspaceRegion() {
        return state.workspace.selectedRegion || state.workspace.regionView || "TH";
    }

    function stagedRows() {
        return [...state.workspace.stagedChangesByPackageId.values()];
    }

    function previewForPackageId(packageId) {
        return state.workspace.previewResultsByPackageId.get(packageId) || null;
    }

    function isRowStaged(row) {
        return state.workspace.stagedChangesByPackageId.has(workspacePackageId(row));
    }

    function slug(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function positiveAmount(value, field) {
        const numeric = number(value, NaN);
        if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`Failed to calculate preview: ${field} missing or invalid.`);
        return numeric;
    }

    function policyKey(region, currency) {
        return `${String(region || "").toUpperCase()}:${String(currency || "").toUpperCase()}`;
    }

    function neutralConfig(region = "TH") {
        return {
            exchangeRate: String(region).toUpperCase() === "MM" ? 118 : 1,
            supplierFee: { enabled: false, type: "PERCENT", value: 0 },
            businessCost: { enabled: false, type: "FIXED", value: 0 },
            gatewayFee: { enabled: false, type: "PERCENT", value: 0 },
            platformCost: { enabled: false, type: "FIXED", value: 0 },
            tax: { enabled: false, type: "PERCENT", value: 0 },
            profitRule: { type: "PERCENT", value: 0 },
            roundingRule: { enabled: false, mode: "NONE", increment: 0, psychologicalEnding: 0 }
        };
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value || {}));
    }

    function normalizeConfig(config, region) {
        const fallback = neutralConfig(region);
        const money = (rule, base, defaultType = "FIXED") => ({
            enabled: rule?.enabled === true,
            type: String(rule?.type || base?.type || defaultType).toUpperCase() === "PERCENT" ? "PERCENT" : "FIXED",
            value: Math.max(0, number(rule?.value, number(base?.value, 0)))
        });
        const profit = config?.profitRule || fallback.profitRule;
        const rounding = config?.roundingRule || fallback.roundingRule;
        return {
            exchangeRate: Math.max(0, number(config?.exchangeRate, fallback.exchangeRate)),
            supplierFee: money(config?.supplierFee, fallback.supplierFee, "PERCENT"),
            businessCost: money(config?.businessCost, fallback.businessCost, "FIXED"),
            gatewayFee: money(config?.gatewayFee, fallback.gatewayFee, "PERCENT"),
            platformCost: money(config?.platformCost, fallback.platformCost, "FIXED"),
            tax: money(config?.tax, fallback.tax, "PERCENT"),
            profitRule: {
                type: String(profit?.type || "PERCENT").toUpperCase() === "FIXED" ? "FIXED" : "PERCENT",
                value: Math.max(0, number(profit?.value, 0))
            },
            roundingRule: {
                enabled: rounding?.enabled === true,
                mode: ["NONE", "NEAREST", "UP", "DOWN", "PSYCHOLOGICAL"].includes(String(rounding?.mode || "NONE").toUpperCase()) ? String(rounding?.mode || "NONE").toUpperCase() : "NONE",
                increment: Math.max(0, number(rounding?.increment, 0)),
                psychologicalEnding: Math.max(0, number(rounding?.psychologicalEnding, 0))
            }
        };
    }

    function getSelectedProduct() {
        return state.products.find(product => product.productId === state.selectedProductId) || state.products[0] || FALLBACK_PRODUCT;
    }

    function getSelectedPackage() {
        const product = getSelectedProduct();
        return product.packages.find(pkg => pkg.packageId === state.selectedPackageId) || product.packages[0] || FALLBACK_PRODUCT.packages[0];
    }

    function hasValidSelection() {
        const product = state.products.find(item => item.productId === state.selectedProductId);
        return Boolean(product?.packages?.some(pkg => pkg.packageId === state.selectedPackageId));
    }

    function canPersistPricing() {
        return state.apiReady === true &&
            state.productSource === "server" &&
            hasValidSelection() &&
            Boolean(state.preview) &&
            !state.previewError &&
            !state.loading &&
            !state.calculating &&
            !state.saving &&
            !state.publishing;
    }

    function getDraftPolicy(region, currency) {
        const key = policyKey(region, currency);
        if (!state.draftPolicy.has(key)) {
            state.draftPolicy.set(key, {
                region,
                currency,
                config: neutralConfig(region)
            });
        }
        return state.draftPolicy.get(key);
    }

    async function pricingFetch(url, options = {}, timeoutMs = 20000) {
        const token = localStorage.getItem("adminToken") || "";
        if (!token) throw new Error("Admin session missing.");
        const useTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0;
        const controller = useTimeout ? new AbortController() : null;
        const timeout = useTimeout ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
        trace("FETCH started", { url, timeoutMs });
        try {
            const response = await fetch(url, {
                ...options,
                cache: options.cache || "no-store",
                signal: controller?.signal,
                headers: {
                    ...(options.headers || {}),
                    Authorization: `Bearer ${token}`
                }
            });
            trace("FETCH resolved", { url, status: response.status });
            const contentType = response.headers.get("content-type") || "";
            const body = contentType.includes("application/json")
                ? await response.json().catch(() => ({}))
                : { message: await response.text().catch(() => "") };
            trace("JSON parsed", { url, success: body?.success !== false });
            if (!response.ok || body?.success === false) {
                const code = body?.code || body?.error || `HTTP_${response.status}`;
                const message = body?.message || response.statusText || "Pricing request failed.";
                throw new Error(`${code}: ${message}`);
            }
            return body;
        } catch (error) {
            if (error?.name === "AbortError") throw new Error("Request timed out. Please retry.");
            throw error;
        } finally {
            if (timeout) window.clearTimeout(timeout);
        }
    }

    function waitForAdminAuthReady(timeoutMs = 5000) {
        if (!localStorage.getItem("adminToken")) return Promise.resolve();
        if (!window.AZIEL_ADMIN_AUTH || window.AZIEL_ADMIN_AUTH.state?.loaded) return Promise.resolve();
        trace("AUTH wait started", { timeoutMs });
        return new Promise(resolve => {
            let settled = false;
            const finish = reason => {
                if (settled) return;
                settled = true;
                window.removeEventListener("aziel:admin-auth-ready", onReady);
                window.clearTimeout(timer);
                trace("AUTH wait finished", { reason });
                resolve();
            };
            const onReady = () => finish("event");
            const timer = window.setTimeout(() => finish("timeout"), timeoutMs);
            window.addEventListener("aziel:admin-auth-ready", onReady, { once: true });
        });
    }

    function normalizeProducts(data) {
        const raw = Array.isArray(data?.products) && data.products.length ? data.products : [FALLBACK_PRODUCT];
        if (raw.some(product => Array.isArray(product.packages))) {
            return raw.map(product => ({
                productId: slug(product.productId || product.productCode || product.productName || ""),
                productCode: slug(product.productCode || product.productId || product.productName || ""),
                productName: product.productName || product.productCode || "Product",
                enabled: product.enabled !== false,
                supportedRegions: Array.isArray(product.supportedRegions) ? product.supportedRegions.map(region => String(region).toUpperCase()) : [],
                packages: (product.packages || []).map(normalizePackage).filter(Boolean)
            })).filter(product => product.productId);
        }
        const grouped = new Map();
        raw.map(normalizePackage).filter(Boolean).forEach(pkg => {
            const productId = slug(pkg.productCode || pkg.productName || "product");
            if (!grouped.has(productId)) {
                grouped.set(productId, {
                    productId,
                    productCode: pkg.productCode,
                    productName: pkg.productName,
                    packages: []
                });
            }
            grouped.get(productId).packages.push(pkg);
        });
        return [...grouped.values()];
    }

    function normalizePackage(pkg) {
        if (!pkg) return null;
        const supplierPrice = number(pkg.supplierPrice ?? pkg.supplierCost, NaN);
        return {
            packageId: String(pkg.packageId || pkg.packageRef || pkg.packageCode || "").trim(),
            packageCode: String(pkg.packageCode || pkg.packageId || "").trim(),
            packageName: String(pkg.packageName || pkg.name || pkg.packageCode || "Package").trim(),
            productCode: slug(pkg.productCode || pkg.productId || pkg.productName || ""),
            productName: String(pkg.productName || pkg.gameName || pkg.productCode || "Product").trim(),
            packageEnabled: pkg.packageEnabled !== false,
            priceEnabled: pkg.priceEnabled !== false,
            region: String(pkg.region || "TH").toUpperCase(),
            currency: String(pkg.currency || "THB").toUpperCase(),
            supplierCurrency: String(pkg.supplierCurrency || pkg.currency || "THB").toUpperCase(),
            supplierPrice: Number.isFinite(supplierPrice) ? supplierPrice : null,
            supplierCostConfigured: pkg.supplierCostConfigured === true,
            supplierPackageCode: String(pkg.supplierPackageCode || pkg.supplierCode || pkg.packageCode || "").trim(),
            supplierName: String(pkg.supplierName || "").trim(),
            supplierVersion: String(pkg.supplierVersion || "").trim(),
            supplierCostTimestamp: pkg.supplierCostTimestamp || "",
            publishedPrice: number(pkg.publishedPrice ?? pkg.amount, supplierPrice),
            publishedPriceMode: String(pkg.publishedPriceMode || "LEGACY_COMPATIBILITY_PRICE").toUpperCase(),
            manualOverrideReason: String(pkg.manualOverrideReason || "").trim(),
            updatedAt: pkg.updatedAt || "",
            exchangeRate: Math.max(0, number(pkg.exchangeRate, 1))
        };
    }

    function normalizeDomProductRow(row) {
        if (!row) return null;
        const productName = String(row.dataset.pricingProduct || row.querySelector("strong")?.textContent || "").trim();
        const productId = String(row.dataset.pricingProductId || row.dataset.pricingProductCode || slug(productName)).trim();
        const packageId = String(row.dataset.pricingPackageId || row.dataset.pricingPackage || "").trim();
        const supplierPrice = number(row.dataset.pricingSupplierPrice, NaN);
        if (!productId || !packageId || !Number.isFinite(supplierPrice)) return null;
        return {
            productId,
            productCode: slug(row.dataset.pricingProductCode || productId),
            productName: productName || productId,
            packages: [{
                packageId,
                packageCode: String(row.dataset.pricingPackageCode || packageId).trim(),
                packageName: String(row.dataset.pricingPackage || row.querySelector("small")?.textContent || packageId).trim(),
                productCode: slug(row.dataset.pricingProductCode || productId),
                productName: productName || productId,
                region: String(row.dataset.pricingRegion || "TH").toUpperCase(),
                currency: String(row.dataset.pricingCurrency || "THB").toUpperCase(),
                supplierCurrency: String(row.dataset.pricingSupplierCurrency || row.dataset.pricingCurrency || "THB").toUpperCase(),
                supplierPrice,
                publishedPrice: number(row.dataset.pricingPublishedPrice, supplierPrice),
                publishedPriceMode: String(row.dataset.pricingPublishedPriceMode || "LEGACY_COMPATIBILITY_PRICE").toUpperCase(),
                manualOverrideReason: String(row.dataset.pricingManualOverrideReason || "").trim(),
                updatedAt: row.dataset.pricingUpdatedAt || "",
                exchangeRate: Math.max(0, number(row.dataset.pricingExchangeRate, 1))
            }]
        };
    }

    function hydrateFallbackProductsFromDom(section) {
        if (!section || state.products.length) return;
        const rows = Array.from(section.querySelectorAll("#pricingProductList [data-pricing-product-id]"));
        const products = rows.map(normalizeDomProductRow).filter(Boolean);
        if (!products.length) return;
        const selectedRow = rows.find(row => row.classList.contains("active"));
        state.products = products;
        state.productSource = "fallback";
        state.selectedProductId = selectedRow?.dataset.pricingProductId || products[0].productId;
        const selectedProduct = getSelectedProduct();
        state.selectedPackageId = selectedRow?.dataset.pricingPackageId || selectedProduct.packages[0]?.packageId || "";
        renderProducts(section);
        calculateAndRenderPreview(section);
    }

    function preserveSelectionOrDefault(previousProductId = "", previousPackageId = "") {
        const product = state.products.find(item => item.productId === previousProductId);
        if (product) {
            state.selectedProductId = product.productId;
            const pkg = product.packages.find(item => item.packageId === previousPackageId);
            state.selectedPackageId = pkg?.packageId || product.packages[0]?.packageId || "";
            return;
        }
        const firstProduct = state.products.find(item => item.packages?.length) || state.products[0] || FALLBACK_PRODUCT;
        state.selectedProductId = firstProduct.productId;
        state.selectedPackageId = firstProduct.packages[0]?.packageId || "";
    }

    function requestProductionLoad(section, reason = "manual") {
        if (!section) return Promise.resolve();
        if (state.loadPromise) {
            trace("LOAD joined existing promise", { reason });
            return state.loadPromise;
        }
        state.loadPromise = loadProductionState(section, reason).finally(() => {
            state.loadPromise = null;
        });
        return state.loadPromise;
    }

    async function loadProductionState(section, reason = "manual") {
        if (state.loading) return state.loadPromise || Promise.resolve();
        trace("ENTER loadProductionState", { reason });
        hydrateFallbackProductsFromDom(section);
        state.loading = true;
        state.loadError = "";
        setStatus(section, "Loading production pricing...");
        renderButtons(section);
        try {
            await waitForAdminAuthReady();
            const data = await pricingFetch("/api/admin/pricing-engine", {}, 0);
            trace("STATE populate started");
            state.products = normalizeProducts(data);
            state.productSource = "server";
            state.apiReady = true;
            state.activeVersion = data.version || null;
            state.affected = data.affected || null;
            state.activePolicy.clear();
            state.draftPolicy.clear();
            (data.policies || []).forEach(item => {
                const region = item.region || item.active?.region || item.draft?.region;
                const currency = item.currency || item.active?.currency || item.draft?.currency;
                if (!region || !currency) return;
                state.activePolicy.set(policyKey(region, currency), {
                    region,
                    currency,
                    config: normalizeConfig(item.active?.config, region),
                    source: item.active?.source || "active"
                });
                state.draftPolicy.set(policyKey(region, currency), {
                    region,
                    currency,
                    config: normalizeConfig((item.draft?.config || item.active?.config), region),
                    source: item.draft?.source || "active-copy"
                });
            });
            preserveSelectionOrDefault(state.selectedProductId, state.selectedPackageId);
            state.dirty = false;
            state.loadError = "";
            trace("STATE populated", { productCount: state.products.length, packageCount: state.products.reduce((sum, item) => sum + item.packages.length, 0) });
            trace("RENDER products started");
            renderProducts(section);
            buildWorkspaceRows(section);
            renderWorkspaceControls(section);
            renderWorkspaceGrid(section);
            requestWorkspacePreview(section);
            trace("RENDER products finished");
            trace("PREVIEW started");
            calculateAndRenderPreview(section);
            trace("PREVIEW finished");
        } catch (error) {
            state.apiReady = false;
            state.loadError = `Failed to load pricing: ${error.message}`;
            if (state.products.length) {
                calculateAndRenderPreview(section);
                renderLoadError(section, `${state.loadError} Product selection and local preview remain available. Save and Publish are disabled until production pricing loads.`);
            } else {
                renderLoadError(section, state.loadError);
            }
            setStatus(section, "Pricing workspace failed to load");
            trace("LOAD failed", { message: error.message });
        } finally {
            state.loading = false;
            renderButtons(section);
            renderStatus(section);
            trace("RENDER finished");
        }
    }

    function renderProducts(section) {
        const list = section.querySelector("#pricingProductList");
        if (!list) return;
        if (!state.products.length) {
            list.innerHTML = '<p class="empty">No catalog packages available for pricing.</p>';
            return;
        }
        list.innerHTML = state.products.map(product => {
            const defaultPackage = product.packages[0];
            const selected = product.productId === state.selectedProductId;
            const hasPackages = Boolean(defaultPackage);
            return `
                <button class="catalog-product-row pricing-product-row ${selected ? "active" : ""}" type="button"
                    aria-pressed="${selected ? "true" : "false"}"
                    data-pricing-product-id="${escapeHTML(product.productId)}"
                    data-pricing-package-id="${escapeHTML(defaultPackage?.packageId || "")}"
                    data-pricing-product="${escapeHTML(product.productName)}"
                    data-pricing-package="${escapeHTML(defaultPackage?.packageName || "")}">
                    <span>
                        <strong>${escapeHTML(product.productName)}</strong>
                        <small>${escapeHTML(defaultPackage?.packageName || "No pricing packages configured")}</small>
                    </span>
                    <span class="catalog-row-meta">
                        <b>${escapeHTML(defaultPackage?.packageCode || product.productCode)}</b>
                        <small>${hasPackages ? `${escapeHTML(defaultPackage.region)} / ${escapeHTML(defaultPackage.currency)}` : "Catalog product"}</small>
                    </span>
                </button>
            `;
        }).join("");
    }

    function selectProduct(section, productId, packageId = "") {
        const product = state.products.find(item => item.productId === productId);
        if (!product) {
            state.preview = null;
            state.previewError = `Product context unavailable: ${productId || "unknown"}.`;
            renderError(section, state.previewError);
            renderButtons(section);
            return;
        }
        state.selectedProductId = product.productId;
        state.selectedPackageId = packageId || product.packages[0]?.packageId || "";
        state.previewError = "";
        renderProducts(section);
        if (product.packages.length) {
            calculateAndRenderPreview(section);
        } else {
            state.preview = null;
            renderLoadError(section, "This catalog product has no pricing packages configured yet.");
        }
    }

    function filterProducts(section, query) {
        const normalized = query.trim().toLowerCase();
        section.querySelectorAll("[data-pricing-product-id]").forEach(row => {
            const haystack = `${row.dataset.pricingProduct || ""} ${row.dataset.pricingPackage || ""} ${row.textContent || ""}`.toLowerCase();
            row.hidden = Boolean(normalized) && !haystack.includes(normalized);
        });
    }

    function flattenWorkspacePackages() {
        const byPackage = new Map();
        state.products.forEach(product => {
            product.packages.forEach(pkg => {
                const key = `${product.productCode}:${pkg.packageCode}`;
                const existing = byPackage.get(key);
                if (!existing) {
                    const hasConfiguredCost = pkg.supplierCostConfigured === true && pkg.supplierPrice != null;
                    byPackage.set(key, {
                        rowId: key,
                        productCode: product.productCode,
                        productName: product.productName,
                        packageCode: pkg.packageCode,
                        packageId: pkg.packageId,
                        packageName: pkg.packageName,
                        supplierPackageCode: pkg.supplierPackageCode || pkg.packageCode,
                        oldSupplierCost: hasConfiguredCost ? pkg.supplierPrice : null,
                        newSupplierCost: hasConfiguredCost ? pkg.supplierPrice : null,
                        supplierCurrency: pkg.supplierCurrency || "THB",
                        supplierName: pkg.supplierName || "",
                        supplierVersion: pkg.supplierVersion || "",
                        supplierCostTimestamp: pkg.supplierCostTimestamp || "",
                        expectedUpdatedAt: pkg.updatedAt || "",
                        publishedPriceMode: pkg.publishedPriceMode,
                        manualOverrideReason: pkg.manualOverrideReason,
                        publishedPricesByRegion: { [pkg.region]: pkg.publishedPrice },
                        currenciesByRegion: { [pkg.region]: pkg.currency },
                        supportedRegions: [pkg.region],
                        packageEnabled: pkg.packageEnabled !== false,
                        priceEnabledByRegion: { [pkg.region]: pkg.priceEnabled !== false },
                        supplierCostConfigured: hasConfiguredCost,
                        selected: false,
                        changed: false,
                        status: "Unchanged"
                    });
                    return;
                }
                if (!existing.expectedUpdatedAt && pkg.updatedAt) existing.expectedUpdatedAt = pkg.updatedAt;
                if (!existing.supportedRegions.includes(pkg.region)) existing.supportedRegions.push(pkg.region);
                existing.publishedPricesByRegion[pkg.region] = pkg.publishedPrice;
                existing.currenciesByRegion[pkg.region] = pkg.currency;
                existing.priceEnabledByRegion[pkg.region] = pkg.priceEnabled !== false;
                if (!existing.packageId && pkg.packageId) existing.packageId = pkg.packageId;
                existing.packageEnabled = existing.packageEnabled && pkg.packageEnabled !== false;
                if (existing.oldSupplierCost == null && pkg.supplierCostConfigured === true && pkg.supplierPrice != null) {
                    existing.oldSupplierCost = pkg.supplierPrice;
                    existing.newSupplierCost = pkg.supplierPrice;
                    existing.supplierCostConfigured = true;
                }
            });
        });
        return [...byPackage.values()];
    }

    function buildWorkspaceRows(section) {
        state.workspace.rows = flattenWorkspacePackages().map(row => {
            const packageId = workspacePackageId(row);
            const staged = state.workspace.stagedChangesByPackageId.get(packageId);
            return staged ? { ...row, ...staged, selected: true, changed: true, status: "Edited" } : row;
        });
        if (!state.workspace.selectedRowId && state.workspace.rows[0]) {
            state.workspace.selectedRowId = state.workspace.rows[0].rowId;
            state.workspace.selectedPackageId = workspacePackageId(state.workspace.rows[0]);
        }
        if (!state.workspace.selectedProductId || state.workspace.productFilter === "ALL") {
            const selectedProduct = state.products.find(product => product.productId === state.selectedProductId);
            const firstWithRows = state.products.find(product => state.workspace.rows.some(row => row.productCode === product.productCode));
            state.workspace.selectedProductId = selectedProduct?.productCode || firstWithRows?.productCode || "ALL";
            state.workspace.productFilter = state.workspace.selectedProductId;
        }
        state.workspace.selectedRegion = state.workspace.regionView;
        renderWorkspaceControls(section);
    }

    function stageWorkspaceRow(row, nextCost) {
        const packageId = workspacePackageId(row);
        if (nextCost == null || nextCost === row.oldSupplierCost) {
            state.workspace.stagedChangesByPackageId.delete(packageId);
            state.workspace.previewResultsByPackageId.delete(packageId);
            row.newSupplierCost = row.oldSupplierCost;
            row.selected = false;
            row.changed = false;
            row.status = "Unchanged";
            return;
        }
        const staged = {
            ...row,
            rowId: row.rowId,
            packageId,
            newSupplierCost: nextCost,
            supplierCurrency: state.workspace.supplierCurrency,
            selected: true,
            changed: true,
            status: "Edited"
        };
        state.workspace.stagedChangesByPackageId.set(packageId, staged);
        row.newSupplierCost = nextCost;
        row.supplierCurrency = state.workspace.supplierCurrency;
        row.selected = true;
        row.changed = true;
        row.status = "Edited";
    }

    function clearPreviewForUnstagedRows() {
        const stagedIds = new Set(state.workspace.stagedChangesByPackageId.keys());
        [...state.workspace.previewResultsByPackageId.keys()].forEach(packageId => {
            if (!stagedIds.has(packageId)) state.workspace.previewResultsByPackageId.delete(packageId);
        });
        state.workspace.previewRows = [...state.workspace.previewResultsByPackageId.values()];
    }

    function clearIncompatibleWorkspaceState() {
        const selectedProduct = state.workspace.selectedProductId;
        [...state.workspace.stagedChangesByPackageId.entries()].forEach(([packageId, row]) => {
            if (selectedProduct !== "ALL" && row.productCode !== selectedProduct) {
                state.workspace.stagedChangesByPackageId.delete(packageId);
                state.workspace.previewResultsByPackageId.delete(packageId);
            }
        });
        if (state.workspace.selectedRowId) {
            const selectedRow = state.workspace.rows.find(row => row.rowId === state.workspace.selectedRowId);
            if (!selectedRow || (selectedProduct !== "ALL" && selectedRow.productCode !== selectedProduct)) {
                state.workspace.selectedRowId = "";
                state.workspace.selectedPackageId = "";
                state.workspace.selectedPackageDetail = null;
            }
        }
        clearPreviewForUnstagedRows();
    }

    function handleWorkspaceInput(event) {
        const section = event.currentTarget;
        const costInput = event.target.closest("[data-pricing-cost-input]");
        if (costInput && section.contains(costInput)) {
            const row = state.workspace.rows.find(item => item.rowId === costInput.dataset.pricingCostInput);
            if (!row) return;
            stageWorkspaceRow(row, parseOptionalPositiveAmount(costInput.value));
            state.workspace.selectedRowId = row.rowId;
            state.workspace.selectedPackageId = workspacePackageId(row);
            renderWorkspaceDetail(section);
            scheduleWorkspacePreview(section);
            return;
        }
        const supplierInput = event.target.closest("#pricingWorkspaceSupplier, #pricingWorkspaceVersion");
        if (supplierInput && section.contains(supplierInput)) {
            if (supplierInput.id === "pricingWorkspaceSupplier") state.workspace.selectedSupplier = supplierInput.value || "";
            scheduleWorkspacePreview(section);
        }
    }

    function handleWorkspaceChange(event) {
        const section = event.currentTarget;
        const checkbox = event.target.closest("[data-pricing-select-row]");
        if (checkbox && section.contains(checkbox)) {
            const row = state.workspace.rows.find(item => item.rowId === checkbox.dataset.pricingSelectRow);
            if (row && isRowStaged(row)) {
                const staged = state.workspace.stagedChangesByPackageId.get(workspacePackageId(row));
                staged.selected = checkbox.checked;
                row.selected = checkbox.checked;
            } else if (row) {
                row.selected = false;
                checkbox.checked = false;
            }
            renderWorkspaceGrid(section);
            renderWorkspaceReview(section, false);
            return;
        }
        const currency = event.target.closest("#pricingWorkspaceCurrency");
        if (currency && section.contains(currency)) {
            state.workspace.supplierCurrency = currency.value;
            state.workspace.stagedChangesByPackageId.forEach(row => {
                row.supplierCurrency = currency.value;
            });
            state.workspace.rows.forEach(row => {
                if (isRowStaged(row)) row.supplierCurrency = currency.value;
            });
            scheduleWorkspacePreview(section);
            return;
        }
        const productFilter = event.target.closest("#pricingWorkspaceProduct");
        if (productFilter && section.contains(productFilter)) {
            state.workspace.selectedProductId = productFilter.value;
            state.workspace.productFilter = productFilter.value;
            clearIncompatibleWorkspaceState();
            renderWorkspaceGrid(section);
            return;
        }
        const regionView = event.target.closest("#pricingWorkspaceRegion");
        if (regionView && section.contains(regionView)) {
            state.workspace.regionView = regionView.value;
            state.workspace.selectedRegion = regionView.value;
            state.workspace.previewResultsByPackageId.clear();
            state.workspace.previewRows = [];
            renderWorkspaceGrid(section);
            scheduleWorkspacePreview(section);
            return;
        }
        const filter = event.target.closest("#pricingWorkspaceFilter");
        if (filter && section.contains(filter)) {
            state.workspace.filter = filter.value;
            renderWorkspaceGrid(section);
        }
    }

    function renderWorkspaceControls(section) {
        const productSelect = section.querySelector("#pricingWorkspaceProduct");
        if (productSelect) {
            const current = state.workspace.productFilter || productSelect.value || "ALL";
            productSelect.innerHTML = '<option value="ALL">All products</option>' + state.products.map(product => (
                `<option value="${escapeHTML(product.productCode)}">${escapeHTML(product.productName)}</option>`
            )).join("");
            productSelect.value = [...productSelect.options].some(option => option.value === current) ? current : "ALL";
            state.workspace.productFilter = productSelect.value;
        }
        const regionSelect = section.querySelector("#pricingWorkspaceRegion");
        if (regionSelect && [...regionSelect.options].some(option => option.value === state.workspace.regionView)) {
            regionSelect.value = state.workspace.regionView;
        }
        const currencySelect = section.querySelector("#pricingWorkspaceCurrency");
        if (currencySelect && [...currencySelect.options].some(option => option.value === state.workspace.supplierCurrency)) {
            currencySelect.value = state.workspace.supplierCurrency;
        }
    }

    function workspaceRowsForRender() {
        return state.workspace.rows.filter(row => {
            if (state.workspace.productFilter !== "ALL" && row.productCode !== state.workspace.productFilter) return false;
            if (state.workspace.regionView !== "ALL" && !row.supportedRegions?.includes(state.workspace.regionView)) return false;
            const preview = previewForPackageId(workspacePackageId(row));
            const status = preview?.status || row.status || "Unchanged";
            if (state.workspace.filter === "ALL") return true;
            if (state.workspace.filter === "CHANGED") return isRowStaged(row);
            if (state.workspace.filter === "READY") return status === "Ready";
            if (state.workspace.filter === "BLOCKED") return status === "Blocked";
            if (state.workspace.filter === "LOW_MARGIN") return preview?.regions?.some(item => item.supplierCostConfigured === true && item.profitabilityStatus === "LOW_MARGIN");
            if (state.workspace.filter === "NEGATIVE_MARGIN") return preview?.regions?.some(item => item.supplierCostConfigured === true && /NEGATIVE|BELOW_COST/.test(item.profitabilityStatus || ""));
            if (state.workspace.filter === "SUPPLIER_COST_MISSING") return preview?.regions?.some(item => item.profitabilityStatus === "UNKNOWN_SUPPLIER_COST");
            if (state.workspace.filter === "EXCHANGE_RATE_MISSING") return preview?.regions?.some(item => item.profitabilityStatus === "EXCHANGE_RATE_MISSING");
            if (state.workspace.filter === "MANUAL_OVERRIDE") return preview?.regions?.some(item => item.publishedPriceMode === "MANUAL_OVERRIDE");
            if (state.workspace.filter === "LEGACY_COMPATIBILITY_PRICE") return preview?.regions?.some(item => item.publishedPriceMode === "LEGACY_COMPATIBILITY_PRICE");
            if (state.workspace.filter === "PROMO_RISK") return preview?.warnings?.some(item => /COUPON|PROMO/i.test(item.code || ""));
            return true;
        });
    }

    function regionPreview(row, region) {
        const preview = previewForPackageId(workspacePackageId(row));
        return preview?.regions?.find(item => item.region === region) || null;
    }

    function statusClass(status = "") {
        if (status === "Ready") return "is-ready";
        if (status === "Blocked") return "is-blocked";
        if (status === "Warning") return "is-warning";
        return "";
    }

    function workspaceRegionsForRow(row) {
        if (state.workspace.regionView === "ALL") return row.supportedRegions || [];
        return row.supportedRegions?.includes(state.workspace.regionView) ? [state.workspace.regionView] : [];
    }

    function publishedPriceForRow(row, region) {
        const preview = regionPreview(row, region);
        const currency = preview?.currency || row.currenciesByRegion?.[region] || (region === "MM" ? "MMK" : "THB");
        const amount = preview?.publishedPrice ?? row.publishedPricesByRegion?.[region];
        return formatMoney(amount, currency);
    }

    function recommendedPriceForRegion(region) {
        return region?.recommendedSellingPrice == null ? "Unavailable" : formatMoney(region.recommendedSellingPrice, region.currency);
    }

    function marginForRegion(region) {
        if (!region || region.marginPercent == null) return "Unknown";
        return `${region.marginPercent}%`;
    }

    function profitForRegion(region) {
        if (!region || region.netProfit == null) return "Unknown";
        return formatMoney(region.netProfit, region.currency);
    }

    function rowStatusHint(preview) {
        return (preview?.blockingErrors || preview?.warnings || [])[0]?.message || "Server preview";
    }

    function renderWorkspaceGrid(section) {
        const grid = section.querySelector("#pricingWorkspaceGrid");
        if (!grid) return;
        const rows = workspaceRowsForRender();
        if (!rows.length) {
            let message = "No packages match the current pricing workspace filter.";
            if (state.loadError && !state.apiReady) {
                message = `${state.loadError} Retry after confirming your Admin session and pricing API availability.`;
            } else if (!state.products.length) {
                message = "No catalog products loaded for Pricing Workspace.";
            } else if (!state.workspace.rows.length) {
                message = "Catalog products loaded, but no package rows were available for pricing operations.";
            } else if (state.workspace.productFilter !== "ALL") {
                message = "No packages for the selected product under the current filters.";
            }
            grid.innerHTML = `<p class="empty">${escapeHTML(message)}</p>`;
            renderWorkspaceSummary(section);
            renderWorkspaceDetail(section);
            return;
        }
        const view = state.workspace.regionView;
        const header = view === "TH"
            ? `<div class="pricing-grid-head is-region-view" role="row">
                <span>Select</span><span>Package</span><span>Package code</span><span>Supplier cost THB</span>
                <span>Current THB price</span><span>Recommended THB price</span><span>Published THB price</span>
                <span>Net profit</span><span>Margin</span><span>Status</span>
            </div>`
            : view === "MM"
                ? `<div class="pricing-grid-head is-region-view" role="row">
                    <span>Select</span><span>Package</span><span>Package code</span><span>Supplier cost</span>
                    <span>Exchange rate</span><span>Current MMK price</span><span>Recommended MMK price</span>
                    <span>Published MMK price</span><span>Net profit</span><span>Margin</span><span>Status</span>
                </div>`
                : `<div class="pricing-grid-head is-all-view" role="row">
                    <span>Select</span><span>Package</span><span>Package code</span><span>Supplier cost</span>
                    <span>Legacy THB price</span><span>Legacy MMK price</span><span>Regions</span><span>Status</span>
                </div>`;
        const body = rows.map(row => {
            const packageId = workspacePackageId(row);
            const preview = previewForPackageId(packageId);
            const region = view === "ALL" ? null : regionPreview(row, view);
            const status = preview?.status || row.status || "Unchanged";
            const selected = row.rowId === state.workspace.selectedRowId;
            const selector = `
                <label class="pricing-grid-cell">
                    <input type="checkbox" data-pricing-select-row="${escapeHTML(row.rowId)}" ${isRowStaged(row) && row.selected !== false ? "checked" : ""} ${isRowStaged(row) ? "" : "disabled"} aria-label="Select ${escapeHTML(row.packageName)}">
                </label>`;
            const packageCell = `
                <div class="pricing-grid-cell">
                    <strong>${escapeHTML(row.packageName)}</strong>
                    <small>${escapeHTML(row.productName)}</small>
                </div>`;
            const codeCell = `<div class="pricing-grid-cell"><span>${escapeHTML(row.packageCode)}</span><small>${escapeHTML(row.supplierPackageCode || "Supplier code")}</small></div>`;
            const costInput = `<input data-pricing-cost-input="${escapeHTML(row.rowId)}" type="number" min="0" step="0.01" value="${escapeHTML(inputValue(row.newSupplierCost))}" placeholder="Enter cost" aria-label="New supplier cost">`;
            const costCell = `<div class="pricing-grid-cell"><span>${formatMoney(row.oldSupplierCost, row.supplierCurrency)}</span>${costInput}<small>${row.oldSupplierCost == null ? "Supplier cost missing" : "Current supplier cost"}</small></div>`;
            const statusCell = `<div class="pricing-grid-cell"><span class="pricing-status-chip ${statusClass(status)}">${escapeHTML(status)}</span><small>${escapeHTML(rowStatusHint(preview))}</small></div>`;
            let cells;
            if (view === "TH") {
                cells = `${selector}${packageCell}${codeCell}
                    <div class="pricing-grid-cell">${costInput}<small>${row.newSupplierCost == null ? "Supplier cost missing" : `Old: ${formatMoney(row.oldSupplierCost, row.supplierCurrency)}`}</small></div>
                    <div class="pricing-grid-cell"><span>${publishedPriceForRow(row, "TH")}</span><small>Legacy THB Price</small></div>
                    <div class="pricing-grid-cell"><span>${recommendedPriceForRegion(region)}</span><small>Server preview</small></div>
                    <div class="pricing-grid-cell"><span>${publishedPriceForRow(row, "TH")}</span><small>Unchanged before publish</small></div>
                    <div class="pricing-grid-cell"><span>${profitForRegion(region)}</span><small>Net profit</small></div>
                    <div class="pricing-grid-cell"><span>${marginForRegion(region)}</span><small>Margin</small></div>
                    ${statusCell}`;
            } else if (view === "MM") {
                cells = `${selector}${packageCell}${codeCell}${costCell}
                    <div class="pricing-grid-cell"><span>${region?.exchangeRate || "—"}</span><small>${escapeHTML(region?.exchangeRatePair || "THB→MMK")}</small></div>
                    <div class="pricing-grid-cell"><span>${publishedPriceForRow(row, "MM")}</span><small>Legacy MMK Price</small></div>
                    <div class="pricing-grid-cell"><span>${recommendedPriceForRegion(region)}</span><small>Server preview</small></div>
                    <div class="pricing-grid-cell"><span>${publishedPriceForRow(row, "MM")}</span><small>Unchanged before publish</small></div>
                    <div class="pricing-grid-cell"><span>${profitForRegion(region)}</span><small>Net profit</small></div>
                    <div class="pricing-grid-cell"><span>${marginForRegion(region)}</span><small>Margin</small></div>
                    ${statusCell}`;
            } else {
                const regions = workspaceRegionsForRow(row);
                cells = `${selector}${packageCell}${codeCell}${costCell}
                    <div class="pricing-grid-cell"><span>${publishedPriceForRow(row, "TH")}</span><small>Legacy THB Price</small></div>
                    <div class="pricing-grid-cell"><span>${publishedPriceForRow(row, "MM")}</span><small>Legacy MMK Price</small></div>
                    <div class="pricing-grid-cell"><span>${escapeHTML(regions.join(" / ") || "—")}</span><small>${regions.length} regional price rows</small></div>
                    ${statusCell}`;
            }
            return `
                <div class="pricing-grid-row ${selected ? "is-selected" : ""} ${view === "ALL" ? "is-all-view" : "is-region-view"}" role="row" data-status="${escapeHTML(status)}" data-pricing-workspace-row="${escapeHTML(row.rowId)}" tabindex="0">
                    ${cells}
                </div>
            `;
        }).join("");
        grid.innerHTML = header + body;
        renderWorkspaceSummary(section);
        renderWorkspaceDetail(section);
    }

    function renderWorkspaceSummary(section, summary = null) {
        const computed = summary || {
            packagesLoaded: state.workspace.rows.length,
            packageRows: state.workspace.rows.length,
            regionalPriceRows: state.workspace.rows.reduce((sum, row) => sum + (row.supportedRegions?.length || 0), 0),
            changed: stagedRows().length,
            ready: state.workspace.previewRows.filter(row => row.status === "Ready").length,
            lowMargin: state.workspace.previewRows.filter(row => row.regions?.some(item => item.supplierCostConfigured === true && item.profitabilityStatus === "LOW_MARGIN")).length,
            negativeMargin: state.workspace.previewRows.filter(row => row.regions?.some(item => item.supplierCostConfigured === true && /NEGATIVE|BELOW_COST/.test(item.profitabilityStatus || ""))).length,
            missingSupplierCost: state.workspace.previewRows.filter(row => row.regions?.some(item => item.profitabilityStatus === "UNKNOWN_SUPPLIER_COST")).length,
            manualOverrides: state.workspace.previewRows.filter(row => row.regions?.some(item => item.publishedPriceMode === "MANUAL_OVERRIDE")).length,
            promoRisk: state.workspace.previewRows.filter(row => row.warnings?.some(item => /COUPON|PROMO/i.test(item.code || ""))).length,
            blocked: state.workspace.previewRows.filter(row => row.status === "Blocked").length
        };
        setText(section, "#pricingWorkspacePackagesLoaded", `${computed.packageRows ?? computed.packagesLoaded ?? 0} packages / ${computed.regionalPriceRows ?? 0} regional price rows`);
        setText(section, "#pricingWorkspaceChanged", computed.changed || 0);
        setText(section, "#pricingWorkspaceReady", computed.ready || 0);
        setText(section, "#pricingWorkspaceLowMargin", computed.lowMargin || 0);
        setText(section, "#pricingWorkspaceNegativeMargin", computed.negativeMargin || 0);
        setText(section, "#pricingWorkspaceMissingCost", computed.missingSupplierCost || 0);
        setText(section, "#pricingWorkspaceBlocked", computed.blocked || 0);
        setText(section, "#pricingWorkspaceManualOverrides", computed.manualOverrides || 0);
        setText(section, "#pricingWorkspacePromoRisk", computed.promoRisk || 0);
        setText(section, "#pricingWorkspaceUpdated", `Last updated: ${state.workspace.lastPreviewAt || "Not previewed"}`);
    }

    function renderWorkspaceDetail(section) {
        const box = section.querySelector("#pricingWorkspaceDetail");
        if (!box) return;
        const loadedRow = state.workspace.rows.find(item => item.rowId === state.workspace.selectedRowId);
        if (!loadedRow || (state.workspace.productFilter !== "ALL" && loadedRow.productCode !== state.workspace.productFilter)) {
            state.workspace.selectedRowId = "";
            state.workspace.selectedPackageId = "";
            state.workspace.selectedPackageDetail = null;
            box.innerHTML = '<p class="empty">No staged package selected.</p>';
            return;
        }
        const row = previewForPackageId(workspacePackageId(loadedRow)) || loadedRow;
        state.workspace.selectedPackageId = workspacePackageId(loadedRow);
        state.workspace.selectedPackageDetail = row;
        setText(section, "#pricingWorkspaceDetailTitle", `${row.productName} · ${row.packageName}`);
        const regionCards = (row.regions || []).map(region => `
            <article class="pricing-detail-card">
                <strong>${region.region === "TH" ? "Thailand" : "Myanmar"} · ${escapeHTML(region.currency || "")}</strong>
                <div class="pricing-detail-line"><span>Current published price</span><b>${formatMoney(region.publishedPrice, region.currency)}</b></div>
                <div class="pricing-detail-line"><span>Recommended price</span><b>${region.recommendedSellingPrice == null ? "Unavailable" : formatMoney(region.recommendedSellingPrice, region.currency)}</b></div>
                <div class="pricing-detail-line"><span>Final after promo</span><b>${formatMoney(region.finalPayableAmount, region.currency)}</b></div>
                <div class="pricing-detail-line"><span>Reference discount</span><b>${region.displayDiscountPercent || 0}%</b></div>
                <div class="pricing-detail-line"><span>Net profit / margin</span><b>${region.netProfit == null ? "Unknown" : `${formatMoney(region.netProfit, region.currency)} · ${region.marginPercent}%`}</b></div>
                <div class="pricing-detail-line"><span>Payment fee impact</span><b>${escapeHTML((region.paymentFeeSimulation || []).map(item => `${item.method}: ${item.marginPercent ?? "?"}%`).join(" · "))}</b></div>
                <div class="pricing-detail-line"><span>Policy source</span><b>${escapeHTML(region.effectivePolicySource || "production")}</b></div>
            </article>
        `).join("");
        const warnings = [...(row.warnings || []), ...(row.blockingErrors || [])].map(item => `<li>${escapeHTML(item.message || item.code)}</li>`).join("");
        box.innerHTML = `
            <article class="pricing-detail-card">
                <strong>${escapeHTML(row.packageName || "")}</strong>
                <div class="pricing-detail-line"><span>Supplier Cost</span><b>${row.oldSupplierCost == null ? "Not configured" : formatMoney(row.oldSupplierCost, row.supplierCurrency)}</b></div>
                <div class="pricing-detail-line"><span>New Supplier Cost</span><b>${row.newSupplierCost == null ? "Empty" : formatMoney(row.newSupplierCost, row.supplierCurrency)}</b></div>
                <div class="pricing-detail-line"><span>Supplier code</span><b>${escapeHTML(row.supplierPackageCode || row.packageCode || "")}</b></div>
                <div class="pricing-detail-line"><span>Status</span><b>${escapeHTML(row.status || "Edited")}</b></div>
                ${row.newSupplierCost == null ? '<div class="pricing-detail-line"><span>Next action</span><b>Enter supplier cost</b></div>' : ""}
            </article>
            ${regionCards || '<p class="empty">Preview this row to inspect regional calculations.</p>'}
            ${warnings ? `<article class="pricing-detail-card"><strong>Warnings</strong><ul>${warnings}</ul></article>` : ""}
        `;
    }

    function workspacePayloadRows({ onlySelected = false } = {}) {
        const supplierName = sectionValue("#pricingWorkspaceSupplier", "Primary supplier");
        const supplierVersion = sectionValue("#pricingWorkspaceVersion", "");
        return stagedRows()
            .filter(row => !onlySelected || row.selected !== false)
            .map(row => ({
                rowId: row.rowId,
                productCode: row.productCode,
                packageCode: row.packageCode,
                newSupplierCost: row.newSupplierCost,
                supplierCurrency: state.workspace.supplierCurrency,
                supplierName,
                supplierVersion,
                supplierCostTimestamp: new Date().toISOString(),
                expectedUpdatedAt: row.expectedUpdatedAt,
                selected: row.selected !== false
            }));
    }

    function sectionValue(selector, fallback = "") {
        return document.querySelector(`#section-pricing-engine ${selector}`)?.value || fallback;
    }

    function scheduleWorkspacePreview(section) {
        window.clearTimeout(state.workspace.debounce);
        state.workspace.debounce = window.setTimeout(() => requestWorkspacePreview(section), 350);
    }

    async function requestWorkspacePreview(section) {
        if (!section || !state.apiReady || !state.workspace.rows.length) return;
        const rows = workspacePayloadRows();
        if (!rows.length || workspaceRegion() === "ALL") {
            state.workspace.previewResultsByPackageId.clear();
            state.workspace.previewRows = [];
            renderWorkspaceSummary(section);
            renderWorkspaceGrid(section);
            renderButtons(section);
            return;
        }
        const seq = ++state.workspace.previewSeq;
        state.workspace.activeRequestSequence = seq;
        state.workspace.previewing = true;
        renderWorkspaceSummary(section);
        try {
            const result = await pricingFetch("/api/admin/pricing-engine/workspace/preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows, region: workspaceRegion() })
            });
            if (seq !== state.workspace.previewSeq) return;
            state.workspace.previewResultsByPackageId.clear();
            (Array.isArray(result.rows) ? result.rows : []).forEach(row => {
                state.workspace.previewResultsByPackageId.set(workspacePackageId(row), row);
            });
            clearPreviewForUnstagedRows();
            state.workspace.lastPreviewAt = new Date(result.generatedAt || Date.now()).toLocaleTimeString();
            renderWorkspaceSummary(section, result.summary);
            const mm = state.workspace.previewRows.flatMap(row => row.regions || []).find(item => item.region === "MM" && item.exchangeRate);
            if (mm) {
                setText(section, "#pricingWorkspaceMmkRate", `${mm.supplierCurrency || "THB"} → MMK · ${mm.exchangeRate}`);
                setText(section, "#pricingWorkspaceMmkRateMeta", `${mm.exchangeRateSource || "Production policy"} · rounding applies server-side`);
            }
        } catch (error) {
            if (seq !== state.workspace.previewSeq) return;
            setStatus(section, `Workspace preview failed: ${error.message}`);
        } finally {
            if (seq === state.workspace.previewSeq) {
                state.workspace.previewing = false;
                renderWorkspaceGrid(section);
                renderButtons(section);
            }
        }
    }

    function parseWorkspacePaste(section) {
        const input = section.querySelector("#pricingPasteInput");
        const result = section.querySelector("#pricingPasteResult");
        const lines = String(input?.value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const parsed = [];
        const unmatched = [];
        const duplicates = new Set();
        const seen = new Set();
        lines.forEach((line, index) => {
            const match = line.match(/^(.+?)[,\t ]+([0-9]+(?:\.[0-9]+)?)$/);
            if (!match) {
                unmatched.push(line);
                return;
            }
            const key = match[1].trim().toLowerCase();
            const price = number(match[2], NaN);
            const candidates = state.workspace.rows.filter(item =>
                state.workspace.productFilter === "ALL" || item.productCode === state.workspace.productFilter
            );
            const row = candidates.find(item =>
                item.packageCode.toLowerCase() === key ||
                item.supplierPackageCode?.toLowerCase() === key ||
                item.packageName.toLowerCase() === key
            );
            if (!row || !Number.isFinite(price)) {
                unmatched.push(line);
                return;
            }
            if (seen.has(row.rowId)) duplicates.add(row.rowId);
            seen.add(row.rowId);
            stageWorkspaceRow(row, price);
            parsed.push(row);
        });
        state.workspace.pasteMatches = parsed;
        if (result) result.textContent = `${parsed.length} matched · ${unmatched.length} unmatched · ${duplicates.size} duplicate`;
        renderWorkspaceGrid(section);
        scheduleWorkspacePreview(section);
    }

    function renderWorkspaceReview(section, open = false) {
        const panel = section.querySelector("#pricingReviewPanel");
        const list = section.querySelector("#pricingReviewList");
        const summary = section.querySelector("#pricingReviewSummary");
        if (!panel || !list) return;
        const changed = stagedRows().map(row => ({
            ...row,
            ...(previewForPackageId(workspacePackageId(row)) || {})
        }));
        if (summary) summary.textContent = `${changed.length} packages staged. Blocked rows will be skipped by publish.`;
        list.innerHTML = changed.length ? changed.map(row => `
            <article class="pricing-review-row">
                <strong>${escapeHTML(row.packageName)}</strong>
                <small>${escapeHTML(row.productName)} · ${escapeHTML(row.packageCode)} · ${escapeHTML(row.status)}</small>
                <div class="pricing-detail-line"><span>Supplier cost</span><b>${formatMoney(row.oldSupplierCost, row.supplierCurrency)} → ${formatMoney(row.newSupplierCost, row.supplierCurrency)}</b></div>
                <div class="pricing-detail-line"><span>Selling price</span><b>${escapeHTML((row.regions || []).map(item => `${item.region}: ${formatMoney(item.publishedPrice, item.currency)} → ${item.recommendedSellingPrice == null ? "Unavailable" : formatMoney(item.recommendedSellingPrice, item.currency)}`).join(" · ") || "Preview pending")}</b></div>
                <div class="pricing-detail-line"><span>Profit / margin</span><b>${escapeHTML((row.regions || []).map(item => `${item.region}: ${item.netProfit == null ? "Unknown" : formatMoney(item.netProfit, item.currency)} / ${item.marginPercent == null ? "Unknown" : `${item.marginPercent}%`}`).join(" · ") || "Unknown")}</b></div>
                <div class="pricing-detail-line"><span>Publish eligibility</span><b>${row.publishEligible === true ? "Publishable" : "Blocked or preview pending"}</b></div>
            </article>
        `).join("") : '<p class="empty">No staged pricing changes.</p>';
        if (open) togglePanel(section, "#pricingReviewPanel", true);
    }

    async function publishWorkspace(section, publishAll = false) {
        if (!state.apiReady || state.workspace.publishing) return;
        if (publishAll || workspaceRegion() === "ALL") {
            window.alert("Publish All and All-region publishing are temporarily disabled. Choose Thailand or Myanmar and publish explicit staged rows only.");
            return;
        }
        const rows = workspacePayloadRows({ onlySelected: true });
        if (!rows.length) {
            window.alert("Select at least one staged row to publish.");
            return;
        }
        const publishable = rows.filter(row => {
            const preview = previewForPackageId(workspacePackageId(row));
            return preview?.publishEligible === true &&
                preview.regions?.length === 1 &&
                preview.regions[0]?.region === workspaceRegion() &&
                Number(row.newSupplierCost) === Number(state.workspace.stagedChangesByPackageId.get(workspacePackageId(row))?.newSupplierCost);
        });
        if (!publishable.length) {
            window.alert("Preview the staged rows and resolve blocked items before publishing.");
            return;
        }
        const confirmed = window.confirm(`Publish ${publishable.length} staged ${workspaceRegion()} pricing change${publishable.length === 1 ? "" : "s"}?\n\nThe server will recalculate each row before saving. Failed rows will remain staged for retry.`);
        if (!confirmed) return;
        state.workspace.publishing = true;
        setStatus(section, "Publishing staged pricing changes...");
        renderButtons(section);
        try {
            const result = await pricingFetch("/api/admin/pricing-engine/workspace/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows: publishable, publishAll: false, region: workspaceRegion() })
            }, 30000);
            setStatus(section, `Pricing publish complete: ${result.summary?.published || 0} published, ${result.summary?.failed || 0} failed.`);
            const publishedKeys = new Set((result.results || [])
                .filter(item => item.published)
                .map(item => `${item.productCode}:${item.packageCode}`));
            state.workspace.rows = state.workspace.rows.map(row => {
                if (!publishedKeys.has(row.rowId)) return row;
                const packageId = workspacePackageId(row);
                state.workspace.stagedChangesByPackageId.delete(packageId);
                state.workspace.previewResultsByPackageId.delete(packageId);
                return { ...row, oldSupplierCost: row.newSupplierCost, changed: false, selected: false, status: "Published" };
            });
            clearPreviewForUnstagedRows();
            await requestProductionLoad(section, "workspace-publish");
            renderWorkspaceReview(section, true);
        } catch (error) {
            setStatus(section, `Pricing publish failed: ${error.message}`);
        } finally {
            state.workspace.publishing = false;
            renderButtons(section);
        }
    }

    function togglePanel(section, selector, force) {
        const panel = section.querySelector(selector);
        if (!panel) return;
        panel.hidden = typeof force === "boolean" ? !force : !panel.hidden;
    }

    function promptNumber(label, currentValue, options = {}) {
        const next = window.prompt(label, String(currentValue ?? 0));
        if (next === null) return null;
        const parsed = Number(next);
        if (!Number.isFinite(parsed) || parsed < 0) {
            window.alert(options.message || "Enter a valid non-negative number.");
            return null;
        }
        if (options.positive && parsed <= 0) {
            window.alert(options.message || "Enter a number greater than zero.");
            return null;
        }
        if (options.percent && parsed > 100) {
            window.alert("Percent values must be between 0 and 100.");
            return null;
        }
        return parsed;
    }

    function editDraftValue(section, field) {
        const selectedPackage = getSelectedPackage();
        const policy = getDraftPolicy(selectedPackage.region, selectedPackage.currency);
        const config = policy.config;
        const edits = {
            exchangeRate: ["Exchange rate", () => config.exchangeRate, value => { config.exchangeRate = value; }, { positive: true }],
            supplierFee: ["Exchange fee percent", () => config.supplierFee.value, value => {
                config.supplierFee = { enabled: value > 0, type: "PERCENT", value };
            }, { percent: true }],
            gatewayFee: ["Gateway fee percent", () => config.gatewayFee.value, value => {
                config.gatewayFee = { enabled: value > 0, type: "PERCENT", value };
            }, { percent: true }],
            platformFee: ["Platform fee", () => config.platformCost.value, value => {
                config.platformCost = { enabled: value > 0, type: "FIXED", value };
            }],
            profit: ["Profit percent", () => config.profitRule.value, value => {
                config.profitRule = { type: "PERCENT", value };
            }, { percent: true }],
            rounding: ["Rounding increment", () => config.roundingRule.increment, value => {
                config.roundingRule = { enabled: value > 0, mode: value > 0 ? "NEAREST" : "NONE", increment: value, psychologicalEnding: 0 };
            }]
        };
        const edit = edits[field];
        if (!edit) return;
        const value = promptNumber(edit[0], edit[1](), edit[3] || {});
        if (value === null) return;
        edit[2](value);
        state.dirty = true;
        state.saveError = "";
        state.publishError = "";
        calculateAndRenderPreview(section);
    }

    function buildEngineInput() {
        const selectedProduct = getSelectedProduct();
        const selectedPackage = getSelectedPackage();
        if (!selectedPackage.packageId) throw new Error("Failed to calculate preview: package id missing.");
        if (!selectedPackage.packageCode) throw new Error("Failed to calculate preview: package code missing.");
        const supplierCost = positiveAmount(selectedPackage.supplierPrice, "package supplier cost");
        const config = getDraftPolicy(selectedPackage.region, selectedPackage.currency).config;
        const exchangeRate = selectedPackage.supplierCurrency === selectedPackage.currency
            ? undefined
            : {
                rate: positiveAmount(config.exchangeRate || selectedPackage.exchangeRate, "exchange rate"),
                sourceCurrency: selectedPackage.supplierCurrency,
                targetCurrency: selectedPackage.currency,
                source: "admin-production-draft"
            };
        const appliedPricingRules = [];
        if (selectedPackage.publishedPriceMode !== "POLICY_DERIVED" && Number.isFinite(Number(selectedPackage.publishedPrice))) {
            appliedPricingRules.push({
                code: `${selectedPackage.publishedPriceMode || "LEGACY_COMPATIBILITY_PRICE"}:${selectedPackage.packageCode}:${selectedPackage.region}`,
                ruleType: "PRICE_OVERRIDE",
                value: Number(selectedPackage.publishedPrice),
                priority: 1000,
                scopeType: "PACKAGE",
                scopeReference: selectedPackage.packageCode,
                stopFurtherProcessing: true,
                configuration: {
                    source: "catalog_package.price",
                    publishedPriceMode: selectedPackage.publishedPriceMode,
                    manualOverrideReason: selectedPackage.manualOverrideReason || "Legacy catalog selling price preserved during pricing-policy migration.",
                    currency: selectedPackage.currency
                }
            });
        }

        return {
            supplierCost,
            supplierCurrency: selectedPackage.supplierCurrency,
            targetCurrency: selectedPackage.currency,
            exchangeRate,
            policy: {
                supplierFee: config.supplierFee,
                businessCost: config.businessCost,
                profitRule: config.profitRule,
                gatewayFee: config.gatewayFee,
                platformCost: config.platformCost,
                tax: config.tax,
                roundingRule: config.roundingRule
            },
            context: {
                region: selectedPackage.region,
                currency: selectedPackage.currency,
                packageId: selectedPackage.packageId,
                packageCode: selectedPackage.packageCode,
                gameId: selectedProduct.productCode,
                gameCode: selectedProduct.productCode
            },
            appliedPricingRules
        };
    }

    function calculatePreview() {
        const engine = window.AZIEL_COMMERCE_PRICING_ENGINE;
        if (!engine?.calculateBasePrice) throw new Error("Failed to calculate preview: Commerce calculation engine is not loaded.");
        return engine.calculateBasePrice(buildEngineInput());
    }

    function calculateAndRenderPreview(section) {
        const seq = ++state.renderSeq;
        state.calculating = true;
        state.previewError = "";
        trace("PREVIEW render labels started", { seq });
        renderStaticLabels(section);
        try {
            const result = calculatePreview();
            if (seq !== state.renderSeq) return;
            state.preview = result;
            trace("PREVIEW calculation finished", { seq });
            renderFlow(section, result);
            renderBreakdown(section, result);
            setText(section, "#pricingStorefrontPrice", formatMoney(result.regularPrice, result.currency));
            window.AZIEL_PRICING_ENGINE_PRODUCTION_PREVIEW = Object.freeze({
                selectedProductId: state.selectedProductId,
                selectedPackageId: state.selectedPackageId,
                policy: clone(getDraftPolicy(getSelectedPackage().region, getSelectedPackage().currency).config),
                lastResult: result
            });
        } catch (error) {
            if (seq !== state.renderSeq) return;
            state.preview = null;
            state.previewError = error.message || "Failed to calculate preview.";
            renderError(section, state.previewError);
            trace("PREVIEW failed", { seq, message: state.previewError });
        } finally {
            if (seq === state.renderSeq) {
                state.calculating = false;
                renderButtons(section);
                renderStatus(section);
                trace("PREVIEW render finished", { seq });
            }
        }
    }

    function formatMoney(value, currency) {
        if (value == null || value === "" || !Number.isFinite(Number(value))) return `— ${currency || getSelectedPackage().currency}`;
        const numeric = Number(value || 0);
        return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency || getSelectedPackage().currency}`;
    }

    function formatPercent(value) {
        return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    }

    function setText(section, selector, value) {
        const node = section.querySelector(selector);
        if (node) node.textContent = value;
    }

    function renderStaticLabels(section) {
        const product = getSelectedProduct();
        const pkg = getSelectedPackage();
        const config = getDraftPolicy(pkg.region, pkg.currency).config;
        const scope = section.querySelector("#pricingScopeSelector")?.value || "REGION";
        const modeLabel = pkg.publishedPriceMode === "POLICY_DERIVED"
            ? "Policy derived"
            : pkg.publishedPriceMode === "MANUAL_OVERRIDE"
                ? "Manual override"
                : "Legacy compatibility price";
        setText(section, "#pricingRulesSubtitle", `${product.productName} · ${pkg.packageName}. ${state.dirty ? "Unsaved draft." : "Draft loaded."}`);
        setText(section, "#pricingPreviewProduct", `${product.productName} · ${pkg.region} · ${pkg.currency}`);
        setText(section, "#pricingStorefrontProduct", product.productName);
        setText(section, "#pricingStorefrontPackage", pkg.packageName);
        setText(section, "#pricingEffectiveSource", scope === "REGION" ? `${pkg.region} policy` : `${scope.charAt(0)}${scope.slice(1).toLowerCase()} view`);
        setText(section, "#pricingPublishedMode", modeLabel);
        setText(section, "#pricingRuleExchangeValue", pkg.supplierCurrency === pkg.currency ? "1.00" : String(config.exchangeRate || pkg.exchangeRate || 1));
        setText(section, "#pricingRuleSupplierFeeValue", formatPercent(config.supplierFee?.value));
        setText(section, "#pricingRuleGatewayValue", formatPercent(config.gatewayFee?.value));
        setText(section, "#pricingRulePlatformValue", formatMoney(config.platformCost?.value, pkg.currency));
        setText(section, "#pricingRuleProfitValue", formatPercent(config.profitRule?.value));
        setText(section, "#pricingRuleRoundValue", config.roundingRule?.enabled ? `Nearest ${config.roundingRule.increment}` : "None");
        setText(section, "#pricingSummaryExchange", pkg.supplierCurrency === pkg.currency ? "Same currency" : `${pkg.supplierCurrency} × ${config.exchangeRate || pkg.exchangeRate || 1}`);
        setText(section, "#pricingSummaryProfit", formatPercent(config.profitRule?.value));
        setText(section, "#pricingSummaryGateway", formatPercent(config.gatewayFee?.value));
        setText(section, "#pricingSummaryPackages", String(state.affected?.packagesAffected || state.products.reduce((sum, item) => sum + item.packages.length, 0)));
        setText(section, "#pricingSummaryPackagesMeta", `${state.affected?.productsAffected || state.products.length} products · ${(state.affected?.currenciesAffected || []).join(", ") || pkg.currency}`);
        renderStatus(section);
    }

    function pricingStep(label, value, total, totalClass = "") {
        return `
            <div class="${totalClass}">
                <span>${escapeHTML(label)}</span>
                <b>${escapeHTML(value)}</b>
                <small>${escapeHTML(total)}</small>
            </div>
        `;
    }

    function renderFlow(section, result) {
        const flow = section.querySelector("#pricingFlow");
        if (!flow) return;
        const pkg = getSelectedPackage();
        const overrideApplied = result.preOverridePrice != null;
        const rows = [
            pricingStep("Supplier Cost", formatMoney(result.supplierCost, result.supplierCurrency), formatMoney(result.supplierCost, result.supplierCurrency)),
            pricingStep("Exchange", result.exchangeRateApplied ? `× ${result.exchangeRateApplied}` : "Same currency", formatMoney(result.postExchangeSubtotal, result.currency)),
            pricingStep("Exchange Fee", formatMoney(result.supplierFeeAmount, result.currency), formatMoney(result.breakdown.find(item => item.stageId === "SUPPLIER_FEE")?.outputAmount, result.currency)),
            pricingStep("Business Cost", formatMoney(result.businessCostAmount, result.currency), formatMoney(result.breakdown.find(item => item.stageId === "BUSINESS_COST")?.outputAmount, result.currency)),
            pricingStep("Gateway Fee", formatMoney(result.gatewayFeeAmount, result.currency), formatMoney(result.breakdown.find(item => item.stageId === "GATEWAY_FEE")?.outputAmount, result.currency)),
            pricingStep("Platform Fee", formatMoney(result.platformFeeAmount, result.currency), formatMoney(result.breakdown.find(item => item.stageId === "PLATFORM_FEE")?.outputAmount, result.currency)),
            pricingStep("Profit", formatMoney(result.profitAmount, result.currency), formatMoney(result.breakdown.find(item => item.stageId === "PROFIT")?.outputAmount, result.currency)),
            pricingStep("Tax", formatMoney(result.taxAmount, result.currency), formatMoney(result.breakdown.find(item => item.stageId === "TAX")?.outputAmount, result.currency)),
            pricingStep("Recommended Price", formatMoney(result.preOverridePrice ?? result.regularPrice, result.currency), "Policy output"),
            pricingStep(overrideApplied ? "Published Override" : "Published Price", formatMoney(result.regularPrice, result.currency), overrideApplied ? (pkg.manualOverrideReason || pkg.publishedPriceMode) : "Policy derived"),
            pricingStep("Customer Price", formatMoney(result.regularPrice, result.currency), "Live Preview", "pricing-flow-total")
        ];
        flow.innerHTML = rows.join('<i class="fa-solid fa-arrow-down" aria-hidden="true"></i>');
        const errorBox = section.querySelector("#pricingSimulationError");
        if (errorBox) {
            errorBox.hidden = true;
            errorBox.textContent = "";
        }
    }

    function renderBreakdown(section, result) {
        const box = section.querySelector("#pricingBreakdown");
        if (!box) return;
        box.innerHTML = `
            <h4>Engine Breakdown</h4>
            ${result.breakdown.map(item => `
                <div class="pricing-breakdown-row" data-stage-id="${escapeHTML(item.stageId)}">
                    <span>${escapeHTML(item.stageId)}</span>
                    <b>${escapeHTML(formatMoney(item.amountAdded || 0, item.currency))}</b>
                    <small>${escapeHTML(formatMoney(item.outputAmount, item.currency))}</small>
                </div>
            `).join("")}
        `;
    }

    function renderError(section, message) {
        const errorBox = section.querySelector("#pricingSimulationError");
        const flow = section.querySelector("#pricingFlow");
        const breakdown = section.querySelector("#pricingBreakdown");
        if (errorBox) {
            errorBox.hidden = false;
            errorBox.textContent = message || "Pricing Engine error.";
        }
        if (flow) flow.innerHTML = "";
        if (breakdown) breakdown.innerHTML = "";
        setText(section, "#pricingStorefrontPrice", "Unavailable");
    }

    function renderLoadError(section, message) {
        const errorBox = section.querySelector("#pricingSimulationError");
        if (errorBox) {
            errorBox.hidden = false;
            errorBox.innerHTML = `
                <span>${escapeHTML(message || state.loadError || "Production pricing data is unavailable.")}</span>
                <button id="pricingRetryLoadBtn" class="admin-secondary-btn" type="button">Retry</button>
            `;
        }
    }

    function payloadPolicies() {
        return [...state.draftPolicy.values()].map(policy => ({
            region: policy.region,
            currency: policy.currency,
            config: clone(policy.config)
        }));
    }

    function applyServerState(data) {
        if (data.version || data.activeVersion) state.activeVersion = data.version || data.activeVersion;
        if (data.affected) state.affected = data.affected;
        if (Array.isArray(data.products) && data.products.length) state.products = normalizeProducts(data);
        (data.policies || []).forEach(item => {
            const region = item.region || item.active?.region || item.draft?.region;
            const currency = item.currency || item.active?.currency || item.draft?.currency;
            if (!region || !currency) return;
            if (item.active) {
                state.activePolicy.set(policyKey(region, currency), {
                    region,
                    currency,
                    config: normalizeConfig(item.active.config, region),
                    source: item.active.source || "active"
                });
            }
            if (item.draft || item.active) {
                const source = item.draft?.config ? item.draft : item.active;
                state.draftPolicy.set(policyKey(region, currency), {
                    region,
                    currency,
                    config: normalizeConfig(source?.config, region),
                    source: source?.source || "active-copy"
                });
            }
        });
    }

    async function saveDraft(section) {
        if (state.saving || state.publishing) return false;
        if (!canPersistPricing()) {
            state.saveError = state.loadError
                ? "Save Draft is disabled until production pricing data loads."
                : "Save Draft is disabled until a valid product preview is ready.";
            renderLoadError(section, state.saveError);
            setStatus(section, "Save disabled");
            renderButtons(section);
            return false;
        }
        state.saving = true;
        state.saveError = "";
        const button = section.querySelector("#pricingSaveDraftBtn");
        const originalText = button?.textContent || "Save Draft";
        if (button) {
            button.disabled = true;
            button.textContent = "Saving draft...";
        }
        setStatus(section, "Saving draft...");
        try {
            const data = await pricingFetch("/api/admin/pricing-engine/draft", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ policies: payloadPolicies() })
            });
            applyServerState(data.state || data);
            state.dirty = false;
            setStatus(section, "Draft saved");
            calculateAndRenderPreview(section);
            return true;
        } catch (error) {
            state.saveError = `Failed to save draft: ${error.message}`;
            renderError(section, state.saveError);
            setStatus(section, "Draft save failed");
            return false;
        } finally {
            state.saving = false;
            if (button) button.textContent = originalText;
            renderButtons(section);
        }
    }

    async function publishDraft(section) {
        if (state.publishing || state.saving) return;
        const role = String(window.AZIEL_ADMIN_AUTH?.state?.admin?.role || localStorage.getItem("adminRole") || "").toUpperCase();
        if (role !== "OWNER") {
            state.publishError = "Failed to publish: OWNER permission required.";
            renderError(section, state.publishError);
            setStatus(section, "Owner only");
            return;
        }
        if (!canPersistPricing()) {
            state.publishError = state.loadError
                ? "Publish is disabled until production pricing data loads."
                : "Publish is disabled until a valid product preview is ready.";
            renderLoadError(section, state.publishError);
            setStatus(section, "Publish disabled");
            renderButtons(section);
            return;
        }
        const confirmed = window.confirm("Publish Pricing Version?\n\nFuture customer quotes will immediately use these rules.\nExisting orders will remain unchanged.");
        if (!confirmed) return;
        if (state.dirty) {
            const saved = await saveDraft(section);
            if (!saved) return;
        }

        state.publishing = true;
        state.publishError = "";
        const button = section.querySelector("#pricingPublishBtn");
        const originalText = button?.textContent || "Publish";
        if (button) {
            button.disabled = true;
            button.textContent = "Publishing...";
        }
        setStatus(section, "Publishing...");
        try {
            const data = await pricingFetch("/api/admin/pricing-engine/publish", { method: "POST" });
            applyServerState(data.state || {});
            state.activeVersion = data.version || state.activeVersion;
            state.dirty = false;
            setStatus(section, `Production Active · v${state.activeVersion?.versionNumber || ""}`);
            calculateAndRenderPreview(section);
        } catch (error) {
            state.publishError = `Failed to publish: ${error.message}`;
            renderError(section, state.publishError);
            setStatus(section, "Publish failed");
        } finally {
            state.publishing = false;
            if (button) button.textContent = originalText;
            renderButtons(section);
            renderStatus(section);
        }
    }

    function setStatus(section, message) {
        const status = section.querySelector("#pricingProductionStatus");
        if (status) status.textContent = message;
    }

    function renderButtons(section) {
        const save = section.querySelector("#pricingSaveDraftBtn");
        const publish = section.querySelector("#pricingPublishBtn");
        const workspacePublishSelected = section.querySelector("#pricingWorkspacePublishSelectedBtn");
        const workspacePublishAll = section.querySelector("#pricingWorkspacePublishAllBtn");
        const role = String(window.AZIEL_ADMIN_AUTH?.state?.admin?.role || localStorage.getItem("adminRole") || "").toUpperCase();
        const canManage = window.AZIEL_ADMIN_AUTH?.hasPermission?.("CATALOG_MANAGE") !== false;
        const canPersist = canPersistPricing();
        const workspaceBusy = state.workspace.previewing || state.workspace.publishing;
        const workspaceReady = state.apiReady && state.workspace.rows.length > 0;
        const hasPublishableWorkspaceRows = stagedRows().some(row => {
            const preview = previewForPackageId(workspacePackageId(row));
            return row.selected !== false && preview?.publishEligible === true && preview.regions?.[0]?.region === workspaceRegion();
        });
        if (save) {
            save.disabled = !canManage || !canPersist;
            save.title = canManage
                ? (canPersist ? "Save pricing draft" : "Production pricing must load before saving")
                : "Catalog manage permission required";
        }
        if (publish) {
            publish.disabled = role !== "OWNER" || !canPersist;
            publish.title = role === "OWNER"
                ? (canPersist ? "Publish production pricing" : "Production pricing must load before publishing")
                : "Only OWNER can publish production pricing";
        }
        if (workspacePublishSelected) {
            workspacePublishSelected.disabled = role !== "OWNER" || !canManage || !workspaceReady || workspaceBusy || !hasPublishableWorkspaceRows || workspaceRegion() === "ALL";
            workspacePublishSelected.title = role === "OWNER"
                ? (hasPublishableWorkspaceRows ? "Publish explicit staged pricing changes" : "Stage and preview at least one publishable row")
                : "Only OWNER can publish pricing workspace changes";
        }
        if (workspacePublishAll) {
            workspacePublishAll.disabled = true;
            workspacePublishAll.title = "Publish All is temporarily disabled until region-specific daily workflows are stable.";
        }
    }

    function renderStatus(section) {
        if (state.loading || state.saving || state.publishing) return;
        if (state.loadError && !state.apiReady) {
            setStatus(section, "Pricing workspace failed to load");
            setText(section, "#pricingSummaryExchangeMeta", "Local preview only");
            setText(section, "#pricingSummaryProfitMeta", "Save disabled");
            setText(section, "#pricingSummaryGatewayMeta", "Publish disabled");
            return;
        }
        const version = state.activeVersion;
        setStatus(section, version ? `Production Active · v${version.versionNumber}` : "Production Ready");
        setText(section, "#pricingSummaryExchangeMeta", version?.publishedAt ? `Published ${new Date(version.publishedAt).toLocaleString()}` : "Production configuration");
        setText(section, "#pricingSummaryProfitMeta", version?.publishedBy ? `Published by ${version.publishedBy}` : "Draft preview");
        setText(section, "#pricingSummaryGatewayMeta", state.dirty ? "Unsaved draft" : "Draft editable");
    }

    window.AZIEL_ADMIN_PRICING_ENGINE = {
        _state: state,
        loadProductionState: () => requestProductionLoad(document.getElementById("section-pricing-engine"), "public-api"),
        selectProduct: productId => selectProduct(document.getElementById("section-pricing-engine"), productId),
        saveDraft: () => saveDraft(document.getElementById("section-pricing-engine")),
        publishDraft: () => publishDraft(document.getElementById("section-pricing-engine")),
        previewWorkspace: () => requestWorkspacePreview(document.getElementById("section-pricing-engine")),
        publishWorkspace: publishAll => publishWorkspace(document.getElementById("section-pricing-engine"), publishAll === true),
        parseWorkspacePaste: () => parseWorkspacePaste(document.getElementById("section-pricing-engine")),
        hydrateFallbackProductsFromDom: () => hydrateFallbackProductsFromDom(document.getElementById("section-pricing-engine")),
        canPersistPricing
    };
})();
