(function () {
    const FALLBACK_PRODUCT = Object.freeze({
        productCode: "mlbb",
        productName: "Mobile Legends",
        packageId: "MLBB_7740",
        packageCode: "MLBB_7740",
        packageName: "7740 + 1548 Diamonds",
        region: "TH",
        currency: "THB",
        supplierCurrency: "THB",
        supplierPrice: 1120,
        exchangeRate: 1
    });

    const state = {
        products: [],
        policies: new Map(),
        selectedProduct: { ...FALLBACK_PRODUCT },
        version: null,
        affected: null,
        dirty: false,
        loading: false
    };

    document.addEventListener("DOMContentLoaded", initPricingEngineUi);
    window.addEventListener("aziel:admin-auth-ready", () => {
        const section = document.getElementById("section-pricing-engine");
        if (section?.dataset.pricingEngineBound === "true") loadProductionState(section);
    });

    function initPricingEngineUi() {
        const section = document.getElementById("section-pricing-engine");
        if (!section || section.dataset.pricingEngineBound === "true") return;
        section.dataset.pricingEngineBound = "true";

        section.querySelectorAll("[data-pricing-edit]").forEach(button => {
            button.addEventListener("click", () => editDraftValue(section, button.dataset.pricingEdit));
        });

        section.querySelector("#pricingProductSearch")?.addEventListener("input", event => {
            filterProducts(section, event.target.value || "");
        });

        section.querySelector("#pricingSaveDraftBtn")?.addEventListener("click", () => saveDraft(section));
        section.querySelector("#pricingPublishBtn")?.addEventListener("click", () => publishDraft(section));

        setPublishAvailability(section);
        loadProductionState(section);
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
        return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
    }

    function policyKey(region, currency) {
        return `${String(region || "").toUpperCase()}:${String(currency || "").toUpperCase()}`;
    }

    function currentPolicy() {
        const key = policyKey(state.selectedProduct.region, state.selectedProduct.currency);
        if (!state.policies.has(key)) {
            state.policies.set(key, {
                region: state.selectedProduct.region,
                currency: state.selectedProduct.currency,
                config: neutralConfig(state.selectedProduct.region)
            });
        }
        return state.policies.get(key);
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

    function cloneConfig(config) {
        return JSON.parse(JSON.stringify(config || neutralConfig()));
    }

    async function loadProductionState(section) {
        if (state.loading) return;
        state.loading = true;
        setStatus(section, "Loading production pricing...");
        try {
            const data = await adminFetch("/api/admin/pricing-engine");
            if (!data?.success) throw new Error(data?.message || "Pricing configuration failed to load.");

            state.version = data.version || null;
            state.affected = data.affected || null;
            state.products = Array.isArray(data.products) && data.products.length ? data.products : [{ ...FALLBACK_PRODUCT }];
            state.policies.clear();
            (data.policies || []).forEach(item => {
                const draft = item.draft?.config ? item.draft : item.active;
                const region = item.region || draft?.region;
                const currency = item.currency || draft?.currency;
                state.policies.set(policyKey(region, currency), {
                    region,
                    currency,
                    config: cloneConfig(draft?.config || neutralConfig(region))
                });
            });
            state.selectedProduct = { ...state.products[0] };
            state.dirty = false;
            renderProducts(section);
            renderProductionStatus(section);
            syncPricingPreview(section);
        } catch (error) {
            renderError(section, error);
            setStatus(section, "Pricing unavailable");
        } finally {
            state.loading = false;
        }
    }

    function renderProducts(section) {
        const list = section.querySelector("#pricingProductList");
        if (!list) return;
        list.innerHTML = state.products.map((product, index) => `
            <button class="catalog-product-row pricing-product-row ${index === 0 ? "active" : ""}" type="button"
                data-pricing-index="${index}"
                data-pricing-product="${escapeHTML(product.productName)}"
                data-pricing-package="${escapeHTML(product.packageName)}">
                <span>
                    <strong>${escapeHTML(product.productName)}</strong>
                    <small>${escapeHTML(product.packageName)}</small>
                </span>
                <span class="catalog-row-meta">
                    <b>${escapeHTML(product.packageCode || product.productCode)}</b>
                    <small>${escapeHTML(product.region)} / ${escapeHTML(product.currency)}</small>
                </span>
            </button>
        `).join("");
        list.querySelectorAll("[data-pricing-index]").forEach(button => {
            button.addEventListener("click", () => selectProduct(section, Number(button.dataset.pricingIndex || 0)));
        });
    }

    function selectProduct(section, index) {
        state.selectedProduct = { ...(state.products[index] || state.products[0] || FALLBACK_PRODUCT) };
        section.querySelectorAll("[data-pricing-index]").forEach(row => {
            const active = Number(row.dataset.pricingIndex || 0) === index;
            row.classList.toggle("active", active);
            row.setAttribute("aria-pressed", active ? "true" : "false");
        });
        syncPricingPreview(section);
    }

    function filterProducts(section, query) {
        const normalized = query.trim().toLowerCase();
        section.querySelectorAll("[data-pricing-index]").forEach(row => {
            const haystack = `${row.dataset.pricingProduct || ""} ${row.dataset.pricingPackage || ""} ${row.textContent || ""}`.toLowerCase();
            row.hidden = Boolean(normalized) && !haystack.includes(normalized);
        });
    }

    function promptNumber(label, currentValue) {
        const next = window.prompt(label, String(currentValue));
        if (next === null) return null;
        const parsed = Number(next);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }

    function editDraftValue(section, field) {
        const policy = currentPolicy();
        const config = policy.config;
        const edits = {
            exchangeRate: ["Exchange rate", () => config.exchangeRate, value => { config.exchangeRate = value; }],
            supplierFee: ["Exchange fee percent", () => config.supplierFee.value, value => {
                config.supplierFee = { enabled: value > 0, type: "PERCENT", value };
            }],
            gatewayFee: ["Gateway fee percent", () => config.gatewayFee.value, value => {
                config.gatewayFee = { enabled: value > 0, type: "PERCENT", value };
            }],
            platformFee: ["Platform fee", () => config.platformCost.value, value => {
                config.platformCost = { enabled: value > 0, type: "FIXED", value };
            }],
            profit: ["Profit percent", () => config.profitRule.value, value => {
                config.profitRule = { type: "PERCENT", value };
            }],
            rounding: ["Rounding increment", () => config.roundingRule.increment, value => {
                config.roundingRule = { enabled: value > 0, mode: value > 0 ? "NEAREST" : "NONE", increment: value, psychologicalEnding: 0 };
            }]
        };
        const edit = edits[field];
        if (!edit) return;
        const value = promptNumber(edit[0], edit[1]());
        if (value === null) return;
        edit[2](value);
        state.dirty = true;
        syncPricingPreview(section);
    }

    function buildEngineInput() {
        const product = state.selectedProduct;
        const config = currentPolicy().config;
        const exchangeRate = product.supplierCurrency === product.currency
            ? undefined
            : {
                rate: config.exchangeRate || product.exchangeRate || 1,
                sourceCurrency: product.supplierCurrency,
                targetCurrency: product.currency,
                source: "admin-production-draft"
            };

        return {
            supplierCost: number(product.supplierPrice),
            supplierCurrency: product.supplierCurrency,
            targetCurrency: product.currency,
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
                region: product.region,
                currency: product.currency,
                packageId: product.packageId,
                packageCode: product.packageCode,
                gameId: product.productCode,
                gameCode: product.productCode
            }
        };
    }

    function calculatePreview() {
        const engine = window.AZIEL_COMMERCE_PRICING_ENGINE;
        if (!engine?.calculateBasePrice) throw new Error("Commerce calculation engine is not loaded.");
        return engine.calculateBasePrice(buildEngineInput());
    }

    function formatMoney(value, currency) {
        const numeric = Number(value || 0);
        return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency || state.selectedProduct.currency}`;
    }

    function formatPercent(value) {
        return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    }

    function setText(section, selector, value) {
        const node = section.querySelector(selector);
        if (node) node.textContent = value;
    }

    function renderRuleValues(section) {
        const product = state.selectedProduct;
        const config = currentPolicy().config;
        setText(section, "#pricingRuleExchangeValue", product.supplierCurrency === product.currency ? "1.00" : String(config.exchangeRate || product.exchangeRate || 1));
        setText(section, "#pricingRuleSupplierFeeValue", formatPercent(config.supplierFee?.value));
        setText(section, "#pricingRuleGatewayValue", formatPercent(config.gatewayFee?.value));
        setText(section, "#pricingRulePlatformValue", formatMoney(config.platformCost?.value, product.currency));
        setText(section, "#pricingRuleProfitValue", formatPercent(config.profitRule?.value));
        setText(section, "#pricingRuleRoundValue", config.roundingRule?.enabled ? `Nearest ${config.roundingRule.increment}` : "None");
        setText(section, "#pricingSummaryExchange", product.supplierCurrency === product.currency ? "Same currency" : `${product.supplierCurrency} × ${config.exchangeRate || product.exchangeRate || 1}`);
        setText(section, "#pricingSummaryProfit", formatPercent(config.profitRule?.value));
        setText(section, "#pricingSummaryGateway", formatPercent(config.gatewayFee?.value));
        setText(section, "#pricingSummaryPackages", String(state.affected?.packagesAffected || state.products.length || 0));
        setText(section, "#pricingSummaryPackagesMeta", `${state.affected?.productsAffected || 0} products · ${(state.affected?.currenciesAffected || []).join(", ") || product.currency}`);
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

    function renderError(section, error) {
        const errorBox = section.querySelector("#pricingSimulationError");
        const flow = section.querySelector("#pricingFlow");
        const breakdown = section.querySelector("#pricingBreakdown");
        if (errorBox) {
            errorBox.hidden = false;
            errorBox.textContent = error?.code ? `${error.code}: ${error.message}` : error.message || "Pricing preview failed.";
        }
        if (flow) flow.innerHTML = "";
        if (breakdown) breakdown.innerHTML = "";
        setText(section, "#pricingStorefrontPrice", "Unavailable");
    }

    function syncPricingPreview(section) {
        const product = state.selectedProduct;
        const errorBox = section.querySelector("#pricingSimulationError");
        if (errorBox) {
            errorBox.hidden = true;
            errorBox.textContent = "";
        }
        setText(section, "#pricingRulesSubtitle", `${product.productName} production draft. ${state.dirty ? "Unsaved changes." : "Draft loaded."}`);
        setText(section, "#pricingPreviewProduct", `${product.productName} · ${product.region} · ${product.currency}`);
        setText(section, "#pricingStorefrontProduct", product.productName);
        setText(section, "#pricingStorefrontPackage", product.packageName);
        renderRuleValues(section);
        renderProductionStatus(section);

        try {
            const result = calculatePreview();
            renderFlow(section, result);
            renderBreakdown(section, result);
            setText(section, "#pricingStorefrontPrice", formatMoney(result.regularPrice, result.currency));
            window.AZIEL_PRICING_ENGINE_PRODUCTION_PREVIEW = Object.freeze({ product: { ...product }, policy: cloneConfig(currentPolicy().config), lastResult: result });
        } catch (error) {
            renderError(section, error);
        }
    }

    function payloadPolicies() {
        return [...state.policies.values()].map(policy => ({
            region: policy.region,
            currency: policy.currency,
            config: policy.config
        }));
    }

    async function saveDraft(section) {
        const button = section.querySelector("#pricingSaveDraftBtn");
        if (button) button.disabled = true;
        setStatus(section, "Saving draft...");
        try {
            const data = await adminFetch("/api/admin/pricing-engine/draft", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ policies: payloadPolicies() })
            });
            if (!data?.success) throw new Error(data?.message || "Draft save failed.");
            state.dirty = false;
            if (data.state) {
                state.version = data.state.version || state.version;
                state.affected = data.state.affected || state.affected;
            }
            setStatus(section, "Draft saved");
            syncPricingPreview(section);
            return true;
        } catch (error) {
            renderError(section, error);
            setStatus(section, "Draft save failed");
            return false;
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function publishDraft(section) {
        const role = String(window.AZIEL_ADMIN_AUTH?.state?.admin?.role || localStorage.getItem("adminRole") || "").toUpperCase();
        if (role !== "OWNER") {
            setStatus(section, "Owner only");
            return;
        }
        const confirmed = window.confirm("Publish Pricing Version?\n\nFuture customer quotes will immediately use these rules.\nExisting orders will remain unchanged.");
        if (!confirmed) return;
        if (state.dirty) {
            const saved = await saveDraft(section);
            if (!saved) return;
        }

        const button = section.querySelector("#pricingPublishBtn");
        if (button) button.disabled = true;
        setStatus(section, "Publishing...");
        try {
            const data = await adminFetch("/api/admin/pricing-engine/publish", { method: "POST" });
            if (!data?.success) throw new Error(data?.message || "Publish failed.");
            if (data.state) {
                state.version = data.state.version || data.version || state.version;
                state.affected = data.state.affected || state.affected;
                (data.state.policies || []).forEach(item => {
                    const draft = item.draft?.config ? item.draft : item.active;
                    state.policies.set(policyKey(item.region, item.currency), {
                        region: item.region,
                        currency: item.currency,
                        config: cloneConfig(draft?.config || neutralConfig(item.region))
                    });
                });
            } else {
                state.version = data.version || state.version;
            }
            state.dirty = false;
            setStatus(section, `Production Active · v${state.version?.versionNumber || ""}`);
            syncPricingPreview(section);
        } catch (error) {
            renderError(section, error);
            setStatus(section, "Publish failed");
        } finally {
            setPublishAvailability(section);
        }
    }

    function setStatus(section, message) {
        const status = section.querySelector("#pricingProductionStatus");
        if (status) status.textContent = message;
    }

    function setPublishAvailability(section) {
        const publish = section.querySelector("#pricingPublishBtn");
        const save = section.querySelector("#pricingSaveDraftBtn");
        const role = String(window.AZIEL_ADMIN_AUTH?.state?.admin?.role || localStorage.getItem("adminRole") || "").toUpperCase();
        const canManage = window.AZIEL_ADMIN_AUTH?.hasPermission?.("CATALOG_MANAGE") !== false;
        if (save) save.disabled = !canManage;
        if (publish) {
            publish.disabled = role !== "OWNER";
            publish.title = role === "OWNER" ? "Publish production pricing" : "Only OWNER can publish production pricing";
        }
    }

    function renderProductionStatus(section) {
        const version = state.version;
        setStatus(section, version ? `Production Active · v${version.versionNumber}` : "Production Ready");
        setText(section, "#pricingSummaryExchangeMeta", version?.publishedAt ? `Published ${new Date(version.publishedAt).toLocaleString()}` : "Production configuration");
        setText(section, "#pricingSummaryProfitMeta", version?.publishedBy ? `Published by ${version.publishedBy}` : "Draft preview");
        setText(section, "#pricingSummaryGatewayMeta", state.dirty ? "Unsaved draft" : "Draft editable");
    }
})();
