// frontend/js/admin-fulfillment.js
// Admin supplier and manual fulfillment foundation.

let fulfillmentSuppliers = [];
let fulfillmentMappings = [];
let fulfillmentProducts = [];
let fulfillmentAttempts = [];
let selectedFulfillmentView = "attempts";
let fulfillmentInitialized = false;
let fulfillmentLastFocused = null;
const FULFILLMENT_REGIONS = Object.freeze(["MM", "TH"]);
const SUPPLIER_CODE_PATTERN = /^[A-Z0-9_-]{2,40}$/;
const fulfillmentState = {
    activeView: "attempts",
    loading: {
        suppliers: false,
        mappings: false,
        attempts: false
    },
    errors: {
        suppliers: "",
        mappings: "",
        attempts: ""
    },
    pagination: {
        attempts: window.AZIEL_ADMIN_UI?.pagination?.createPaginatedState?.({
            getId: attempt => attempt?.fulfillmentId || attempt?.id || attempt?._id,
            limit: 50
        }) || {
            items: [],
            limit: 50,
            nextCursor: "",
            hasMore: false,
            loadingMore: false,
            replace(items = [], pagination = {}) {
                this.items = items.slice();
                this.hasMore = Boolean(pagination.hasMore);
                this.nextCursor = pagination.nextCursor || "";
            },
            append(items = [], pagination = {}) {
                this.items = mergeFulfillmentAttempts(this.items, items);
                this.hasMore = Boolean(pagination.hasMore);
                this.nextCursor = pagination.nextCursor || "";
            }
        }
    }
};
const fulfillmentAttemptsRequestGate = window.AZIEL_ADMIN_UI?.request?.createRequestGate?.();
const fulfillmentReferenceGates = {
    suppliers: window.AZIEL_ADMIN_UI?.request?.createRequestGate?.(),
    mappings: window.AZIEL_ADMIN_UI?.request?.createRequestGate?.(),
    catalog: window.AZIEL_ADMIN_UI?.request?.createRequestGate?.()
};
const fulfillmentReferenceState = {
    suppliersLoaded: false,
    mappingsLoaded: false,
    catalogLoaded: false,
    packageCache: new Map(),
    packageInFlight: new Map()
};
const FULFILLMENT_VIEW_PANELS = Object.freeze({
    suppliers: "fulfillmentSuppliersView",
    mappings: "fulfillmentMappingsView",
    attempts: "fulfillmentAttemptsView"
});

document.addEventListener("DOMContentLoaded", () => {
    initAdminFulfillmentController();
});

function initAdminFulfillmentController() {
    if (fulfillmentInitialized) return;
    fulfillmentInitialized = true;

    document.querySelectorAll("[data-fulfillment-view]").forEach(button => {
        button.addEventListener("click", () => openFulfillmentView(button.dataset.fulfillmentView || "suppliers"));
    });
    document.getElementById("supplierCodeInput")?.addEventListener("input", normalizeSupplierCodeField);
    document.getElementById("refreshFulfillmentBtn")?.addEventListener("click", () => refreshActiveFulfillmentView());
    document.getElementById("saveSupplierBtn")?.addEventListener("click", createSupplierFromForm);
    document.getElementById("saveMappingBtn")?.addEventListener("click", createMappingFromForm);
    document.getElementById("mappingProductInput")?.addEventListener("change", renderMappingPackageOptions);
    document.getElementById("fulfillmentAttemptFilter")?.addEventListener("change", () => loadFulfillmentAttempts({ showLoading: true }));
    syncFulfillmentViewVisibility();

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "fulfillment") {
            const view = event.detail?.context?.view === "advanced" ? "suppliers" : "attempts";
            if (view !== fulfillmentState.activeView) openFulfillmentView(view);
            else loadFulfillmentData({ view });
        }
    });
    window.addEventListener("aziel:admin-locale-changed", () => {
        renderSuppliers();
        renderMappings();
        renderAttempts();
    });
}

async function loadFulfillmentData(options = {}) {
    const view = options.view || fulfillmentState.activeView;
    const force = Boolean(options.force);

    if (view === "suppliers") {
        await loadSuppliers({ showLoading: true, force });
    } else if (view === "mappings") {
        await Promise.all([
            loadSuppliers({ showLoading: false, force }),
            loadCatalogForFulfillment({ force }),
            loadMappings({ showLoading: true, force })
        ]);
    } else if (view === "attempts") {
        await loadFulfillmentAttempts({ showLoading: true, force });
    } else {
        await loadSuppliers({ showLoading: true, force });
    }
    renderFulfillmentCurrentView();
}

async function openFulfillmentView(view) {
    if (!FULFILLMENT_VIEW_PANELS[view]) view = "suppliers";
    selectedFulfillmentView = view;
    fulfillmentState.activeView = view;
    syncFulfillmentViewVisibility();
    renderFulfillmentCurrentView();
    await loadFulfillmentData({ view, force: false });
}

function syncFulfillmentViewVisibility() {
    const activeView = FULFILLMENT_VIEW_PANELS[fulfillmentState.activeView]
        ? fulfillmentState.activeView
        : "suppliers";

    fulfillmentState.activeView = activeView;
    selectedFulfillmentView = activeView;

    document.querySelectorAll("#section-fulfillment [data-fulfillment-view]").forEach(button => {
        const isActive = button.dataset.fulfillmentView === activeView;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
    });

    Object.entries(FULFILLMENT_VIEW_PANELS).forEach(([view, panelId]) => {
        const panel = document.getElementById(panelId);
        if (!panel) return;
        const isActive = view === activeView;
        panel.classList.toggle("active", isActive);
        panel.hidden = !isActive;
    });
}

async function refreshActiveFulfillmentView() {
    const button = document.getElementById("refreshFulfillmentBtn");
    try {
        window.AZIEL_UI?.button?.setLoading(button, { text: adminT("loading", "Loading") });
        await loadFulfillmentData({ view: fulfillmentState.activeView, force: true });
    } finally {
        window.AZIEL_UI?.button?.reset(button);
    }
}

function renderFulfillmentCurrentView() {
    syncFulfillmentViewVisibility();
    renderSupplierOptions();
    renderProductOptions();
    if (fulfillmentState.activeView === "suppliers") renderSuppliers();
    if (fulfillmentState.activeView === "mappings") renderMappings();
    if (fulfillmentState.activeView === "attempts") renderAttempts();
}

