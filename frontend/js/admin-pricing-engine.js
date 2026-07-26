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
        loadError: "",
        previewError: "",
        saveError: "",
        publishError: "",
        renderSeq: 0,
        loadPromise: null
    };
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
        section.querySelector("#pricingProductSearch")?.addEventListener("input", event => filterProducts(section, event.target.value || ""));
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
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
        trace("FETCH started", { url, timeoutMs });
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
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
            window.clearTimeout(timeout);
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
                productId: String(product.productId || product.productCode || product.productName || "").toLowerCase(),
                productCode: String(product.productCode || product.productId || "").toLowerCase(),
                productName: product.productName || product.productCode || "Product",
                packages: (product.packages || []).map(normalizePackage).filter(Boolean)
            })).filter(product => product.productId && product.packages.length);
        }
        const grouped = new Map();
        raw.map(normalizePackage).filter(Boolean).forEach(pkg => {
            const productId = String(pkg.productCode || pkg.productName || "product").toLowerCase();
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
        const supplierPrice = number(pkg.supplierPrice ?? pkg.amount, NaN);
        if (!Number.isFinite(supplierPrice)) return null;
        return {
            packageId: String(pkg.packageId || pkg.packageRef || pkg.packageCode || "").trim(),
            packageCode: String(pkg.packageCode || pkg.packageId || "").trim(),
            packageName: String(pkg.packageName || pkg.name || pkg.packageCode || "Package").trim(),
            productCode: String(pkg.productCode || "").toLowerCase(),
            productName: String(pkg.productName || pkg.gameName || pkg.productCode || "Product").trim(),
            region: String(pkg.region || "TH").toUpperCase(),
            currency: String(pkg.currency || "THB").toUpperCase(),
            supplierCurrency: String(pkg.supplierCurrency || pkg.currency || "THB").toUpperCase(),
            supplierPrice,
            exchangeRate: Math.max(0, number(pkg.exchangeRate, 1))
        };
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
        state.loading = true;
        state.loadError = "";
        setStatus(section, "Loading production pricing...");
        renderButtons(section);
        try {
            await waitForAdminAuthReady();
            const data = await pricingFetch("/api/admin/pricing-engine");
            trace("STATE populate started");
            state.products = normalizeProducts(data);
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
            const firstProduct = state.products[0] || FALLBACK_PRODUCT;
            state.selectedProductId = state.selectedProductId || firstProduct.productId;
            const selectedProduct = getSelectedProduct();
            state.selectedPackageId = state.selectedPackageId || selectedProduct.packages[0]?.packageId || "";
            state.dirty = false;
            trace("STATE populated", { productCount: state.products.length, packageCount: state.products.reduce((sum, item) => sum + item.packages.length, 0) });
            trace("RENDER products started");
            renderProducts(section);
            trace("RENDER products finished");
            trace("PREVIEW started");
            calculateAndRenderPreview(section);
            trace("PREVIEW finished");
        } catch (error) {
            state.loadError = `Failed to load pricing: ${error.message}`;
            renderError(section, state.loadError);
            setStatus(section, "Pricing unavailable");
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
            return `
                <button class="catalog-product-row pricing-product-row ${selected ? "active" : ""}" type="button"
                    aria-pressed="${selected ? "true" : "false"}"
                    data-pricing-product-id="${escapeHTML(product.productId)}"
                    data-pricing-package-id="${escapeHTML(defaultPackage.packageId)}"
                    data-pricing-product="${escapeHTML(product.productName)}"
                    data-pricing-package="${escapeHTML(defaultPackage.packageName)}">
                    <span>
                        <strong>${escapeHTML(product.productName)}</strong>
                        <small>${escapeHTML(defaultPackage.packageName)}</small>
                    </span>
                    <span class="catalog-row-meta">
                        <b>${escapeHTML(defaultPackage.packageCode || product.productCode)}</b>
                        <small>${escapeHTML(defaultPackage.region)} / ${escapeHTML(defaultPackage.currency)}</small>
                    </span>
                </button>
            `;
        }).join("");
    }

    function selectProduct(section, productId, packageId = "") {
        const product = state.products.find(item => item.productId === productId);
        if (!product) return;
        state.selectedProductId = product.productId;
        state.selectedPackageId = packageId || product.packages[0]?.packageId || "";
        renderProducts(section);
        calculateAndRenderPreview(section);
    }

    function filterProducts(section, query) {
        const normalized = query.trim().toLowerCase();
        section.querySelectorAll("[data-pricing-product-id]").forEach(row => {
            const haystack = `${row.dataset.pricingProduct || ""} ${row.dataset.pricingPackage || ""} ${row.textContent || ""}`.toLowerCase();
            row.hidden = Boolean(normalized) && !haystack.includes(normalized);
        });
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
            }
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
        setText(section, "#pricingRulesSubtitle", `${product.productName} · ${pkg.packageName}. ${state.dirty ? "Unsaved draft." : "Draft loaded."}`);
        setText(section, "#pricingPreviewProduct", `${product.productName} · ${pkg.region} · ${pkg.currency}`);
        setText(section, "#pricingStorefrontProduct", product.productName);
        setText(section, "#pricingStorefrontPackage", pkg.packageName);
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
        const rows = [
            pricingStep("Supplier Price", formatMoney(result.supplierCost, result.supplierCurrency), formatMoney(result.supplierCost, result.supplierCurrency)),
            pricingStep("Exchange", result.exchangeRateApplied ? `× ${result.exchangeRateApplied}` : "Same currency", formatMoney(result.postExchangeSubtotal, result.currency)),
            pricingStep("Supplier Fee", formatMoney(result.supplierFeeAmount, result.supplierCurrency), formatMoney(result.breakdown.find(item => item.stageId === "SUPPLIER_FEE")?.outputAmount, result.supplierCurrency)),
            pricingStep("Business Cost", formatMoney(result.businessCostAmount, result.supplierCurrency), formatMoney(result.costBeforeProfit, result.supplierCurrency)),
            pricingStep("Gateway Fee", formatMoney(result.gatewayFeeAmount, result.currency), formatMoney(result.breakdown.find(item => item.stageId === "GATEWAY_FEE")?.outputAmount, result.currency)),
            pricingStep("Platform Fee", formatMoney(result.platformFeeAmount, result.currency), formatMoney(result.breakdown.find(item => item.stageId === "PLATFORM_FEE")?.outputAmount, result.currency)),
            pricingStep("Profit", formatMoney(result.profitAmount, result.supplierCurrency), formatMoney(result.preExchangeSubtotal, result.supplierCurrency)),
            pricingStep("Tax", formatMoney(result.taxAmount, result.currency), formatMoney(result.breakdown.find(item => item.stageId === "TAX")?.outputAmount, result.currency)),
            pricingStep("Round", formatMoney(result.regularPrice - result.preRoundingPrice, result.currency), formatMoney(result.regularPrice, result.currency)),
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
        const role = String(window.AZIEL_ADMIN_AUTH?.state?.admin?.role || localStorage.getItem("adminRole") || "").toUpperCase();
        const canManage = window.AZIEL_ADMIN_AUTH?.hasPermission?.("CATALOG_MANAGE") !== false;
        if (save) save.disabled = !canManage || state.loading || state.saving || state.publishing;
        if (publish) {
            publish.disabled = role !== "OWNER" || state.loading || state.saving || state.publishing;
            publish.title = role === "OWNER" ? "Publish production pricing" : "Only OWNER can publish production pricing";
        }
    }

    function renderStatus(section) {
        if (state.loading || state.saving || state.publishing) return;
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
        publishDraft: () => publishDraft(document.getElementById("section-pricing-engine"))
    };
})();