async function loadSuppliers(options = {}) {
    const force = Boolean(options.force);
    const signature = "suppliers";
    if (!force && fulfillmentReferenceState.suppliersLoaded) {
        if (options.showLoading) renderSuppliers();
        return fulfillmentSuppliers;
    }

    const request = fulfillmentReferenceGates.suppliers?.begin(signature, { coalesceKey: signature });
    if (request?.coalesced) return request.promise;

    const requestPromise = (async () => {
    fulfillmentState.loading.suppliers = Boolean(options.showLoading);
    fulfillmentState.errors.suppliers = "";
    if (options.showLoading) renderSuppliers();
    try {
        const data = await adminFetch("/api/admin/suppliers");
        if (request && !request.isCurrent()) return fulfillmentSuppliers;
        if (!data?.success) {
            fulfillmentState.errors.suppliers = data?.message || adminT("unable_load_suppliers", "Unable to load suppliers.");
            fulfillmentSuppliers = [];
            fulfillmentReferenceState.suppliersLoaded = false;
            return fulfillmentSuppliers;
        }
        fulfillmentSuppliers = data.suppliers || [];
        fulfillmentReferenceState.suppliersLoaded = true;
    } catch (error) {
        if (request && !request.isCurrent()) return fulfillmentSuppliers;
        fulfillmentState.errors.suppliers = adminT("unable_load_suppliers", "Unable to load suppliers.");
        fulfillmentSuppliers = [];
        fulfillmentReferenceState.suppliersLoaded = false;
        showAdminToast?.(fulfillmentState.errors.suppliers, "error");
    } finally {
        if (!request || request.isCurrent()) {
            fulfillmentState.loading.suppliers = false;
            if (options.showLoading) renderSuppliers();
        }
    }
    return fulfillmentSuppliers;
    })();
    request?.track(requestPromise);
    return requestPromise;
}

async function loadMappings(options = {}) {
    const force = Boolean(options.force);
    const signature = "mappings";
    if (!force && fulfillmentReferenceState.mappingsLoaded) {
        if (options.showLoading) renderMappings();
        return fulfillmentMappings;
    }

    const request = fulfillmentReferenceGates.mappings?.begin(signature, { coalesceKey: signature });
    if (request?.coalesced) return request.promise;

    const requestPromise = (async () => {
    fulfillmentState.loading.mappings = Boolean(options.showLoading);
    fulfillmentState.errors.mappings = "";
    if (options.showLoading) renderMappings();
    try {
        const data = await adminFetch("/api/admin/supplier-mappings");
        if (request && !request.isCurrent()) return fulfillmentMappings;
        if (!data?.success) {
            fulfillmentState.errors.mappings = data?.message || adminT("unable_load_mappings", "Unable to load supplier mappings.");
            fulfillmentMappings = [];
            fulfillmentReferenceState.mappingsLoaded = false;
            return fulfillmentMappings;
        }
        fulfillmentMappings = data.mappings || [];
        fulfillmentReferenceState.mappingsLoaded = true;
    } catch (error) {
        if (request && !request.isCurrent()) return fulfillmentMappings;
        fulfillmentState.errors.mappings = adminT("unable_load_mappings", "Unable to load supplier mappings.");
        fulfillmentMappings = [];
        fulfillmentReferenceState.mappingsLoaded = false;
        showAdminToast?.(fulfillmentState.errors.mappings, "error");
    } finally {
        if (!request || request.isCurrent()) {
            fulfillmentState.loading.mappings = false;
            if (options.showLoading) renderMappings();
        }
    }
    return fulfillmentMappings;
    })();
    request?.track(requestPromise);
    return requestPromise;
}

async function loadCatalogForFulfillment(options = {}) {
    const force = Boolean(options.force);
    const signature = "catalog";
    if (!force && fulfillmentReferenceState.catalogLoaded) {
        renderProductOptions();
        return fulfillmentProducts;
    }

    if (force) {
        fulfillmentReferenceState.catalogLoaded = false;
        fulfillmentReferenceState.packageCache.clear();
    }

    const request = fulfillmentReferenceGates.catalog?.begin(signature, { coalesceKey: signature });
    if (request?.coalesced) return request.promise;

    const requestPromise = (async () => {
    try {
        const data = await adminFetch("/api/admin/catalog/products");
        if (request && !request.isCurrent()) return fulfillmentProducts;
        const products = data?.success ? data.products || [] : [];
        fulfillmentProducts = await Promise.all(products.map(async product => {
            return {
                ...product,
                packages: await loadFulfillmentProductPackages(product.productCode, { force })
            };
        }));
        fulfillmentReferenceState.catalogLoaded = true;
        renderProductOptions();
    } catch (error) {
        if (request && !request.isCurrent()) return fulfillmentProducts;
        fulfillmentProducts = [];
        fulfillmentReferenceState.catalogLoaded = false;
        if (fulfillmentState.activeView === "mappings") {
            showAdminToast?.(adminT("unable_load_catalog", "Unable to load Catalog options."), "error");
        }
    }
    return fulfillmentProducts;
    })();
    request?.track(requestPromise);
    return requestPromise;
}

async function loadFulfillmentProductPackages(productCode, options = {}) {
    const key = String(productCode || "").trim();
    if (!key) return [];
    const force = Boolean(options.force);
    if (fulfillmentReferenceState.packageInFlight.has(key)) {
        return fulfillmentReferenceState.packageInFlight.get(key);
    }
    if (!force && fulfillmentReferenceState.packageCache.has(key)) {
        return fulfillmentReferenceState.packageCache.get(key).slice();
    }

    const promise = adminFetch(`/api/admin/catalog/products/${encodeURIComponent(key)}/packages`)
        .then(data => {
            const packages = data?.success ? data.packages || [] : [];
            fulfillmentReferenceState.packageCache.set(key, packages);
            return packages.slice();
        })
        .catch(error => {
            fulfillmentReferenceState.packageCache.delete(key);
            return [];
        })
        .finally(() => {
            if (fulfillmentReferenceState.packageInFlight.get(key) === promise) {
                fulfillmentReferenceState.packageInFlight.delete(key);
            }
        });

    fulfillmentReferenceState.packageInFlight.set(key, promise);
    return promise;
}

async function loadFulfillmentAttempts(options = {}) {
    const append = Boolean(options.append);
    const paging = fulfillmentState.pagination.attempts;
    if (append && (paging.loadingMore || !paging.hasMore)) return;
    if (!append) {
        paging.nextCursor = "";
        paging.hasMore = false;
    }

    fulfillmentState.loading.attempts = Boolean(options.showLoading);
    paging.loadingMore = append;
    fulfillmentState.errors.attempts = "";
    if (options.showLoading || append) renderAttempts();
    const filter = document.getElementById("fulfillmentAttemptFilter")?.value || "ACTIVE";
    const params = new URLSearchParams({ limit: String(paging.limit) });
    if (filter !== "ALL") params.set("status", filter);
    if (append && paging.nextCursor) params.set("cursor", paging.nextCursor);
    const signature = JSON.stringify({
        filter,
        append,
        cursor: append ? paging.nextCursor || "" : "",
        limit: paging.limit
    });
    const request = fulfillmentAttemptsRequestGate?.begin(signature, { coalesceKey: signature });
    if (request?.coalesced) return request.promise;

    const requestPromise = (async () => {
    try {
        const data = await adminFetch(`/api/admin/fulfillments?${params.toString()}`);
        if (request && !request.isCurrent()) return;

        if (!data?.success) {
            fulfillmentState.errors.attempts = data?.message || adminT("unable_load_attempts", "Unable to load fulfillment attempts.");
            fulfillmentAttempts = [];
            return;
        }
        const incoming = data.attempts || data.items || [];
        if (append) paging.append(incoming, data.pagination || {});
        else paging.replace(incoming, data.pagination || {});
        fulfillmentAttempts = paging.items.slice();
    } catch (error) {
        if (request && !request.isCurrent()) return;
        fulfillmentState.errors.attempts = adminT("unable_load_attempts", "Unable to load fulfillment attempts.");
        fulfillmentAttempts = [];
        showAdminToast?.(fulfillmentState.errors.attempts, "error");
    } finally {
        if (!request || request.isCurrent()) {
            fulfillmentState.loading.attempts = false;
            paging.loadingMore = false;
            renderAttempts();
        }
    }
    })();
    request?.track(requestPromise);
    return requestPromise;
}

function mergeFulfillmentAttempts(current = [], incoming = []) {
    const seen = new Set(current.map(attempt => String(attempt.fulfillmentId || attempt.id || attempt._id)));
    const merged = current.slice();
    incoming.forEach(attempt => {
        const id = String(attempt.fulfillmentId || attempt.id || attempt._id || "");
        if (!id || seen.has(id)) return;
        seen.add(id);
        merged.push(attempt);
    });
    return merged;
}

async function createSupplierFromForm(event) {
    const button = event.currentTarget;
    const supplierCode = normalizeSupplierCode(document.getElementById("supplierCodeInput")?.value || "");
    let regions = [];
    try {
        regions = normalizeSupplierRegionsInput(document.getElementById("supplierRegionsInput"));
    } catch (error) {
        showAdminToast?.(error.message || adminT("invalid_supplier_region", "Supported regions must be MM or TH."), "error");
        return;
    }
    if (!SUPPLIER_CODE_PATTERN.test(supplierCode)) {
        showAdminToast?.(adminT("invalid_supplier_code", "Supplier code must use A-Z, 0-9, underscore, or hyphen."), "error");
        return;
    }
    if (!regions.length) {
        showAdminToast?.(adminT("supplier_regions_required", "Enter at least one supported region: MM or TH."), "error");
        return;
    }
    const payload = {
        name: document.getElementById("supplierNameInput")?.value || "",
        supplierCode,
        mode: document.getElementById("supplierModeInput")?.value || "MANUAL",
        supportedRegions: regions,
        balanceSource: document.getElementById("supplierBalanceSourceInput")?.value || "UNKNOWN",
        balanceAmount: document.getElementById("supplierBalanceAmountInput")?.value || 0,
        balanceCurrency: document.getElementById("supplierBalanceCurrencyInput")?.value || "",
        enabled: Boolean(document.getElementById("supplierEnabledInput")?.checked)
    };

    try {
        window.AZIEL_UI?.button?.setLoading(button, { text: adminT("loading", "Loading") });
        const data = await adminFetch("/api/admin/suppliers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("something_went_wrong"), "error");
            return;
        }
        if (data.supplier) {
            const index = fulfillmentSuppliers.findIndex(supplier => supplier.id === data.supplier.id);
            if (index >= 0) fulfillmentSuppliers[index] = data.supplier;
            else fulfillmentSuppliers.unshift(data.supplier);
        }
        showAdminToast?.(adminT("supplier_saved", "Supplier saved"), "success");
        await loadSuppliers({ force: true });
        renderSuppliers();
        renderSupplierOptions();
    } finally {
        window.AZIEL_UI?.button?.reset(button);
    }
}

async function createMappingFromForm(event) {
    const button = event.currentTarget;
    const supplierId = document.getElementById("mappingSupplierInput")?.value || "";
    const payload = {
        productCode: document.getElementById("mappingProductInput")?.value || "",
        packageCode: document.getElementById("mappingPackageInput")?.value || "",
        region: document.getElementById("mappingRegionInput")?.value || "MM",
        supplierProductCode: document.getElementById("mappingSupplierProductInput")?.value || "",
        supplierPackageCode: document.getElementById("mappingSupplierPackageInput")?.value || "",
        enabled: Boolean(document.getElementById("mappingEnabledInput")?.checked)
    };

    if (!supplierId) {
        showAdminToast?.(adminT("supplier_required", "Supplier is required"), "error");
        return;
    }

    try {
        window.AZIEL_UI?.button?.setLoading(button, { text: adminT("loading", "Loading") });
        const data = await adminFetch(`/api/admin/suppliers/${encodeURIComponent(supplierId)}/mappings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("something_went_wrong"), "error");
            return;
        }
        showAdminToast?.(adminT("mapping_saved", "Mapping saved"), "success");
        await loadMappings({ force: true });
        renderMappings();
    } finally {
        window.AZIEL_UI?.button?.reset(button);
    }
}

function renderSuppliers() {
    const list = document.getElementById("suppliersList");
    if (!list) return;
    if (fulfillmentState.loading.suppliers) {
        list.innerHTML = renderFulfillmentLoadingState(adminT("loading", "Loading"));
        return;
    }
    if (fulfillmentState.errors.suppliers) {
        list.innerHTML = renderFulfillmentErrorState(fulfillmentState.errors.suppliers, "suppliers");
        bindFulfillmentRetry(list);
        return;
    }
    if (!fulfillmentSuppliers.length) {
        list.innerHTML = renderFulfillmentEmptyState(
            adminT("no_suppliers_found", "No suppliers found"),
            adminT("create_supplier_before_mapping", "Create and enable a supplier before adding mappings.")
        );
        return;
    }
    list.innerHTML = fulfillmentSuppliers.map(supplier => `
        <article class="fulfillment-card">
            <div>
                <strong>${escapeFulfillmentHtml(supplier.name)} <span>${escapeFulfillmentHtml(supplier.supplierCode)}</span></strong>
                <small>${escapeFulfillmentHtml(adminT("supplier_mode", "Supplier Mode"))}: ${escapeFulfillmentHtml(supplier.mode)} · ${escapeFulfillmentHtml(supplier.enabled ? adminT("enabled", "Enabled") : adminT("disabled", "Disabled"))}</small>
                <small>${escapeFulfillmentHtml(adminT("supported_regions", "Supported Regions"))}: ${escapeFulfillmentHtml((supplier.supportedRegions || []).join(", ") || "-")}</small>
                <small>${escapeFulfillmentHtml(supplier.balanceLabel || adminT("balance_unavailable", "Balance unavailable"))}</small>
            </div>
            <div class="fulfillment-card-actions">
                <button class="admin-secondary-btn" type="button" data-edit-supplier="${escapeFulfillmentHtml(supplier.id)}" data-admin-permission="SUPPLIERS_MANAGE">
                    ${escapeFulfillmentHtml(adminT("edit", "Edit"))}
                </button>
                <button class="admin-secondary-btn" type="button" data-toggle-supplier="${escapeFulfillmentHtml(supplier.id)}" data-enabled="${supplier.enabled ? "false" : "true"}" data-admin-permission="SUPPLIERS_MANAGE">
                    ${escapeFulfillmentHtml(supplier.enabled ? adminT("disable", "Disable") : adminT("enable", "Enable"))}
                </button>
            </div>
        </article>
    `).join("");

    list.querySelectorAll("[data-edit-supplier]").forEach(button => {
        button.addEventListener("click", () => openSupplierEditor(button.dataset.editSupplier));
    });
    list.querySelectorAll("[data-toggle-supplier]").forEach(button => {
        button.addEventListener("click", () => toggleSupplier(button.dataset.toggleSupplier, button.dataset.enabled === "true", button));
    });
    window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.(list);
}

function openSupplierEditor(supplierId) {
    const supplier = fulfillmentSuppliers.find(item => item.id === supplierId);
    if (!supplier) {
        showAdminToast?.(adminT("supplier_not_found", "Supplier not found."), "error");
        return;
    }

    const modal = ensureSupplierEditorModal();
    fulfillmentLastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.querySelector(".fulfillment-modal-title").textContent = adminT("edit_supplier", "Edit Supplier");
    modal.querySelector(".fulfillment-modal-body").innerHTML = `
        <label>${escapeFulfillmentHtml(adminT("supplier_name", "Supplier Name"))}<input id="editSupplierNameInput" type="text" value="${escapeFulfillmentHtml(supplier.name || "")}"></label>
        <label>${escapeFulfillmentHtml(adminT("supplier_code", "Supplier Code"))}<input id="editSupplierCodeInput" type="text" value="${escapeFulfillmentHtml(supplier.supplierCode || "")}" readonly></label>
        <label>${escapeFulfillmentHtml(adminT("supplier_mode", "Supplier Mode"))}<select id="editSupplierModeInput">
            <option value="MANUAL" ${supplier.mode === "MANUAL" ? "selected" : ""}>MANUAL</option>
            <option value="API" ${supplier.mode === "API" ? "selected" : ""}>API</option>
        </select></label>
        <label>${escapeFulfillmentHtml(adminT("supported_regions", "Supported Regions"))}<textarea id="editSupplierRegionsInput" rows="2">${escapeFulfillmentHtml((supplier.supportedRegions || []).join("\n"))}</textarea></label>
        <label>${escapeFulfillmentHtml(adminT("balance_source", "Balance Source"))}<select id="editSupplierBalanceSourceInput">
            <option value="UNKNOWN" ${(supplier.balanceSource || "UNKNOWN") === "UNKNOWN" ? "selected" : ""}>UNKNOWN</option>
            <option value="MANUAL" ${supplier.balanceSource === "MANUAL" ? "selected" : ""}>MANUAL</option>
        </select></label>
        <label>${escapeFulfillmentHtml(adminT("manual_balance", "Manual Balance"))}<input id="editSupplierBalanceAmountInput" type="number" min="0" step="0.01" value="${escapeFulfillmentHtml(supplier.balanceAmount ?? 0)}"></label>
        <label>${escapeFulfillmentHtml(adminT("currency", "Currency"))}<select id="editSupplierBalanceCurrencyInput">
            <option value="" ${!supplier.balanceCurrency ? "selected" : ""}>-</option>
            <option value="MMK" ${supplier.balanceCurrency === "MMK" ? "selected" : ""}>MMK</option>
            <option value="THB" ${supplier.balanceCurrency === "THB" ? "selected" : ""}>THB</option>
            <option value="USD" ${supplier.balanceCurrency === "USD" ? "selected" : ""}>USD</option>
        </select></label>
        <label class="fulfillment-checkbox"><input id="editSupplierEnabledInput" type="checkbox" ${supplier.enabled ? "checked" : ""}> <span>${escapeFulfillmentHtml(adminT("enabled", "Enabled"))}</span></label>
        <p id="supplierEditorError" class="admin-action-modal-error"></p>
    `;

    modal.querySelector("#editSupplierBalanceSourceInput")?.addEventListener("change", syncSupplierEditorBalanceFields);
    modal.querySelector(".fulfillment-modal-save").onclick = event => saveSupplierEditor(supplier.id, event.currentTarget);
    syncSupplierEditorBalanceFields();
    modal.classList.add("show");
}

function ensureSupplierEditorModal() {
    let modal = document.getElementById("supplierEditorModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "supplierEditorModal";
    modal.className = "admin-action-modal fulfillment-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box fulfillment-modal-box">
            <h3 class="fulfillment-modal-title"></h3>
            <div class="fulfillment-modal-body"></div>
            <div class="admin-action-modal-actions">
                <button type="button" class="fulfillment-modal-cancel">${escapeFulfillmentHtml(adminT("cancel", "Cancel"))}</button>
                <button type="button" class="fulfillment-modal-save">${escapeFulfillmentHtml(adminT("save_changes", "Save Changes"))}</button>
            </div>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) closeSupplierEditorModal();
    });
    modal.querySelector(".fulfillment-modal-cancel").addEventListener("click", closeSupplierEditorModal);
    document.body.appendChild(modal);
    return modal;
}

function closeSupplierEditorModal() {
    const modal = document.getElementById("supplierEditorModal");
    if (!modal) return;
    modal.classList.remove("show");
    const saveButton = modal.querySelector(".fulfillment-modal-save");
    window.AZIEL_UI?.button?.reset?.(saveButton);
    if (saveButton) saveButton.onclick = null;
    fulfillmentLastFocused?.focus?.();
    fulfillmentLastFocused = null;
}

function syncSupplierEditorBalanceFields() {
    const source = document.getElementById("editSupplierBalanceSourceInput")?.value || "UNKNOWN";
    const amount = document.getElementById("editSupplierBalanceAmountInput");
    const currency = document.getElementById("editSupplierBalanceCurrencyInput");
    const isManual = source === "MANUAL";
    if (amount) amount.disabled = !isManual;
    if (currency) currency.disabled = !isManual;
}

async function saveSupplierEditor(supplierId, button) {
    const error = document.getElementById("supplierEditorError");
    if (error) error.textContent = "";

    let regions = [];
    try {
        regions = normalizeSupplierRegionsInput(document.getElementById("editSupplierRegionsInput"));
    } catch (validationError) {
        if (error) error.textContent = validationError.message || adminT("invalid_supplier_region", "Supported regions must be MM or TH.");
        return;
    }

    const payload = {
        name: document.getElementById("editSupplierNameInput")?.value || "",
        mode: document.getElementById("editSupplierModeInput")?.value || "MANUAL",
        supportedRegions: regions,
        balanceSource: document.getElementById("editSupplierBalanceSourceInput")?.value || "UNKNOWN",
        balanceAmount: document.getElementById("editSupplierBalanceAmountInput")?.value || 0,
        balanceCurrency: document.getElementById("editSupplierBalanceCurrencyInput")?.value || "",
        enabled: Boolean(document.getElementById("editSupplierEnabledInput")?.checked)
    };

    try {
        window.AZIEL_UI?.button?.setLoading(button, { text: adminT("loading", "Loading") });
        const data = await adminFetch(`/api/admin/suppliers/${encodeURIComponent(supplierId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!data?.success) {
            if (error) error.textContent = data?.message || adminT("something_went_wrong", "Something went wrong");
            showAdminToast?.(data?.message || adminT("something_went_wrong", "Something went wrong"), "error");
            return;
        }
        closeSupplierEditorModal();
        showAdminToast?.(adminT("supplier_updated", "Supplier updated"), "success");
        await loadSuppliers({ force: true });
        renderSuppliers();
        renderSupplierOptions();
    } finally {
        window.AZIEL_UI?.button?.reset(button);
    }
}

async function toggleSupplier(id, enabled, button) {
    try {
        window.AZIEL_UI?.button?.setLoading(button, { text: adminT("loading", "Loading") });
        const data = await adminFetch(`/api/admin/suppliers/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled })
        });
        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("something_went_wrong"), "error");
            return;
        }
        await loadSuppliers({ force: true });
        renderSuppliers();
    } finally {
        window.AZIEL_UI?.button?.reset(button);
    }
}

function renderMappings() {
    const list = document.getElementById("mappingsList");
    if (!list) return;
    if (fulfillmentState.loading.mappings) {
        list.innerHTML = renderFulfillmentLoadingState(adminT("loading", "Loading"));
        return;
    }
    if (fulfillmentState.errors.mappings) {
        list.innerHTML = renderFulfillmentErrorState(fulfillmentState.errors.mappings, "mappings");
        bindFulfillmentRetry(list);
        return;
    }
    if (!fulfillmentSuppliers.length) {
        list.innerHTML = renderFulfillmentEmptyState(
            adminT("no_suppliers_available", "No suppliers available."),
            adminT("create_supplier_before_mapping", "Create and enable a supplier before adding a mapping.")
        );
        return;
    }
    if (!fulfillmentMappings.length) {
        list.innerHTML = renderFulfillmentEmptyState(
            adminT("no_supplier_mappings_yet", "No supplier mappings yet."),
            adminT("mapping_empty_hint", "Map an AZIEL Catalog package to a supplier package before starting fulfillment.")
        );
        return;
    }
    list.innerHTML = fulfillmentMappings.map(mapping => `
        <article class="fulfillment-card">
            <div>
                <strong>${escapeFulfillmentHtml(mapping.supplierCode)} · ${escapeFulfillmentHtml(mapping.productCode)} / ${escapeFulfillmentHtml(mapping.packageCode)}</strong>
                <small>${escapeFulfillmentHtml(adminT("region", "Region"))}: ${escapeFulfillmentHtml(mapping.region)} · ${escapeFulfillmentHtml(adminT("execution_mode", "Execution Mode"))}: ${escapeFulfillmentHtml(mapping.executionMode)}</small>
                <small>${escapeFulfillmentHtml(adminT("supplier_product_code", "Supplier Product Code"))}: ${escapeFulfillmentHtml(mapping.supplierProductCode)}</small>
                <small>${escapeFulfillmentHtml(adminT("supplier_package_code", "Supplier Package Code"))}: ${escapeFulfillmentHtml(mapping.supplierPackageCode)}</small>
                <small>${escapeFulfillmentHtml(adminT("supplier_cost", "Raw Supplier Cost"))}: ${mapping.supplierCost?.rawSupplierCost ?? mapping.supplierCost?.amount ?? adminT("not_configured", "Not configured")} ${escapeFulfillmentHtml(mapping.supplierCost?.supplierCurrency || "")}</small>
                <small>Landed THB: ${mapping.landedCost ?? "-"} · Production price: ${mapping.productionSellingPrice ?? "-"} ${escapeFulfillmentHtml(mapping.productionCurrency || "")}</small>
                <small>${escapeFulfillmentHtml(adminT("readiness", "Readiness"))}: ${escapeFulfillmentHtml([mapping.readiness?.supplierMapped ? "Mapped" : "Unmapped", mapping.readiness?.inputReady ? "Input ready" : "Input pending", mapping.readiness?.pricingReady ? "Pricing ready" : "Pricing pending", mapping.readiness?.fulfillmentReady ? "Fulfillment ready" : "Fulfillment disabled"].join(" · "))}</small>
                <small>Provider gate: ${mapping.featureGateEnabled ? "ON" : "OFF"} · Controlled test: ${mapping.controlledTestEvidence ? "PASS" : "No evidence"}</small>
                <small>Production blockers: ${escapeFulfillmentHtml((mapping.productionBlockers || []).join(" · ") || "None")}</small>
                <label>Production role
                    <select data-mapping-role data-mapping-id="${escapeFulfillmentHtml(mapping.id)}" data-admin-permission="OWNER_ROUTING_MANAGE">
                        ${["PRIMARY", "BACKUP", "DISABLED"].map(role => `<option value="${role}" ${mapping.productionRole === role ? "selected" : ""} ${role === "PRIMARY" && !mapping.productionReady ? "disabled" : ""}>${role}</option>`).join("")}
                    </select>
                </label>
            </div>
            <span class="admin-status ${mapping.enabled ? "completed" : "cancelled"}">${escapeFulfillmentHtml(mapping.enabled ? adminT("enabled", "Enabled") : adminT("disabled", "Disabled"))}</span>
        </article>
    `).join("");
    list.querySelectorAll("[data-mapping-role]").forEach(select => select.addEventListener("change", async event => {
        const node = event.currentTarget; node.disabled = true;
        try {
            const data = await adminFetch(`/api/admin/supplier-mappings/${encodeURIComponent(node.dataset.mappingId)}/production-role`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productionRole: node.value }) });
            if (!data?.success) throw new Error(data?.message || "Unable to update production role.");
            fulfillmentReferenceState.mappingsLoaded = false; await loadMappings({ force: true, showLoading: true });
            showAdminToast?.("Production supplier role updated.", "success");
        } catch (error) {
            showAdminToast?.(error.message || "Unable to update production role.", "error");
            fulfillmentReferenceState.mappingsLoaded = false; await loadMappings({ force: true, showLoading: true });
        }
    }));
    window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.(list);
}

function renderAttempts() {
    const list = document.getElementById("fulfillmentAttemptsList");
    if (!list) return;
    if (fulfillmentState.loading.attempts) {
        list.innerHTML = renderFulfillmentLoadingState(adminT("loading", "Loading"));
        return;
    }
    if (fulfillmentState.errors.attempts) {
        list.innerHTML = renderFulfillmentErrorState(fulfillmentState.errors.attempts, "attempts");
        bindFulfillmentRetry(list);
        return;
    }
    if (!fulfillmentAttempts.length) {
        list.innerHTML = renderFulfillmentEmptyState(
            adminT("no_fulfillment_attempts_yet", "No fulfillment attempts yet."),
            adminT("attempts_empty_hint", "Fulfillment attempts appear after fulfillment is started from an eligible paid Order.")
        );
        return;
    }
    const paging = fulfillmentState.pagination.attempts;
    const loadMore = paging.hasMore ? `
        <button class="admin-load-more-btn" type="button" id="fulfillmentAttemptsLoadMoreBtn" ${paging.loadingMore ? "disabled" : ""}>
            ${escapeFulfillmentHtml(paging.loadingMore ? adminT("loading", "Loading") : adminT("load_more", "Load More"))}
        </button>
    ` : "";

    list.innerHTML = fulfillmentAttempts.map(renderAttemptCard).join("") + loadMore;
    bindAttemptActions(list);
    document.getElementById("fulfillmentAttemptsLoadMoreBtn")?.addEventListener("click", () => loadFulfillmentAttempts({ append: true }));
}

function renderAttemptCard(attempt) {
    return `
        <article class="fulfillment-card" data-fulfillment-id="${escapeFulfillmentHtml(attempt.fulfillmentId)}">
            <div>
                <strong>${escapeFulfillmentHtml(attempt.fulfillmentId)} <span>${escapeFulfillmentHtml(attempt.status)}</span></strong>
                <small>${escapeFulfillmentHtml(attempt.orderCode)} · ${escapeFulfillmentHtml(attempt.supplierCode)} · ${escapeFulfillmentHtml(attempt.productCode)} / ${escapeFulfillmentHtml(attempt.packageCode)}</small>
                <small>${escapeFulfillmentHtml(adminT("started_by", "Started By"))}: ${escapeFulfillmentHtml(attempt.startedByUsernameSnapshot || "-")} · ${escapeFulfillmentHtml(formatFulfillmentDate(attempt.startedAt || attempt.createdAt))}</small>
                ${attempt.failureReason ? `<small>${escapeFulfillmentHtml(adminT("failure_reason", "Failure Reason"))}: ${escapeFulfillmentHtml(attempt.failureReason)}</small>` : ""}
                ${attempt.supplierReference ? `<small>${escapeFulfillmentHtml(adminT("supplier_reference", "Supplier Reference"))}: ${escapeFulfillmentHtml(attempt.supplierReference)}</small>` : ""}
            </div>
            <div class="fulfillment-card-actions">
                ${["PENDING", "IN_PROGRESS"].includes(attempt.status) ? `
                    <button class="admin-secondary-btn" type="button" data-mark-fulfilled="${escapeFulfillmentHtml(attempt.fulfillmentId)}" data-admin-permission="FULFILLMENT_RESOLVE">${escapeFulfillmentHtml(adminT("mark_fulfilled", "Mark Fulfilled"))}</button>
                    <button class="admin-secondary-btn danger" type="button" data-mark-failed="${escapeFulfillmentHtml(attempt.fulfillmentId)}" data-admin-permission="FULFILLMENT_RESOLVE">${escapeFulfillmentHtml(adminT("mark_failed", "Mark Failed"))}</button>
                ` : ""}
            </div>
        </article>
    `;
}

function bindAttemptActions(root) {
    root.querySelectorAll("[data-mark-fulfilled]").forEach(button => {
        button.addEventListener("click", () => markFulfillmentSucceeded(button.dataset.markFulfilled, button));
    });
    root.querySelectorAll("[data-mark-failed]").forEach(button => {
        button.addEventListener("click", () => markFulfillmentFailed(button.dataset.markFailed, button));
    });
    window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.(root);
}

function renderFulfillmentLoadingState(message) {
    return `
        <div class="fulfillment-state">
            <div class="admin-dashboard-skeleton"></div>
            <strong>${escapeFulfillmentHtml(message)}</strong>
        </div>
    `;
}

function renderFulfillmentEmptyState(title, message = "") {
    return `
        <div class="admin-empty-box fulfillment-state">
            <strong>${escapeFulfillmentHtml(title)}</strong>
            ${message ? `<small>${escapeFulfillmentHtml(message)}</small>` : ""}
        </div>
    `;
}

function renderFulfillmentErrorState(message, view) {
    return `
        <div class="admin-empty-box fulfillment-state is-error">
            <strong>${escapeFulfillmentHtml(message)}</strong>
            <button class="admin-secondary-btn" type="button" data-fulfillment-retry="${escapeFulfillmentHtml(view)}">
                ${escapeFulfillmentHtml(adminT("retry", "Retry"))}
            </button>
        </div>
    `;
}

function bindFulfillmentRetry(root) {
    root.querySelectorAll("[data-fulfillment-retry]").forEach(button => {
        button.addEventListener("click", () => loadFulfillmentData({ view: button.dataset.fulfillmentRetry, force: true }));
    });
}

async function markFulfillmentSucceeded(fulfillmentId, button, reference = "") {
    const supplierReference = reference || window.prompt(adminT("supplier_reference", "Supplier Reference"));
    if (!supplierReference) return;
    const confirmed = await confirmFulfillmentAction(adminT("mark_fulfilled", "Mark Fulfilled"), fulfillmentId);
    if (!confirmed) return;
    await postFulfillmentResolution(`/api/admin/fulfillments/${encodeURIComponent(fulfillmentId)}/succeed`, { supplierReference }, button);
}

async function markFulfillmentFailed(fulfillmentId, button, reason = "") {
    const failureReason = reason || window.prompt(adminT("failure_reason", "Failure Reason"));
    if (!failureReason) {
        showAdminToast?.(adminT("failure_reason_required", "Failure reason is required"), "error");
        return;
    }
    const confirmed = await confirmFulfillmentAction(adminT("mark_failed", "Mark Failed"), fulfillmentId);
    if (!confirmed) return;
    await postFulfillmentResolution(`/api/admin/fulfillments/${encodeURIComponent(fulfillmentId)}/fail`, { failureReason }, button);
}

async function postFulfillmentResolution(url, payload, button) {
    try {
        window.AZIEL_UI?.button?.setLoading(button, { text: adminT("loading", "Loading") });
        const data = await adminFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("something_went_wrong"), "error");
            return;
        }
        showAdminToast?.(adminT("fulfillment_updated", "Fulfillment updated"), "success");
        await loadFulfillmentAttempts();
        window.dispatchEvent(new CustomEvent("aziel:admin-dashboard-refresh"));
    } finally {
        window.AZIEL_UI?.button?.reset(button);
    }
}

async function startFulfillmentForAdminOrder(order, button = null) {
    const mappingsData = await adminFetch(`/api/admin/orders/${encodeURIComponent(order._id)}/fulfillment-mappings`);
    const mappings = mappingsData?.success ? mappingsData.mappings || [] : [];
    if (!mappings.length) {
        showAdminToast?.(adminT("no_supplier_mapping_available", "No supplier mapping available"), "error");
        return;
    }
    const selected = mappings.length === 1
        ? mappings[0]
        : mappings.find(mapping => mapping.id === window.prompt(`${adminT("supplier_mapping", "Supplier Mapping")}\n${mappings.map(item => `${item.id}: ${item.supplierCode} ${item.supplierProductCode}/${item.supplierPackageCode}`).join("\n")}`));
    if (!selected) return;

    const confirmed = await confirmFulfillmentAction(adminT("start_fulfillment", "Start Fulfillment"), order.orderId);
    if (!confirmed) return;

    try {
        window.AZIEL_UI?.button?.setLoading(button, { text: adminT("loading", "Loading") });
        const idempotencyKey = createFulfillmentStartIdempotencyKey(order, selected);
        const data = await adminFetch(`/api/admin/orders/${encodeURIComponent(order._id)}/fulfillments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mappingId: selected.id,
                idempotencyKey
            })
        });
        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("something_went_wrong"), "error");
            return;
        }
        if (!isActiveFulfillmentAttempt(data.attempt)) {
            showAdminToast?.(adminT("fulfillment_start_not_active", "Fulfillment start did not create an active attempt."), "error");
            return;
        }
        showAdminToast?.(adminT("fulfillment_started", "Fulfillment started"), "success");
        await window.refreshAdminOrderDetail?.(order._id);
        if (fulfillmentState.activeView === "attempts") {
            await loadFulfillmentAttempts({ showLoading: false });
        }
        window.dispatchEvent(new CustomEvent("aziel:admin-dashboard-refresh"));
    } finally {
        window.AZIEL_UI?.button?.reset(button);
    }
}

function createFulfillmentStartIdempotencyKey(order = {}, mapping = {}) {
    const seed = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `admin-ui:${order.orderId || order._id}:${mapping.id}:${seed}`;
}

function isActiveFulfillmentAttempt(attempt = {}) {
    return ["PENDING", "IN_PROGRESS"].includes(String(attempt.status || ""));
}

function renderOrderFulfillment(order) {
    const attempts = Array.isArray(order.fulfillmentAttempts) ? order.fulfillmentAttempts : [];
    const latest = order.fulfillment || attempts[0] || null;
    const active = latest && ["PENDING", "IN_PROGRESS"].includes(latest.status);
    const actions = order.actions || {};
    const hasProjectedStart = typeof actions.canStartFulfillment === "boolean";
    const canStart = hasProjectedStart
        ? actions.canStartFulfillment === true
        : ["paid", "failed"].includes(String(order.status || "")) && !active && latest?.status !== "SUCCEEDED";
    const blockReason = hasProjectedStart && !canStart ? fulfillmentBlockReasonText(actions.startFulfillmentBlockedReason) : "";

    return `
        <div class="order-detail-section fulfillment-order-section">
            <h4>${escapeFulfillmentHtml(adminT("fulfillment", "Fulfillment"))}</h4>
            ${latest ? `
                <p><span>${escapeFulfillmentHtml(adminT("fulfillment_id", "Fulfillment ID"))}</span><b>${escapeFulfillmentHtml(latest.fulfillmentId)}</b></p>
                <p><span>${escapeFulfillmentHtml(adminT("supplier", "Supplier"))}</span><b>${escapeFulfillmentHtml(latest.supplierCode)}</b></p>
                <p><span>${escapeFulfillmentHtml(adminT("status", "Status"))}</span><b>${escapeFulfillmentHtml(latest.status)}</b></p>
                ${latest.failureReason ? `<p><span>${escapeFulfillmentHtml(adminT("failure_reason", "Failure Reason"))}</span><b>${escapeFulfillmentHtml(latest.failureReason)}</b></p>` : ""}
                ${latest.supplierReference ? `<p><span>${escapeFulfillmentHtml(adminT("supplier_reference", "Supplier Reference"))}</span><b>${escapeFulfillmentHtml(latest.supplierReference)}</b></p>` : ""}
            ` : `<div class="order-evidence-empty">${escapeFulfillmentHtml(adminT("no_fulfillment_attempt", "No fulfillment attempt"))}</div>`}
            <div class="fulfillment-order-actions">
                ${canStart ? `<button class="admin-secondary-btn" type="button" data-start-fulfillment data-admin-permission="FULFILLMENT_EXECUTE">${escapeFulfillmentHtml(latest?.status === "FAILED" ? adminT("start_new_attempt", "Start New Attempt") : adminT("start_fulfillment", "Start Fulfillment"))}</button>` : ""}
                ${active ? `
                    <button class="admin-secondary-btn" type="button" data-order-mark-fulfilled="${escapeFulfillmentHtml(latest.fulfillmentId)}" data-admin-permission="FULFILLMENT_RESOLVE">${escapeFulfillmentHtml(adminT("mark_fulfilled", "Mark Fulfilled"))}</button>
                    <button class="admin-secondary-btn danger" type="button" data-order-mark-failed="${escapeFulfillmentHtml(latest.fulfillmentId)}" data-admin-permission="FULFILLMENT_RESOLVE">${escapeFulfillmentHtml(adminT("mark_failed", "Mark Failed"))}</button>
                ` : ""}
            </div>
            ${blockReason ? `<div class="order-evidence-empty">${escapeFulfillmentHtml(blockReason)}</div>` : ""}
        </div>
    `;
}

function fulfillmentBlockReasonText(code = "") {
    const messages = {
        ORDER_NOT_PAID: adminT("fulfillment_block_order_not_paid", "Payment is not confirmed."),
        REFUND_BLOCKS_FULFILLMENT: adminT("fulfillment_block_refund", "Refund state blocks fulfillment retry."),
        FULFILLMENT_ACTIVE: adminT("fulfillment_block_active", "Fulfillment is already active."),
        FULFILLMENT_ALREADY_SUCCEEDED: adminT("fulfillment_block_succeeded", "Order already has successful fulfillment."),
        ORDER_NOT_FULFILLMENT_ELIGIBLE: adminT("fulfillment_block_not_eligible", "Order is not eligible for fulfillment.")
    };
    return messages[code] || "";
}

function bindOrderFulfillment(panel, order) {
    panel.querySelector("[data-start-fulfillment]")?.addEventListener("click", event => startFulfillmentForAdminOrder(order, event.currentTarget));
    panel.querySelector("[data-order-mark-fulfilled]")?.addEventListener("click", event => markFulfillmentSucceeded(event.currentTarget.dataset.orderMarkFulfilled, event.currentTarget));
    panel.querySelector("[data-order-mark-failed]")?.addEventListener("click", event => markFulfillmentFailed(event.currentTarget.dataset.orderMarkFailed, event.currentTarget));
    window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.(panel);
}

function renderSupplierOptions() {
    const select = document.getElementById("mappingSupplierInput");
    if (!select) return;
    select.innerHTML = `<option value="">${escapeFulfillmentHtml(adminT("supplier", "Supplier"))}</option>` + fulfillmentSuppliers
        .filter(supplier => supplier.enabled)
        .map(supplier => `<option value="${escapeFulfillmentHtml(supplier.id)}">${escapeFulfillmentHtml(supplier.supplierCode)} · ${escapeFulfillmentHtml(supplier.name)}</option>`)
        .join("");
}

function renderProductOptions() {
    const select = document.getElementById("mappingProductInput");
    if (!select) return;
    select.innerHTML = `<option value="">${escapeFulfillmentHtml(adminT("product", "Product"))}</option>` + fulfillmentProducts
        .map(product => `<option value="${escapeFulfillmentHtml(product.productCode)}">${escapeFulfillmentHtml(product.name || product.productCode)}</option>`)
        .join("");
    renderMappingPackageOptions();
}

function normalizeSupplierCodeField(event) {
    const input = event.currentTarget;
    const normalized = normalizeSupplierCode(input.value).replace(/[^A-Z0-9_-]/g, "");
    if (input.value !== normalized) input.value = normalized;
}

function normalizeSupplierCode(value = "") {
    return String(value || "").trim().toUpperCase();
}

function normalizeSupplierRegionsInput(input) {
    if (!input) return [];
    const values = input.tagName === "SELECT"
        ? Array.from(input.selectedOptions || []).map(option => option.value)
        : String(input.value || "").split(/[\n,]+/);

    const regions = [];
    values.forEach(value => {
        const region = String(value || "").trim().toUpperCase();
        if (!region) return;
        if (!FULFILLMENT_REGIONS.includes(region)) {
            throw new Error(adminT("invalid_supplier_region", "Supported regions must be MM or TH."));
        }
        if (!regions.includes(region)) regions.push(region);
    });
    return regions;
}

function renderMappingPackageOptions() {
    const productCode = document.getElementById("mappingProductInput")?.value || "";
    const select = document.getElementById("mappingPackageInput");
    if (!select) return;
    const product = fulfillmentProducts.find(item => item.productCode === productCode);
    const packages = product?.packages || [];
    select.innerHTML = `<option value="">${escapeFulfillmentHtml(adminT("package", "Package"))}</option>` + packages
        .map(pkg => `<option value="${escapeFulfillmentHtml(pkg.packageCode)}">${escapeFulfillmentHtml(pkg.name || pkg.packageCode)}</option>`)
        .join("");
}

async function confirmFulfillmentAction(title, message) {
    if (window.AZIEL_ADMIN_ACTION_MODAL?.open) {
        const result = await window.AZIEL_ADMIN_ACTION_MODAL.open({
            title,
            message,
            input: false,
            confirmText: title
        });
        return result?.confirmed !== false;
    }
    return window.confirm(`${title}\n${message}`);
}

function formatFulfillmentDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function capitalizeFulfillment(value = "") {
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function escapeFulfillmentHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.AZIEL_ADMIN_FULFILLMENT = {
    bindOrderFulfillment,
    renderOrderFulfillment,
    startFulfillmentForAdminOrder
};
