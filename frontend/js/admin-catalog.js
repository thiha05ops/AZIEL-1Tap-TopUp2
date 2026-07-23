// frontend/js/admin-catalog.js
// AZIEL Admin V2.5 Read-only Catalog Command Center

let adminCatalogInitialized = false;
let catalogProducts = [];
let selectedCatalogProductCode = "";
let catalogSource = "";
let catalogActiveSource = "";
let selectedCatalogProduct = null;
let selectedCatalogBanners = [];
let catalogPackageEditDraft = null;
let catalogPackageSavePending = false;
let activeCatalogView = "products";
let activeCatalogTab = "overview";
let storefrontSections = [];
let catalogPackageSearch = "";
let catalogPackageStatusFilter = "all";
let catalogHighlightedPackageCode = "";

document.addEventListener("DOMContentLoaded", () => {
    initAdminCatalogController();
});

function initAdminCatalogController() {
    if (adminCatalogInitialized) return;
    adminCatalogInitialized = true;

    document.getElementById("refreshCatalogBtn")?.addEventListener("click", () => {
        loadAdminCatalog(true);
    });
    document.getElementById("refreshStorefrontSectionsBtn")?.addEventListener("click", () => {
        loadStorefrontSections(true);
    });

    document.querySelectorAll("[data-catalog-view]").forEach(btn => {
        btn.addEventListener("click", () => {
            setCatalogView(btn.dataset.catalogView || "products");
        });
    });

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "catalog") {
            loadAdminCatalog();
            loadStorefrontSections();
        }
    });

    window.addEventListener("aziel:admin-locale-changed", () => {
        renderCatalogProducts();
        renderStorefrontSections();
        if (selectedCatalogProductCode) {
            selectCatalogProduct(selectedCatalogProductCode, false);
        } else {
            renderCatalogEmpty();
        }
    });

    if (document.getElementById("section-catalog")?.classList.contains("active")) {
        loadAdminCatalog();
        loadStorefrontSections();
    }
}

function setCatalogView(view = "products") {
    activeCatalogView = view === "storefront" ? "storefront" : "products";

    document.querySelectorAll("[data-catalog-view]").forEach(btn => {
        const active = btn.dataset.catalogView === activeCatalogView;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    document.querySelectorAll("[data-catalog-panel]").forEach(panel => {
        panel.hidden = panel.dataset.catalogPanel !== activeCatalogView;
    });

    if (activeCatalogView === "storefront") {
        loadStorefrontSections();
    } else {
        loadAdminCatalog();
    }
}

async function loadAdminCatalog(force = false) {
    if (catalogProducts.length && !force) {
        renderCatalogProducts();
        return;
    }

    renderCatalogLoading();

    const data = await adminFetch("/api/admin/catalog/products");

    if (!data) return;

    if (!data.success) {
        renderCatalogError(data.message || adminT("catalog_data_unavailable", "Catalog data unavailable"));
        return;
    }

    catalogSource = data.source || "";
    catalogActiveSource = data.activeSource || data.source || "";
    catalogProducts = Array.isArray(data.products) ? data.products : [];
    selectedCatalogProductCode = catalogProducts[0]?.productCode || "";

    renderCatalogProducts();

    if (selectedCatalogProductCode) {
        await selectCatalogProduct(selectedCatalogProductCode, false);
    } else {
        renderCatalogEmpty(adminT("no_products_found", "No products found"));
    }
}

function renderCatalogLoading() {
    const list = document.getElementById("adminCatalogProducts");
    const detail = document.getElementById("adminCatalogDetailPanel");

    setCatalogSource("-");
    setCatalogActiveSource("-");

    if (list) {
        list.innerHTML = `
            <div class="admin-dashboard-skeleton"></div>
            <div class="admin-dashboard-skeleton"></div>
            <div class="admin-dashboard-skeleton"></div>
        `;
    }

    if (detail) {
        detail.innerHTML = `<p data-admin-i18n="loading_catalog">${adminT("loading_catalog", "Loading catalog")}</p>`;
    }
}

function renderCatalogProducts() {
    const list = document.getElementById("adminCatalogProducts");
    if (!list) return;

    setCatalogSource(catalogSource || "-");
    setCatalogActiveSource(catalogActiveSource || "-");

    if (!catalogProducts.length) {
        list.innerHTML = `<p class="admin-empty-state">${adminT("no_products_found", "No products found")}</p>`;
        return;
    }

    list.innerHTML = catalogProducts.map(product => {
        const active = product.productCode === selectedCatalogProductCode ? "active" : "";
        const regions = formatRegions(product.supportedRegions);
        const deleted = product.deleted || product.deletedAt;
        const statusKey = deleted ? "deleted" : (product.enabled ? "active" : "inactive");

        return `
            <button class="catalog-product-row ${active} ${deleted ? "is-deleted" : ""}" type="button" data-product-code="${escapeHtml(product.productCode)}">
                <span>
                    <strong>${escapeHtml(product.name)}</strong>
                    <small>${escapeHtml(product.productCode)}</small>
                </span>
                <span class="catalog-row-meta">
                    <b>${adminT(statusKey, deleted ? "Deleted" : (product.enabled ? "Active" : "Inactive"))}</b>
                    <small>${escapeHtml(regions)} · ${Number(product.packageCount || 0)} ${adminT("packages", "Packages")}</small>
                </span>
            </button>
        `;
    }).join("");

    list.querySelectorAll("[data-product-code]").forEach(btn => {
        btn.addEventListener("click", () => {
            selectCatalogProduct(btn.dataset.productCode);
            window.AZIEL_ADMIN_LAYOUT?.showDetail?.("catalog");
        });
    });
}

async function selectCatalogProduct(productCode, rerenderList = true) {
    selectedCatalogProductCode = productCode || "";
    if (rerenderList) renderCatalogProducts();

    const detail = document.getElementById("adminCatalogDetailPanel");
    if (detail) {
        detail.innerHTML = `<p data-admin-i18n="loading_catalog">${adminT("loading_catalog", "Loading catalog")}</p>`;
    }

    const data = await adminFetch(`/api/admin/catalog/products/${encodeURIComponent(selectedCatalogProductCode)}`);

    if (!data) return;

    if (!data.success) {
        renderCatalogDetailError(data.message || adminT("catalog_data_unavailable", "Catalog data unavailable"));
        return;
    }

    catalogSource = data.source || catalogSource;
    catalogActiveSource = data.activeSource || catalogActiveSource;
    setCatalogSource(catalogSource || "-");
    setCatalogActiveSource(catalogActiveSource || "-");
    const bannerData = await adminFetch(`/api/admin/catalog/products/${encodeURIComponent(selectedCatalogProductCode)}/banners`);
    selectedCatalogBanners = bannerData?.success && Array.isArray(bannerData.banners)
        ? bannerData.banners
        : [];
    renderCatalogDetail(data.product);
}

function renderCatalogDetail(product) {
    const detail = document.getElementById("adminCatalogDetailPanel");
    if (!detail || !product) return;

    selectedCatalogProduct = product;
    const packages = Array.isArray(product.packages) ? product.packages : [];
    const productDeleted = product.deleted || product.deletedAt;
    const mediaCount = [
        product.imageAsset || product.imageUrl,
        product.mobilePackagePreviewAsset || product.mobilePackagePreviewUrl,
        product.bannerAsset || product.bannerUrl
    ].filter(Boolean).length;
    const bannerCount = selectedCatalogBanners.length;

    detail.innerHTML = `
        <div class="catalog-detail-head catalog-workspace-head">
            <button class="admin-mobile-back-btn" type="button" data-mobile-back="catalog">
                ← ${adminT("back_to_catalog", "Catalog")}
            </button>
            <div class="catalog-workspace-title">
                <span>${adminT("product", "Product")}</span>
                <h3>${escapeHtml(product.name)}</h3>
                <p>
                    <b class="admin-status-pill ${productDeleted ? "is-danger" : (product.enabled ? "is-ok" : "is-muted")}">
                        ${adminT(productDeleted ? "deleted" : (product.enabled ? "enabled" : "disabled"), productDeleted ? "Deleted" : (product.enabled ? "Enabled" : "Disabled"))}
                    </b>
                    ${escapeHtml(product.productCode)} · ${escapeHtml(formatRegions(product.supportedRegions))} ·
                    ${Number(product.packageCount || packages.length)} ${adminT("packages", "Packages")}
                </p>
            </div>
            <div class="catalog-workspace-actions">
                <button class="admin-primary-btn catalog-primary-action" type="button" data-edit-product>
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>
                    ${adminT("edit_product", "Edit Product")}
                </button>
                <details class="catalog-action-menu">
                    <summary class="admin-icon-btn catalog-overflow-trigger" aria-label="${adminT("more_actions", "More Actions")}">
                        <i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i>
                    </summary>
                    <div class="catalog-action-menu-popover">
                        ${productDeleted
                            ? `<button type="button" data-product-restore><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>${adminT("restore_product", "Restore Product")}</button>`
                            : `<button class="${product.enabled ? "danger" : ""}" type="button" data-product-toggle="${product.enabled ? "disable" : "enable"}">
                                <i class="fa-solid ${product.enabled ? "fa-eye-slash" : "fa-eye"}" aria-hidden="true"></i>
                                ${adminT(product.enabled ? "disable_product" : "enable_product", product.enabled ? "Disable Product" : "Enable Product")}
                            </button>`}
                    </div>
                </details>
            </div>
        </div>

        <div class="catalog-workspace-tabs" role="tablist" aria-label="Product workspace">
            ${renderCatalogTabButton("overview", "Overview")}
            ${renderCatalogTabButton("packages", `Packages ${packages.length}`)}
            ${renderCatalogTabButton("media", `Media ${mediaCount}`)}
            ${renderCatalogTabButton("banners", `Banners ${bannerCount}`)}
        </div>

        <div class="catalog-workspace-tab-panel" data-catalog-tab-panel="${escapeHtml(activeCatalogTab)}">
            ${renderCatalogTabPanel(product, packages)}
        </div>
    `;

    detail.querySelector("[data-edit-product]")?.addEventListener("click", () => openProductEditor(product));
    detail.querySelector("[data-product-toggle]")?.addEventListener("click", () => toggleProductAvailability(product));
    detail.querySelector("[data-product-restore]")?.addEventListener("click", () => restoreProductRecord(product));
    detail.querySelector('[data-mobile-back="catalog"]')?.addEventListener("click", () => {
        window.AZIEL_ADMIN_LAYOUT?.showList?.("catalog");
    });
    detail.querySelectorAll("[data-catalog-tab]").forEach(btn => {
        btn.addEventListener("click", () => {
            activeCatalogTab = btn.dataset.catalogTab || "overview";
            renderCatalogDetail(product);
        });
    });
    bindActiveCatalogTab(detail, product, packages);
    window.AZIEL_ADMIN_I18N?.translate?.(detail);
}

function renderCatalogTabButton(tab, label) {
    const active = activeCatalogTab === tab ? "active" : "";
    return `
        <button class="catalog-workspace-tab ${active}" type="button" role="tab" aria-selected="${active ? "true" : "false"}" data-catalog-tab="${escapeHtml(tab)}">
            ${escapeHtml(label)}
        </button>
    `;
}

function renderCatalogTabPanel(product, packages) {
    if (activeCatalogTab === "packages") {
        return `
            <div class="catalog-package-table-wrap">
                <div class="panel-head catalog-package-head">
                    <div>
                        <h3 data-admin-i18n="packages">${adminT("packages", "Packages")}</h3>
                        <span>${packages.length} ${adminT("packages", "Packages")}</span>
                    </div>
                    <button class="admin-secondary-btn" type="button" data-add-package>${adminT("add_package", "Add Package")}</button>
                </div>
                <div class="catalog-package-toolbar">
                    <input type="search" data-package-search value="${escapeHtml(catalogPackageSearch)}" placeholder="Search packages">
                    <select data-package-status-filter>
                        <option value="all" ${catalogPackageStatusFilter === "all" ? "selected" : ""}>All</option>
                        <option value="enabled" ${catalogPackageStatusFilter === "enabled" ? "selected" : ""}>Enabled</option>
                        <option value="disabled" ${catalogPackageStatusFilter === "disabled" ? "selected" : ""}>Disabled</option>
                        <option value="deleted" ${catalogPackageStatusFilter === "deleted" ? "selected" : ""}>Deleted</option>
                    </select>
                </div>
                ${renderPackageTable(filterPackages(packages))}
            </div>
        `;
    }

    if (activeCatalogTab === "media") {
        return `
            <div class="catalog-media-panel">
                <div class="panel-head catalog-package-head">
                    <h3 data-admin-i18n="attached_media">${adminT("attached_media", "Attached Media")}</h3>
                </div>
                ${renderProductImageControl(product)}
                ${renderMobilePackagePreviewControl(product)}
            </div>
        `;
    }

    if (activeCatalogTab === "banners") {
        return `
            <div class="catalog-banners-panel">
                <div class="panel-head catalog-package-head">
                    <div>
                        <h3 data-admin-i18n="banners">${adminT("banners", "Banners")}</h3>
                        <span>${selectedCatalogBanners.length} ${adminT("banners", "Banners")}</span>
                    </div>
                    <button class="admin-secondary-btn" type="button" data-add-banner>${adminT("add_banner", "Add Banner")}</button>
                </div>
                ${renderBannerList(selectedCatalogBanners)}
            </div>
        `;
    }

    return `
        <section class="catalog-overview-panel">
            <article class="catalog-info-card catalog-info-card-wide">
                <span>${adminT("product_information", "Product Information")}</span>
                <h4>${escapeHtml(product.name)}</h4>
                <p>${escapeHtml(product.description || adminT("no_description_provided", "No description provided."))}</p>
                <dl>
                    ${detailDefinition("product_code", product.productCode)}
                    ${detailDefinition("supported_regions", formatRegions(product.supportedRegions))}
                    ${detailDefinition("status", product.deleted || product.deletedAt ? "Deleted" : (product.enabled ? "Enabled" : "Disabled"))}
                    ${detailDefinition("featured", product.featured ? "Yes" : "No")}
                </dl>
            </article>
            <article class="catalog-info-card">
                <span>${adminT("content_inventory", "Content Inventory")}</span>
                <div class="catalog-overview-metrics">
                    <b>${Number(product.packageCount || packages.length)}</b>
                    <small>${adminT("packages", "Packages")}</small>
                    <b>${selectedCatalogBanners.length}</b>
                    <small>${adminT("banners", "Banners")}</small>
                    <b>${[
                        product.imageAsset || product.imageUrl,
                        product.mobilePackagePreviewAsset || product.mobilePackagePreviewUrl,
                        product.bannerAsset || product.bannerUrl
                    ].filter(Boolean).length}</b>
                    <small>${adminT("media", "Media")}</small>
                </div>
            </article>
            <article class="catalog-info-card catalog-info-card-wide">
                <span>${adminT("seo", "SEO")}</span>
                <h4>${escapeHtml(product.seo?.title || adminT("seo_title_not_set", "SEO title not set"))}</h4>
                <p>${escapeHtml(product.seo?.description || adminT("seo_description_not_set", "SEO description not set"))}</p>
                <dl>
                    ${detailDefinition("active_runtime_source", catalogActiveSource || "-")}
                </dl>
            </article>
        </section>
    `;
}

function openProductEditor(product) {
    ensureProductEditorModal();
    const modal = document.getElementById("catalogProductEditModal");
    if (!modal) return;

    setProductDrawerTab("general");
    modal.querySelector("#catalogProductEditTitle").textContent = product.name || "";
    modal.querySelector("#catalogProductCode").value = product.productCode || "";
    modal.querySelector("#catalogProductName").value = product.name || "";
    modal.querySelector("#catalogProductDescription").value = product.description || "";
    modal.querySelector("#catalogProductRegionMM").checked = (product.supportedRegions || []).includes("MM");
    modal.querySelector("#catalogProductRegionTH").checked = (product.supportedRegions || []).includes("TH");
    modal.querySelector("#catalogProductEnabled").checked = product.enabled !== false;
    modal.querySelector("#catalogProductFeatured").checked = product.featured === true;
    modal.querySelector("#catalogProductSeoTitle").value = product.seo?.title || "";
    modal.querySelector("#catalogProductSeoDescription").value = product.seo?.description || "";
    modal.querySelector("#catalogProductImageLabel").textContent = product.imageAsset?.name || product.imageUrl || adminT("fallback_static_asset", "Static fallback asset");
    modal.querySelector("#catalogProductPreviewLabel").textContent = product.mobilePackagePreviewAsset?.name || product.mobilePackagePreviewUrl || adminT("fallback_static_asset", "Static fallback asset");
    const deleteBtn = modal.querySelector("#catalogProductDelete");
    const restoreBtn = modal.querySelector("#catalogProductRestore");
    if (deleteBtn) deleteBtn.hidden = Boolean(product.deleted || product.deletedAt);
    if (restoreBtn) restoreBtn.hidden = !Boolean(product.deleted || product.deletedAt);

    modal.classList.add("show");
    modal.querySelector("#catalogProductCancel").onclick = () => modal.classList.remove("show");
    modal.querySelector("#catalogProductCancelSecondary").onclick = () => modal.classList.remove("show");
    modal.querySelector("#catalogProductSave").onclick = () => saveProductEditor(product);
    modal.querySelector("#catalogProductImageChange").onclick = () => attachProductImage(product);
    modal.querySelector("#catalogProductImageRemove").onclick = () => clearProductImage(product);
    modal.querySelector("#catalogProductPreviewChange").onclick = () => attachMobilePackagePreview(product);
    modal.querySelector("#catalogProductPreviewRemove").onclick = () => clearMobilePackagePreview(product);
    modal.querySelector("#catalogProductDelete").onclick = () => softDeleteProductRecord(product);
    modal.querySelector("#catalogProductRestore").onclick = () => restoreProductRecord(product);
    modal.querySelectorAll("[data-product-drawer-tab]").forEach(btn => {
        btn.onclick = () => setProductDrawerTab(btn.dataset.productDrawerTab || "general");
    });
}

function ensureProductEditorModal() {
    if (document.getElementById("catalogProductEditModal")) return;

    const modal = document.createElement("div");
    modal.id = "catalogProductEditModal";
    modal.className = "admin-action-modal catalog-edit-modal catalog-product-drawer";
    modal.innerHTML = `
        <div class="admin-action-modal-box catalog-drawer-box" role="dialog" aria-modal="true" aria-labelledby="catalogProductEditTitle">
            <header class="catalog-drawer-header">
                <div>
                    <span>${adminT("product_settings", "Product Settings")}</span>
                    <h3 id="catalogProductEditTitle">${adminT("edit_product", "Edit Product")}</h3>
                </div>
                <button id="catalogProductCancel" class="admin-icon-btn" type="button" aria-label="${adminT("close", "Close")}">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </header>
            <nav class="catalog-drawer-tabs" aria-label="${adminT("product_editor_sections", "Product editor sections")}">
                <button type="button" data-product-drawer-tab="general">${adminT("general", "General")}</button>
                <button type="button" data-product-drawer-tab="visibility">${adminT("visibility", "Visibility")}</button>
                <button type="button" data-product-drawer-tab="seo">${adminT("seo", "SEO")}</button>
                <button type="button" data-product-drawer-tab="media">${adminT("media", "Media")}</button>
            </nav>
            <form class="catalog-drawer-body">
                <section data-product-drawer-panel="general">
                    <label>${adminT("product_code", "Product Code")} <input id="catalogProductCode" type="text" readonly></label>
                    <label>${adminT("product_name", "Product Name")} <input id="catalogProductName" type="text" maxlength="120" required></label>
                    <label>${adminT("description", "Description")} <textarea id="catalogProductDescription" maxlength="1200"></textarea></label>
                    <fieldset class="catalog-edit-fieldset catalog-chip-fieldset">
                        <legend>${adminT("supported_regions", "Supported Regions")}</legend>
                        <label class="catalog-choice-chip"><input id="catalogProductRegionMM" type="checkbox"> Myanmar</label>
                        <label class="catalog-choice-chip"><input id="catalogProductRegionTH" type="checkbox"> Thailand</label>
                    </fieldset>
                </section>
                <section data-product-drawer-panel="visibility" hidden>
                    <label class="catalog-toggle-row"><span>${adminT("enabled", "Enabled")}</span><input id="catalogProductEnabled" type="checkbox"></label>
                    <label class="catalog-toggle-row"><span>${adminT("featured", "Featured")}</span><input id="catalogProductFeatured" type="checkbox"></label>
                </section>
                <section data-product-drawer-panel="seo" hidden>
                    <label>${adminT("seo_title", "SEO Title")} <input id="catalogProductSeoTitle" type="text" maxlength="90"></label>
                    <label>${adminT("seo_description", "SEO Description")} <textarea id="catalogProductSeoDescription" maxlength="180"></textarea></label>
                </section>
                <section data-product-drawer-panel="media" hidden>
                    <div class="catalog-editor-media-actions">
                        <p><b>${adminT("product_image", "Product Image")}</b><br><small id="catalogProductImageLabel"></small></p>
                        <button id="catalogProductImageChange" class="admin-secondary-btn" type="button">${adminT("change_image", "Replace")}</button>
                        <button id="catalogProductImageRemove" class="admin-icon-btn danger" type="button">${adminT("remove_image", "Remove")}</button>
                        <p><b>${adminT("mobile_package_preview", "Mobile Package Preview")}</b><br><small id="catalogProductPreviewLabel"></small></p>
                        <button id="catalogProductPreviewChange" class="admin-secondary-btn" type="button">${adminT("select_image", "Replace")}</button>
                        <button id="catalogProductPreviewRemove" class="admin-icon-btn danger" type="button">${adminT("remove_image", "Remove")}</button>
                    </div>
                </section>
            </form>
            <div class="admin-action-modal-actions catalog-editor-danger-actions">
                <button id="catalogProductDelete" class="admin-icon-btn danger" type="button">
                    <i class="fa-solid fa-trash" aria-hidden="true"></i>
                    ${adminT("delete_product", "Delete Product")}
                </button>
                <button id="catalogProductRestore" class="admin-secondary-btn" type="button">
                    <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                    ${adminT("restore_product", "Restore Product")}
                </button>
            </div>
            <div class="admin-action-modal-actions catalog-drawer-footer">
                <button id="catalogProductCancelSecondary" type="button">${adminT("cancel", "Cancel")}</button>
                <button id="catalogProductSave" class="admin-primary-btn" type="button">${adminT("save_changes", "Save Changes")}</button>
            </div>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("show");
    });
    document.body.appendChild(modal);
}

function setProductDrawerTab(tab = "general") {
    const modal = document.getElementById("catalogProductEditModal");
    if (!modal) return;
    modal.querySelectorAll("[data-product-drawer-tab]").forEach(btn => {
        const active = btn.dataset.productDrawerTab === tab;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    modal.querySelectorAll("[data-product-drawer-panel]").forEach(panel => {
        panel.hidden = panel.dataset.productDrawerPanel !== tab;
    });
}

function readProductEditorPayload(product) {
    const modal = document.getElementById("catalogProductEditModal");
    const supportedRegions = [];
    if (modal.querySelector("#catalogProductRegionMM")?.checked) supportedRegions.push("MM");
    if (modal.querySelector("#catalogProductRegionTH")?.checked) supportedRegions.push("TH");

    return {
        name: modal.querySelector("#catalogProductName")?.value || "",
        description: modal.querySelector("#catalogProductDescription")?.value || "",
        supportedRegions,
        enabled: Boolean(modal.querySelector("#catalogProductEnabled")?.checked),
        featured: Boolean(modal.querySelector("#catalogProductFeatured")?.checked),
        seo: {
            title: modal.querySelector("#catalogProductSeoTitle")?.value || "",
            description: modal.querySelector("#catalogProductSeoDescription")?.value || ""
        },
        expectedUpdatedAt: product.updatedAt
    };
}

async function saveProductEditor(product) {
    const modal = document.getElementById("catalogProductEditModal");
    if (!modal?.classList.contains("show")) return;

    const payload = readProductEditorPayload(product);
    if (!payload.name.trim() || !payload.supportedRegions.length) {
        showAdminToast?.(adminT("catalog_update_failed", "Catalog update failed"), "error");
        return;
    }

    modal.classList.remove("show");
    const data = await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}`, payload);
    if (!data?.success) {
        modal.classList.add("show");
    } else {
        showAdminToast?.(adminT("product_saved", "Product saved"), "success");
    }
}

function filterPackages(packages = []) {
    const query = catalogPackageSearch.trim().toLowerCase();
    return packages.filter(item => {
        const deleted = item.deleted || item.deletedAt;
        if (catalogPackageStatusFilter === "deleted") {
            if (!deleted) return false;
        } else if (deleted) {
            return false;
        }
        if (catalogPackageStatusFilter === "enabled" && item.enabled === false) return false;
        if (catalogPackageStatusFilter === "disabled" && item.enabled !== false) return false;
        if (!query) return true;
        return String(item.name || "").toLowerCase().includes(query) ||
            String(item.packageCode || "").toLowerCase().includes(query);
    });
}

function bindActiveCatalogTab(detail, product, packages) {
    if (activeCatalogTab === "media") {
        detail.querySelector("[data-change-product-image]")?.addEventListener("click", () => attachProductImage(product));
        detail.querySelector("[data-remove-product-image]")?.addEventListener("click", () => clearProductImage(product));
        detail.querySelector("[data-change-mobile-preview]")?.addEventListener("click", () => attachMobilePackagePreview(product));
        detail.querySelector("[data-remove-mobile-preview]")?.addEventListener("click", () => clearMobilePackagePreview(product));
    }

    if (activeCatalogTab === "packages") {
        detail.querySelectorAll("[data-add-package]").forEach(btn => {
            btn.addEventListener("click", () => openPackageCreatePanel(product));
        });
        detail.querySelector("[data-package-search]")?.addEventListener("input", event => {
            catalogPackageSearch = event.target.value || "";
            renderCatalogDetail(product);
        });
        detail.querySelector("[data-package-status-filter]")?.addEventListener("change", event => {
            catalogPackageStatusFilter = event.target.value || "all";
            renderCatalogDetail(product);
        });
        bindPackageDrag(detail, product, packages);
    }

    detail.querySelectorAll("[data-edit-package]").forEach(btn => {
        btn.addEventListener("click", () => {
            const pkg = packages.find(item => item.packageCode === btn.dataset.editPackage);
            if (pkg) openPackageEditPanel(product, pkg);
        });
    });
    detail.querySelectorAll("[data-toggle-package]").forEach(btn => {
        btn.addEventListener("click", () => {
            const pkg = packages.find(item => item.packageCode === btn.dataset.togglePackage);
            if (pkg) togglePackageAvailability(product, pkg);
        });
    });
    detail.querySelectorAll("[data-delete-package]").forEach(btn => {
        btn.addEventListener("click", () => {
            const pkg = packages.find(item => item.packageCode === btn.dataset.deletePackage);
            if (pkg) softDeletePackageRecord(product, pkg);
        });
    });
    detail.querySelectorAll("[data-restore-package]").forEach(btn => {
        btn.addEventListener("click", () => {
            const pkg = packages.find(item => item.packageCode === btn.dataset.restorePackage);
            if (pkg) restorePackageRecord(product, pkg);
        });
    });
    detail.querySelectorAll("[data-change-package-icon]").forEach(btn => {
        btn.addEventListener("click", () => {
            const pkg = packages.find(item => item.packageCode === btn.dataset.changePackageIcon);
            if (pkg) attachPackageIcon(product, pkg);
        });
    });
    detail.querySelectorAll("[data-remove-package-icon]").forEach(btn => {
        btn.addEventListener("click", () => {
            const pkg = packages.find(item => item.packageCode === btn.dataset.removePackageIcon);
            if (pkg) clearPackageIcon(product, pkg);
        });
    });

    if (activeCatalogTab === "banners") {
        bindBannerControls(detail, product);
        bindBannerDrag(detail, product);
        detail.querySelectorAll("[data-add-banner]").forEach(btn => {
            btn.addEventListener("click", () => openBannerEditor(product));
        });
    }
}

function getSelectedProductPackages() {
    return Array.isArray(selectedCatalogProduct?.packages) ? selectedCatalogProduct.packages : [];
}

function reorderPackageList(packageCode, targetCodeOrDirection) {
    const packages = [...getSelectedProductPackages()];
    const currentIndex = packages.findIndex(item => item.packageCode === packageCode);
    if (currentIndex < 0) return packages;

    let nextIndex = currentIndex;
    if (typeof targetCodeOrDirection === "number") {
        nextIndex = currentIndex + targetCodeOrDirection;
    } else {
        nextIndex = packages.findIndex(item => item.packageCode === targetCodeOrDirection);
    }

    if (nextIndex < 0 || nextIndex >= packages.length || nextIndex === currentIndex) return packages;
    const [moved] = packages.splice(currentIndex, 1);
    packages.splice(nextIndex, 0, moved);
    return packages;
}

async function persistPackageOrder(product, nextPackages) {
    const previousPackages = [...getSelectedProductPackages()];
    selectedCatalogProduct = {
        ...selectedCatalogProduct,
        packages: nextPackages.map((item, index) => ({ ...item, sortOrder: index + 1 }))
    };
    renderCatalogDetail(selectedCatalogProduct);

    const data = await adminFetch(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/packages/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedPackageCodes: nextPackages.map(item => item.packageCode) })
    });

    if (!data?.success || !data.product) {
        selectedCatalogProduct = { ...selectedCatalogProduct, packages: previousPackages };
        renderCatalogDetail(selectedCatalogProduct);
        showAdminToast?.(data?.message || "Could not update package order. Previous order restored.", "error");
        return;
    }

    selectedCatalogProduct = data.product;
    showAdminToast?.("Package order updated", "success");
    await selectCatalogProduct(product.productCode, false);
}

function bindPackageDrag(root, product) {
    let draggedCode = "";

    root.querySelectorAll("[data-package-drag]").forEach(handle => {
        handle.addEventListener("dragstart", event => {
            draggedCode = handle.dataset.packageDrag || "";
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", draggedCode);
        });
    });

    root.querySelectorAll("[data-package-row]").forEach(row => {
        row.addEventListener("dragover", event => {
            if (!draggedCode) return;
            event.preventDefault();
            row.classList.add("is-drag-over");
        });
        row.addEventListener("dragleave", () => row.classList.remove("is-drag-over"));
        row.addEventListener("drop", event => {
            event.preventDefault();
            row.classList.remove("is-drag-over");
            const targetCode = row.dataset.packageRow || "";
            if (!draggedCode || draggedCode === targetCode) return;
            persistPackageOrder(product, reorderPackageList(draggedCode, targetCode));
            draggedCode = "";
        });
    });

    root.querySelectorAll("[data-move-package-up]").forEach(btn => {
        btn.addEventListener("click", () => {
            persistPackageOrder(product, reorderPackageList(btn.dataset.movePackageUp, -1));
        });
    });

    root.querySelectorAll("[data-move-package-down]").forEach(btn => {
        btn.addEventListener("click", () => {
            persistPackageOrder(product, reorderPackageList(btn.dataset.movePackageDown, 1));
        });
    });
}

function bindBannerDrag(root, product) {
    let draggedId = "";

    root.querySelectorAll("[data-banner-drag]").forEach(handle => {
        handle.addEventListener("dragstart", event => {
            draggedId = handle.dataset.bannerDrag || "";
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", draggedId);
        });
    });

    root.querySelectorAll("[data-banner-id]").forEach(row => {
        row.addEventListener("dragover", event => {
            if (!draggedId) return;
            event.preventDefault();
            row.classList.add("is-drag-over");
        });
        row.addEventListener("dragleave", () => row.classList.remove("is-drag-over"));
        row.addEventListener("drop", event => {
            event.preventDefault();
            row.classList.remove("is-drag-over");
            const targetId = row.dataset.bannerId || "";
            if (!draggedId || draggedId === targetId) return;
            const currentIndex = selectedCatalogBanners.findIndex(item => item.id === draggedId);
            const targetIndex = selectedCatalogBanners.findIndex(item => item.id === targetId);
            if (currentIndex < 0 || targetIndex < 0) return;
            const next = [...selectedCatalogBanners];
            const [moved] = next.splice(currentIndex, 1);
            next.splice(targetIndex, 0, moved);
            persistBannerOrder(product, next);
            draggedId = "";
        });
    });
}

function renderProductImageControl(product) {
    const asset = product.imageAsset || null;
    const imageUrl = asset?.secureUrl || asset?.url || product.imageUrl || "";

    return `
        <div class="catalog-media-control">
            <div class="catalog-media-preview">
                ${imageUrl
                    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(asset?.altText || product.name)}">`
                    : `<span>${adminT("fallback_static_asset", "Static fallback asset")}</span>`}
            </div>
            <div>
                <strong>${adminT("product_image", "Product Image")}</strong>
                <small>${asset ? escapeHtml(asset.name) : adminT("fallback_static_asset", "Static fallback asset")}</small>
            </div>
            <div class="catalog-package-actions">
                <button class="admin-icon-btn" type="button" data-change-product-image>${adminT("change_image", "Change Image")}</button>
                ${asset ? `<button class="admin-icon-btn danger" type="button" data-remove-product-image>${adminT("remove_image", "Remove Image")}</button>` : ""}
            </div>
        </div>
    `;
}

function renderMobilePackagePreviewControl(product) {
    const asset = product.mobilePackagePreviewAsset || product.mobilePackagePreview?.asset || null;
    const imageUrl = asset?.secureUrl || asset?.url || product.mobilePackagePreviewUrl || product.mobilePackagePreview?.url || "";

    return `
        <div class="catalog-media-control catalog-mobile-preview-control">
            <div class="catalog-media-preview catalog-media-preview-square">
                ${imageUrl
                    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(asset?.altText || product.name)}">`
                    : `<span>${adminT("fallback_static_asset", "Static fallback asset")}</span>`}
            </div>
            <div>
                <strong>${adminT("mobile_package_preview", "Mobile Package Preview")}</strong>
                <small>${asset ? escapeHtml(asset.name) : adminT("fallback_static_asset", "Static fallback asset")}</small>
                <small>${adminT("mobile_package_preview_helper", "Shown on mobile before a package is selected.")}</small>
                <small>${adminT("mobile_package_preview_recommendation", "Square PNG or WebP recommended.")}</small>
            </div>
            <div class="catalog-package-actions">
                <button class="admin-icon-btn" type="button" data-change-mobile-preview>${adminT("select_image", "Select Image")}</button>
                ${asset ? `<button class="admin-icon-btn danger" type="button" data-remove-mobile-preview>${adminT("remove_image", "Remove Image")}</button>` : ""}
            </div>
        </div>
    `;
}

function renderPackageTable(packages) {
    if (!packages.length) {
        return renderCatalogEmptyState({
            icon: "fa-solid fa-box-open",
            title: adminT(catalogPackageStatusFilter === "deleted" ? "no_deleted_packages" : "no_packages_found", catalogPackageStatusFilter === "deleted" ? "No deleted packages" : "No packages found"),
            description: adminT("catalog_empty_packages_helper", "Packages for this product will appear here."),
            action: catalogPackageStatusFilter === "deleted" ? "" : `<button class="admin-primary-btn" type="button" data-add-package>${adminT("add_package", "Add Package")}</button>`
        });
    }

    return `
        <div class="catalog-package-table">
            <div class="catalog-package-row catalog-package-header">
                <span>Order</span>
                <span data-admin-i18n="package_code">${adminT("package_code", "Package Code")}</span>
                <span data-admin-i18n="package_name">${adminT("package_name", "Package Name")}</span>
                <span data-admin-i18n="package_icon">${adminT("package_icon", "Package Icon")}</span>
                <span data-admin-i18n="mmk_price">${adminT("mmk_price", "MMK Price")}</span>
                <span data-admin-i18n="thb_price">${adminT("thb_price", "THB Price")}</span>
                <span data-admin-i18n="status">${adminT("status", "Status")}</span>
                <span data-admin-i18n="action">${adminT("action", "Action")}</span>
            </div>
            ${packages.map((item, index) => {
                const deleted = item.deleted || item.deletedAt;
                const highlighted = catalogHighlightedPackageCode === item.packageCode ? "is-highlighted" : "";
                return `
                <div class="catalog-package-row ${deleted ? "is-deleted" : ""} ${highlighted}" data-package-row="${escapeHtml(item.packageCode)}" draggable="false">
                    <span class="catalog-reorder-cell">
                        <button class="catalog-drag-handle" type="button" draggable="true" data-package-drag="${escapeHtml(item.packageCode)}" aria-label="Drag package ${escapeHtml(item.name)}" ${deleted ? "disabled" : ""}><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></button>
                        <small>${Number(item.sortOrder || index + 1)}</small>
                    </span>
                    <span><b>${escapeHtml(item.packageCode)}</b></span>
                    <span>${escapeHtml(item.name)}</span>
                    <span class="catalog-icon-cell">${renderPackageIconControl(item)}</span>
                    <span>${formatRegionalPrice(item.prices?.MM)}</span>
                    <span>${formatRegionalPrice(item.prices?.TH)}</span>
                    <span><b class="admin-status-pill ${deleted ? "is-danger" : (item.enabled ? "is-ok" : "is-muted")}">${adminT(deleted ? "deleted" : (item.enabled ? "enabled" : "disabled"), deleted ? "Deleted" : (item.enabled ? "Enabled" : "Disabled"))}</b></span>
                    <span class="catalog-package-actions">
                        <button class="admin-icon-btn catalog-row-primary-action" type="button" data-edit-package="${escapeHtml(item.packageCode)}">
                            <i class="fa-solid fa-pen" aria-hidden="true"></i>
                            ${adminT("edit", "Edit")}
                        </button>
                        ${deleted
                            ? `<button class="admin-icon-btn" type="button" data-restore-package="${escapeHtml(item.packageCode)}"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>${adminT("restore_package", "Restore")}</button>`
                            : `
                        <details class="catalog-action-menu">
                            <summary class="admin-icon-btn catalog-overflow-trigger" aria-label="${adminT("more_actions", "More Actions")}"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></summary>
                            <div class="catalog-action-menu-popover">
                                <span class="catalog-menu-group-label">${adminT("media", "Media")}</span>
                                <button type="button" data-change-package-icon="${escapeHtml(item.packageCode)}"><i class="fa-regular fa-image" aria-hidden="true"></i>${adminT("change_icon", "Change Icon")}</button>
                                ${item.iconAsset || item.iconUrl ? `<button class="danger" type="button" data-remove-package-icon="${escapeHtml(item.packageCode)}"><i class="fa-solid fa-image-slash" aria-hidden="true"></i>${adminT("remove_icon", "Remove Icon")}</button>` : ""}
                                <span class="catalog-menu-group-label">${adminT("order", "Order")}</span>
                                <button type="button" data-move-package-up="${escapeHtml(item.packageCode)}" ${index === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i>${adminT("move_up", "Move Up")}</button>
                                <button type="button" data-move-package-down="${escapeHtml(item.packageCode)}" ${index === packages.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down" aria-hidden="true"></i>${adminT("move_down", "Move Down")}</button>
                                <span class="catalog-menu-group-label">${adminT("visibility", "Visibility")}</span>
                                <button class="${item.enabled ? "danger" : ""}" type="button" data-toggle-package="${escapeHtml(item.packageCode)}">
                                    <i class="fa-solid ${item.enabled ? "fa-eye-slash" : "fa-eye"}" aria-hidden="true"></i>
                                    ${adminT(item.enabled ? "disable_package" : "enable_package", item.enabled ? "Disable" : "Enable")}
                                </button>
                                <span class="catalog-menu-group-label catalog-menu-danger-label">${adminT("danger_zone", "Danger")}</span>
                                <button class="danger" type="button" data-delete-package="${escapeHtml(item.packageCode)}"><i class="fa-solid fa-trash" aria-hidden="true"></i>${adminT("delete", "Delete")}</button>
                            </div>
                        </details>`}
                    </span>
                </div>
            `;}).join("")}
        </div>
    `;
}

function renderBannerList(banners = []) {
    if (!banners.length) {
        return renderCatalogEmptyState({
            icon: "fa-regular fa-image",
            title: adminT("no_banners_found", "No banners found"),
            description: adminT("catalog_empty_banners_helper", "Game page banners for this product will appear here."),
            action: `<button class="admin-primary-btn" type="button" data-add-banner>${adminT("add_banner", "Add Banner")}</button>`
        });
    }

    return `
        <div class="catalog-banner-list">
            ${banners.map((banner, index) => `
                <article class="catalog-banner-row ${banner.deleted ? "is-deleted" : ""}" data-banner-id="${escapeHtml(banner.id)}">
                    <button class="catalog-drag-handle" type="button" draggable="true" data-banner-drag="${escapeHtml(banner.id)}" aria-label="Drag banner ${escapeHtml(banner.name)}" ${banner.deleted ? "disabled" : ""}><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></button>
                    <div class="catalog-banner-preview">
                        ${banner.mediaAsset?.secureUrl || banner.mediaAsset?.url
                            ? `<img src="${escapeHtml(banner.mediaAsset.secureUrl || banner.mediaAsset.url)}" alt="${escapeHtml(banner.mediaAsset.altText || banner.name)}">`
                            : `<span>${adminT("banner_image", "Banner Image")}</span>`}
                    </div>
                    <div>
                        <strong>${escapeHtml(banner.name)}</strong>
                        <small>${adminT(banner.deleted ? "deleted" : (banner.enabled ? "enabled" : "disabled"), banner.deleted ? "Deleted" : (banner.enabled ? "Enabled" : "Disabled"))} · ${adminT("sort_order", "Sort Order")} ${Number(banner.sortOrder || 0)}</small>
                        <small>${formatBannerSchedule(banner)}</small>
                    </div>
                    <div class="catalog-package-actions">
                        <button class="admin-icon-btn catalog-row-primary-action" type="button" data-edit-banner="${escapeHtml(banner.id)}"><i class="fa-solid fa-pen" aria-hidden="true"></i>${adminT("edit", "Edit")}</button>
                        ${banner.deleted
                            ? `<button class="admin-icon-btn" type="button" data-restore-banner="${escapeHtml(banner.id)}"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>${adminT("restore", "Restore")}</button>`
                            : `
                        <details class="catalog-action-menu">
                            <summary class="admin-icon-btn catalog-overflow-trigger" aria-label="${adminT("more_actions", "More Actions")}"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></summary>
                            <div class="catalog-action-menu-popover">
                                <span class="catalog-menu-group-label">${adminT("visibility", "Visibility")}</span>
                                <button type="button" data-toggle-banner="${escapeHtml(banner.id)}"><i class="fa-solid ${banner.enabled ? "fa-eye-slash" : "fa-eye"}" aria-hidden="true"></i>${adminT(banner.enabled ? "disable" : "enable", banner.enabled ? "Disable" : "Enable")}</button>
                                <span class="catalog-menu-group-label">${adminT("order", "Order")}</span>
                                <button type="button" data-move-banner-up="${escapeHtml(banner.id)}" ${index === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i>${adminT("move_up", "Move Up")}</button>
                                <button type="button" data-move-banner-down="${escapeHtml(banner.id)}" ${index === banners.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down" aria-hidden="true"></i>${adminT("move_down", "Move Down")}</button>
                                <span class="catalog-menu-group-label catalog-menu-danger-label">${adminT("danger_zone", "Danger")}</span>
                                <button class="danger" type="button" data-remove-banner="${escapeHtml(banner.id)}"><i class="fa-solid fa-trash" aria-hidden="true"></i>${adminT("remove", "Remove")}</button>
                            </div>
                        </details>`}
                    </div>
                </article>
            `).join("")}
        </div>
    `;
}

function bindBannerControls(root, product) {
    root.querySelectorAll("[data-edit-banner]").forEach(btn => {
        btn.addEventListener("click", () => {
            const banner = selectedCatalogBanners.find(item => item.id === btn.dataset.editBanner);
            if (banner) openBannerEditor(product, banner);
        });
    });
    root.querySelectorAll("[data-toggle-banner]").forEach(btn => {
        btn.addEventListener("click", () => {
            const banner = selectedCatalogBanners.find(item => item.id === btn.dataset.toggleBanner);
            if (banner) saveBanner(product, { ...banner, enabled: !banner.enabled }, banner);
        });
    });
    root.querySelectorAll("[data-remove-banner]").forEach(btn => {
        btn.addEventListener("click", () => removeBanner(product, btn.dataset.removeBanner));
    });
    root.querySelectorAll("[data-restore-banner]").forEach(btn => {
        btn.addEventListener("click", () => restoreBannerRecord(product, btn.dataset.restoreBanner));
    });
    root.querySelectorAll("[data-move-banner-up]").forEach(btn => {
        btn.addEventListener("click", () => moveBanner(product, btn.dataset.moveBannerUp, -1));
    });
    root.querySelectorAll("[data-move-banner-down]").forEach(btn => {
        btn.addEventListener("click", () => moveBanner(product, btn.dataset.moveBannerDown, 1));
    });
}

function formatBannerSchedule(banner) {
    const start = banner.startsAt ? new Date(banner.startsAt).toLocaleString() : "";
    const end = banner.endsAt ? new Date(banner.endsAt).toLocaleString() : "";
    if (start && end) return `${start} → ${end}`;
    if (start) return `${adminT("start_date", "Start Date")}: ${start}`;
    if (end) return `${adminT("end_date", "End Date")}: ${end}`;
    return adminT("not_scheduled", "Not scheduled");
}

function formatSupplierMapping(pkg = {}) {
    const mapping = pkg.supplierMapping || pkg.metadata?.supplierMapping || null;
    if (!mapping) {
        return adminT("supplier_mapping_managed_elsewhere", "Managed in Fulfillment");
    }

    if (typeof mapping === "string") return mapping;
    return [
        mapping.supplierCode,
        mapping.supplierProductCode,
        mapping.supplierPackageCode
    ].filter(Boolean).join(" / ") || adminT("supplier_mapping_managed_elsewhere", "Managed in Fulfillment");
}

function renderPackageIconControl(item) {
    const asset = item.iconAsset || null;
    const imageUrl = asset?.secureUrl || asset?.url || item.iconUrl || "";

    return `
        <span class="catalog-icon-control">
            ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(asset?.altText || item.name)}">` : `<b>-</b>`}
        </span>
    `;
}

async function attachProductImage(product) {
    const asset = await window.AZIEL_ADMIN_MEDIA_SELECTOR?.open?.({ category: "product_image" });
    if (!asset) return;

    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/presentation/image`, {
        assetId: asset.assetId,
        expectedUpdatedAt: product.updatedAt
    });
}

async function clearProductImage(product) {
    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/presentation/image`, {
        expectedUpdatedAt: product.updatedAt
    }, {
        method: "DELETE"
    });
}

async function attachMobilePackagePreview(product) {
    const asset = await window.AZIEL_ADMIN_MEDIA_SELECTOR?.open?.({ category: "product_image" });
    if (!asset) return;

    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/presentation/mobile-package-preview`, {
        assetId: asset.assetId,
        expectedUpdatedAt: product.updatedAt
    });
}

async function clearMobilePackagePreview(product) {
    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/presentation/mobile-package-preview`, {
        expectedUpdatedAt: product.updatedAt
    }, {
        method: "DELETE"
    });
}

async function attachPackageIcon(product, pkg) {
    const asset = await window.AZIEL_ADMIN_MEDIA_SELECTOR?.open?.({ category: "package_icon" });
    if (!asset) return;

    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/packages/${encodeURIComponent(pkg.packageCode)}/presentation/icon`, {
        assetId: asset.assetId,
        expectedUpdatedAt: pkg.updatedAt
    });
}

async function clearPackageIcon(product, pkg) {
    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/packages/${encodeURIComponent(pkg.packageCode)}/presentation/icon`, {
        expectedUpdatedAt: pkg.updatedAt
    }, {
        method: "DELETE"
    });
}

function openPackageCreatePanel(product) {
    ensurePackageCreateModal();
    const modal = document.getElementById("catalogPackageCreateModal");
    modal.querySelector("form")?.reset();
    modal.dataset.iconAssetId = "";
    modal.querySelector("#catalogCreateProductName").textContent = product.name;
    modal.classList.add("show");
    modal.querySelector("#catalogCreateCancel").onclick = () => modal.classList.remove("show");
    modal.querySelector("#catalogCreateIcon").onclick = async () => {
        const asset = await window.AZIEL_ADMIN_MEDIA_SELECTOR?.open?.({ category: "package_icon" });
        if (!asset) return;
        modal.dataset.iconAssetId = asset.assetId;
        modal.querySelector("#catalogCreateIconLabel").textContent = asset.name || asset.assetId;
    };
    modal.querySelector("#catalogCreateSave").onclick = () => handlePackageCreateSave(product);
}

function ensurePackageCreateModal() {
    if (document.getElementById("catalogPackageCreateModal")) return;

    const modal = document.createElement("div");
    modal.id = "catalogPackageCreateModal";
    modal.className = "admin-action-modal catalog-edit-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box">
            <h3>${adminT("add_package", "Add Package")}</h3>
            <p><b id="catalogCreateProductName"></b></p>
            <form>
                <label>${adminT("package_code", "Package Code")} <input id="catalogCreateCode" type="text" required></label>
                <label>${adminT("package_name", "Package Name")} <input id="catalogCreateName" type="text" required></label>
                <label>${adminT("sort_order", "Sort Order")} <input id="catalogCreateSort" type="number" step="1" value="0"></label>
                <label><input id="catalogCreateEnabled" type="checkbox" checked> ${adminT("enabled", "Enabled")}</label>
                <label><input id="catalogCreateMMEnabled" type="checkbox" checked> ${adminT("mm_available", "MM Available")}</label>
                <label>${adminT("mmk_price", "MMK Price")} <input id="catalogCreateMM" type="number" step="0.01" min="0"></label>
                <label><input id="catalogCreateTHEnabled" type="checkbox"> ${adminT("th_available", "TH Available")}</label>
                <label>${adminT("thb_price", "THB Price")} <input id="catalogCreateTH" type="number" step="0.01" min="0"></label>
            </form>
            <button id="catalogCreateIcon" class="admin-secondary-btn" type="button">${adminT("select_package_icon", "Select Package Icon")}</button>
            <p id="catalogCreateIconLabel">${adminT("fallback_static_asset", "Static fallback asset")}</p>
            <div class="admin-action-modal-actions">
                <button id="catalogCreateCancel" type="button">${adminT("cancel", "Cancel")}</button>
                <button id="catalogCreateSave" type="button">${adminT("add_package", "Add Package")}</button>
            </div>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("show");
    });
    document.body.appendChild(modal);
}

async function handlePackageCreateSave(product) {
    const modal = document.getElementById("catalogPackageCreateModal");
    if (!modal?.classList.contains("show")) return;

    const payload = {
        packageCode: modal.querySelector("#catalogCreateCode")?.value || "",
        name: modal.querySelector("#catalogCreateName")?.value || "",
        enabled: Boolean(modal.querySelector("#catalogCreateEnabled")?.checked),
        sortOrder: modal.querySelector("#catalogCreateSort")?.value || 0,
        iconAssetId: modal.dataset.iconAssetId || "",
        prices: {
            MM: {
                enabled: Boolean(modal.querySelector("#catalogCreateMMEnabled")?.checked),
                amount: modal.querySelector("#catalogCreateMM")?.value || ""
            },
            TH: {
                enabled: Boolean(modal.querySelector("#catalogCreateTHEnabled")?.checked),
                amount: modal.querySelector("#catalogCreateTH")?.value || ""
            }
        }
    };

    modal.classList.remove("show");
    const confirmed = await confirmCatalogAction({
        title: adminT("add_package", "Add Package"),
        message: `${payload.packageCode}\n${payload.name}\n${adminT("historical_orders_not_changed", "Historical orders will not be changed.")}`,
        confirmText: adminT("add_package", "Add Package")
    });

    if (!confirmed) {
        modal.classList.add("show");
        return;
    }

    const result = await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/packages`, payload, {
        method: "POST"
    });

    if (result?.success) {
        catalogHighlightedPackageCode = result.package?.packageCode || payload.packageCode;
        activeCatalogTab = "packages";
        if (selectedCatalogProduct) renderCatalogDetail(selectedCatalogProduct);
        window.setTimeout(() => {
            if (catalogHighlightedPackageCode === (result.package?.packageCode || payload.packageCode)) {
                catalogHighlightedPackageCode = "";
                if (selectedCatalogProduct) renderCatalogDetail(selectedCatalogProduct);
            }
        }, 2500);
        showAdminToast?.(adminT("package_created", "Package created"), "success");
    }
}

function openBannerEditor(product, banner = null) {
    ensureBannerEditorModal();
    const modal = document.getElementById("catalogBannerEditorModal");
    modal.dataset.bannerId = banner?.id || "";
    modal.dataset.mediaAssetId = banner?.mediaAssetId || "";
    modal.querySelector("#catalogBannerTitle").textContent = banner ? adminT("edit_banner", "Edit Banner") : adminT("add_banner", "Add Banner");
    modal.querySelector("#catalogBannerName").value = banner?.name || "";
    modal.querySelector("#catalogBannerEnabled").checked = banner?.enabled !== false;
    modal.querySelector("#catalogBannerSort").value = banner?.sortOrder ?? 0;
    modal.querySelector("#catalogBannerCtaLabel").value = banner?.ctaLabel || "";
    modal.querySelector("#catalogBannerCtaTarget").value = banner?.ctaTarget || "";
    modal.querySelector("#catalogBannerStarts").value = toDatetimeInputValue(banner?.startsAt);
    modal.querySelector("#catalogBannerEnds").value = toDatetimeInputValue(banner?.endsAt);
    modal.querySelector("#catalogBannerMediaLabel").textContent = banner?.mediaAsset?.name || adminT("select_banner_image", "Select Banner Image");
    modal.classList.add("show");

    modal.querySelector("#catalogBannerMedia").onclick = async () => {
        const asset = await window.AZIEL_ADMIN_MEDIA_SELECTOR?.open?.({ category: "product_banner" });
        if (!asset) return;
        modal.dataset.mediaAssetId = asset.assetId;
        modal.querySelector("#catalogBannerMediaLabel").textContent = asset.name || asset.assetId;
    };
    modal.querySelector("#catalogBannerCancel").onclick = () => modal.classList.remove("show");
    modal.querySelector("#catalogBannerSave").onclick = () => readAndSaveBanner(product, banner);
}

function ensureBannerEditorModal() {
    if (document.getElementById("catalogBannerEditorModal")) return;

    const modal = document.createElement("div");
    modal.id = "catalogBannerEditorModal";
    modal.className = "admin-action-modal catalog-edit-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box">
            <h3 id="catalogBannerTitle"></h3>
            <label>${adminT("banner_name", "Banner Name")} <input id="catalogBannerName" type="text"></label>
            <label><input id="catalogBannerEnabled" type="checkbox" checked> ${adminT("enabled", "Enabled")}</label>
            <label>${adminT("sort_order", "Sort Order")} <input id="catalogBannerSort" type="number" step="1" value="0"></label>
            <button id="catalogBannerMedia" class="admin-secondary-btn" type="button">${adminT("select_banner_image", "Select Banner Image")}</button>
            <p id="catalogBannerMediaLabel"></p>
            <label>${adminT("cta_label", "CTA Label")} <input id="catalogBannerCtaLabel" type="text"></label>
            <label>${adminT("cta_target", "CTA Target")} <input id="catalogBannerCtaTarget" type="text"></label>
            <label>${adminT("start_date", "Start Date")} <input id="catalogBannerStarts" type="datetime-local"></label>
            <label>${adminT("end_date", "End Date")} <input id="catalogBannerEnds" type="datetime-local"></label>
            <div class="admin-action-modal-actions">
                <button id="catalogBannerCancel" type="button">${adminT("cancel", "Cancel")}</button>
                <button id="catalogBannerSave" type="button">${adminT("save_changes", "Save Changes")}</button>
            </div>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("show");
    });
    document.body.appendChild(modal);
}

function readAndSaveBanner(product, existing = null) {
    const modal = document.getElementById("catalogBannerEditorModal");
    const payload = {
        name: modal.querySelector("#catalogBannerName")?.value || "",
        mediaAssetId: modal.dataset.mediaAssetId || "",
        enabled: Boolean(modal.querySelector("#catalogBannerEnabled")?.checked),
        sortOrder: modal.querySelector("#catalogBannerSort")?.value || 0,
        ctaLabel: modal.querySelector("#catalogBannerCtaLabel")?.value || "",
        ctaTarget: modal.querySelector("#catalogBannerCtaTarget")?.value || "",
        startsAt: fromDatetimeInputValue(modal.querySelector("#catalogBannerStarts")?.value),
        endsAt: fromDatetimeInputValue(modal.querySelector("#catalogBannerEnds")?.value)
    };
    modal.classList.remove("show");
    return saveBanner(product, payload, existing);
}

async function saveBanner(product, payload, existing = null) {
    const isEdit = Boolean(existing?.id);
    const confirmed = await confirmCatalogAction({
        title: isEdit ? adminT("edit_banner", "Edit Banner") : adminT("add_banner", "Add Banner"),
        message: `${payload.name || existing?.name || ""}\n${adminT("new_banner_runtime_message", "Customer game pages will use this banner when eligible.")}`,
        confirmText: adminT("save_changes", "Save Changes")
    });

    if (!confirmed) return null;

    const url = isEdit
        ? `/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/banners/${encodeURIComponent(existing.id)}`
        : `/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/banners`;
    const data = await adminFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
        return data;
    }

    selectedCatalogBanners = data.banners || [];
    showAdminToast?.(adminT("banner_saved", "Banner saved"), "success");
    await selectCatalogProduct(product.productCode, false);
    return data;
}

async function removeBanner(product, bannerId) {
    const confirmed = await confirmCatalogAction({
        title: adminT("remove_banner", "Remove Banner"),
        message: adminT("remove_banner_message", "Remove this banner record? The media asset will remain in the Media Library."),
        confirmText: adminT("remove", "Remove"),
        danger: true
    });
    if (!confirmed) return;

    const data = await adminFetch(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/banners/${encodeURIComponent(bannerId)}`, {
        method: "DELETE"
    });
    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
        return;
    }
    selectedCatalogBanners = data.banners || [];
    showAdminToast?.(adminT("banner_removed", "Banner removed"), "success");
    await selectCatalogProduct(product.productCode, false);
}

async function restoreBannerRecord(product, bannerId) {
    const data = await adminFetch(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/banners/${encodeURIComponent(bannerId)}/restore`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
    });
    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
        return;
    }
    selectedCatalogBanners = data.banners || [];
    showAdminToast?.(adminT("banner_saved", "Banner saved"), "success");
    await selectCatalogProduct(product.productCode, false);
}

async function moveBanner(product, bannerId, direction) {
    const currentIndex = selectedCatalogBanners.findIndex(item => item.id === bannerId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= selectedCatalogBanners.length) return;

    const next = [...selectedCatalogBanners];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
    await persistBannerOrder(product, next);
}

async function persistBannerOrder(product, next) {
    const activeNext = next.filter(item => !item.deleted);
    const data = await adminFetch(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/banners/order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: activeNext.map(item => item.id) })
    });
    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
        return;
    }
    selectedCatalogBanners = data.banners || [];
    await selectCatalogProduct(product.productCode, false);
}

async function loadStorefrontSections(force = false) {
    if (storefrontSections.length && !force) {
        renderStorefrontSections();
        return;
    }

    const container = document.getElementById("adminStorefrontSections");
    if (container) {
        container.innerHTML = `
            <div class="admin-dashboard-skeleton"></div>
            <div class="admin-dashboard-skeleton"></div>
        `;
    }

    const data = await adminFetch("/api/admin/catalog/storefront-sections");
    if (!data) return;

    if (!data.success) {
        renderStorefrontSectionsError(data.message || "Storefront sections could not be loaded.");
        return;
    }

    storefrontSections = Array.isArray(data.sections) ? data.sections : [];
    renderStorefrontSections();
}

function renderStorefrontSectionsError(message) {
    const container = document.getElementById("adminStorefrontSections");
    if (!container) return;
    container.innerHTML = `
        <div class="admin-empty-state">
            <strong>${escapeHtml(message)}</strong>
            <button class="admin-secondary-btn" type="button" data-retry-storefront>Retry</button>
        </div>
    `;
    container.querySelector("[data-retry-storefront]")?.addEventListener("click", () => loadStorefrontSections(true));
}

function renderStorefrontSections() {
    const container = document.getElementById("adminStorefrontSections");
    if (!container) return;

    if (!storefrontSections.length) {
        container.innerHTML = renderCatalogEmptyState({
            icon: "fa-solid fa-layer-group",
            title: "No storefront sections found.",
            description: "Sections published to the public storefront will appear here."
        });
        return;
    }

    container.innerHTML = storefrontSections.map((section, index) => `
        <article class="catalog-storefront-row" data-storefront-key="${escapeHtml(section.key)}">
            <button class="catalog-drag-handle" type="button" draggable="true" data-storefront-drag="${escapeHtml(section.key)}" aria-label="Drag ${escapeHtml(section.displayName)}"><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></button>
            <span class="catalog-storefront-icon"><i class="${escapeHtml(storefrontIconClass(section.icon))}"></i></span>
            <div>
                <strong>${escapeHtml(section.displayName)}</strong>
                <small>${escapeHtml(section.path)} · ${section.isSystem ? "System" : "Custom"}</small>
            </div>
            <span class="admin-status-pill ${sectionStatusClass(section.status)}">${formatSectionStatus(section.status)}</span>
            <span class="catalog-storefront-menu-state">Menu: ${section.showInGamesMenu ? "On" : "Off"}</span>
            <div class="catalog-package-actions">
                <button class="admin-icon-btn catalog-row-primary-action" type="button" data-edit-storefront="${escapeHtml(section.key)}"><i class="fa-solid fa-pen" aria-hidden="true"></i>Edit</button>
                <details class="catalog-action-menu">
                    <summary class="admin-icon-btn catalog-overflow-trigger" aria-label="${adminT("more_actions", "More Actions")}"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></summary>
                    <div class="catalog-action-menu-popover">
                        <span class="catalog-menu-group-label">Order</span>
                        <button type="button" data-move-storefront-up="${escapeHtml(section.key)}" ${index === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i>Move Up</button>
                        <button type="button" data-move-storefront-down="${escapeHtml(section.key)}" ${index === storefrontSections.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down" aria-hidden="true"></i>Move Down</button>
                    </div>
                </details>
            </div>
        </article>
    `).join("");

    bindStorefrontSectionControls(container);
}

function storefrontIconClass(icon = "") {
    const map = {
        mobile: "fa-solid fa-mobile-screen-button",
        desktop: "fa-solid fa-desktop",
        gift: "fa-solid fa-gift",
        telegram: "fa-brands fa-telegram",
        clock: "fa-regular fa-clock"
    };
    return map[String(icon || "").toLowerCase()] || "fa-solid fa-layer-group";
}

function formatSectionStatus(status = "") {
    const value = String(status || "").toUpperCase();
    if (value === "PUBLISHED") return "Published";
    if (value === "COMING_SOON") return "Coming Soon";
    return "Hidden";
}

function sectionStatusClass(status = "") {
    const value = String(status || "").toUpperCase();
    if (value === "PUBLISHED") return "is-ok";
    if (value === "COMING_SOON") return "is-warning";
    return "is-purple";
}

function bindStorefrontSectionControls(root) {
    root.querySelectorAll("[data-edit-storefront]").forEach(btn => {
        btn.addEventListener("click", () => {
            const section = storefrontSections.find(item => item.key === btn.dataset.editStorefront);
            if (section) openStorefrontSectionEditor(section);
        });
    });
    root.querySelectorAll("[data-move-storefront-up]").forEach(btn => {
        btn.addEventListener("click", () => moveStorefrontSection(btn.dataset.moveStorefrontUp, -1));
    });
    root.querySelectorAll("[data-move-storefront-down]").forEach(btn => {
        btn.addEventListener("click", () => moveStorefrontSection(btn.dataset.moveStorefrontDown, 1));
    });

    let draggedKey = "";
    root.querySelectorAll("[data-storefront-drag]").forEach(handle => {
        handle.addEventListener("dragstart", event => {
            draggedKey = handle.dataset.storefrontDrag || "";
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", draggedKey);
        });
    });
    root.querySelectorAll("[data-storefront-key]").forEach(row => {
        row.addEventListener("dragover", event => {
            if (!draggedKey) return;
            event.preventDefault();
            row.classList.add("is-drag-over");
        });
        row.addEventListener("dragleave", () => row.classList.remove("is-drag-over"));
        row.addEventListener("drop", event => {
            event.preventDefault();
            row.classList.remove("is-drag-over");
            const targetKey = row.dataset.storefrontKey || "";
            if (!draggedKey || draggedKey === targetKey) return;
            const currentIndex = storefrontSections.findIndex(item => item.key === draggedKey);
            const targetIndex = storefrontSections.findIndex(item => item.key === targetKey);
            if (currentIndex < 0 || targetIndex < 0) return;
            const next = [...storefrontSections];
            const [moved] = next.splice(currentIndex, 1);
            next.splice(targetIndex, 0, moved);
            persistStorefrontSectionOrder(next);
            draggedKey = "";
        });
    });
}

function moveStorefrontSection(key, direction) {
    const currentIndex = storefrontSections.findIndex(item => item.key === key);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= storefrontSections.length) return;
    const next = [...storefrontSections];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
    persistStorefrontSectionOrder(next);
}

async function persistStorefrontSectionOrder(next) {
    const previous = [...storefrontSections];
    storefrontSections = next.map((item, index) => ({ ...item, sortOrder: index + 1 }));
    renderStorefrontSections();

    const data = await adminFetch("/api/admin/catalog/storefront-sections/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedKeys: next.map(item => item.key) })
    });

    if (!data?.success) {
        storefrontSections = previous;
        renderStorefrontSections();
        showAdminToast?.(data?.message || "Storefront section order could not be saved.", "error");
        return;
    }

    storefrontSections = data.sections || storefrontSections;
    showAdminToast?.("Storefront section order updated", "success");
    renderStorefrontSections();
}

function openStorefrontSectionEditor(section) {
    ensureStorefrontSectionModal();
    const modal = document.getElementById("storefrontSectionModal");
    modal.dataset.sectionKey = section.key;
    modal.querySelector("#storefrontSectionTitle").textContent = section.displayName;
    modal.querySelector("#storefrontSectionName").value = section.displayName || "";
    modal.querySelector("#storefrontSectionIcon").value = section.icon || "gift";
    modal.querySelector("#storefrontSectionPath").value = section.path || "";
    modal.querySelector("#storefrontSectionStatus").value = section.status || "HIDDEN";
    modal.querySelector("#storefrontSectionMenu").checked = section.showInGamesMenu === true;
    modal.querySelector("#storefrontSectionHome").checked = section.showOnHome === true;
    modal.classList.add("show");
    modal.querySelector("#storefrontSectionCancel").onclick = () => modal.classList.remove("show");
    modal.querySelector("#storefrontSectionSave").onclick = () => saveStorefrontSection(section);
}

function ensureStorefrontSectionModal() {
    if (document.getElementById("storefrontSectionModal")) return;

    const modal = document.createElement("div");
    modal.id = "storefrontSectionModal";
    modal.className = "admin-action-modal catalog-edit-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box">
            <h3 id="storefrontSectionTitle">Storefront Section</h3>
            <label>Display Name <input id="storefrontSectionName" type="text" maxlength="60"></label>
            <label>Icon
                <select id="storefrontSectionIcon">
                    <option value="mobile">Mobile</option>
                    <option value="desktop">Desktop</option>
                    <option value="gift">Gift</option>
                    <option value="telegram">Telegram</option>
                    <option value="clock">Clock</option>
                </select>
            </label>
            <label>Destination Path <input id="storefrontSectionPath" type="text" readonly></label>
            <label>Status
                <select id="storefrontSectionStatus">
                    <option value="PUBLISHED">Published</option>
                    <option value="COMING_SOON">Coming Soon</option>
                    <option value="HIDDEN">Hidden</option>
                </select>
            </label>
            <label><input id="storefrontSectionMenu" type="checkbox"> Show in Games Menu</label>
            <label><input id="storefrontSectionHome" type="checkbox"> Show on Home</label>
            <div class="admin-action-modal-actions">
                <button id="storefrontSectionCancel" type="button">Cancel</button>
                <button id="storefrontSectionSave" type="button">Save Changes</button>
            </div>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("show");
    });
    document.body.appendChild(modal);
}

async function saveStorefrontSection(section) {
    const modal = document.getElementById("storefrontSectionModal");
    if (!modal) return;

    const payload = {
        displayName: modal.querySelector("#storefrontSectionName")?.value || "",
        icon: modal.querySelector("#storefrontSectionIcon")?.value || "gift",
        status: modal.querySelector("#storefrontSectionStatus")?.value || "HIDDEN",
        showInGamesMenu: Boolean(modal.querySelector("#storefrontSectionMenu")?.checked),
        showOnHome: Boolean(modal.querySelector("#storefrontSectionHome")?.checked)
    };

    modal.classList.remove("show");
    const data = await adminFetch(`/api/admin/catalog/storefront-sections/${encodeURIComponent(section.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!data?.success) {
        modal.classList.add("show");
        showAdminToast?.(data?.message || "Storefront section could not be saved.", "error");
        return;
    }

    storefrontSections = data.sections || storefrontSections;
    showAdminToast?.("Storefront section saved", "success");
    renderStorefrontSections();
}

function toDatetimeInputValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 16);
}

function fromDatetimeInputValue(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function toggleProductAvailability(product) {
    const nextEnabled = !product.enabled;
    const confirmed = await confirmCatalogAction({
        title: adminT(nextEnabled ? "enable_product" : "disable_product", nextEnabled ? "Enable Product" : "Disable Product"),
        message: nextEnabled
            ? `${adminT("enable_product_message", "New purchases for this product will be allowed.")}`
            : `${adminT("disable_product_message", "New purchases for this product will be blocked. Existing orders will not be changed.")}`,
        confirmText: adminT(nextEnabled ? "enable_product" : "disable_product", nextEnabled ? "Enable Product" : "Disable Product"),
        danger: !nextEnabled
    });

    if (!confirmed) return;

    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}`, {
        enabled: nextEnabled,
        expectedUpdatedAt: product.updatedAt
    });
}

async function softDeleteProductRecord(product) {
    const modal = document.getElementById("catalogProductEditModal");
    const confirmed = await confirmCatalogAction({
        title: adminT("delete_product", "Delete Product"),
        message: `${product.name}\n${adminT("delete_product_message", "This hides the product from the storefront and preserves history for restore.")}`,
        confirmText: adminT("delete", "Delete"),
        danger: true
    });

    if (!confirmed) return;
    modal?.classList.remove("show");

    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/delete`, {
        expectedUpdatedAt: product.updatedAt
    });
}

async function restoreProductRecord(product) {
    const modal = document.getElementById("catalogProductEditModal");
    const confirmed = await confirmCatalogAction({
        title: adminT("restore_product", "Restore Product"),
        message: `${product.name}\n${adminT("restore_product_message", "This restores the product to the catalog workspace and storefront when enabled.")}`,
        confirmText: adminT("restore", "Restore")
    });

    if (!confirmed) return;
    modal?.classList.remove("show");

    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/restore`, {
        expectedUpdatedAt: product.updatedAt
    });
}

async function togglePackageAvailability(product, pkg) {
    const nextEnabled = !pkg.enabled;
    const confirmed = await confirmCatalogAction({
        title: adminT(nextEnabled ? "enable_package" : "disable_package", nextEnabled ? "Enable Package" : "Disable Package"),
        message: nextEnabled
            ? adminT("enable_package_message", "New purchases for this package will be allowed.")
            : adminT("disable_package_message", "New purchases for this package will be blocked."),
        confirmText: adminT(nextEnabled ? "enable_package" : "disable_package", nextEnabled ? "Enable Package" : "Disable Package"),
        danger: !nextEnabled
    });

    if (!confirmed) return;

    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/packages/${encodeURIComponent(pkg.packageCode)}`, {
        enabled: nextEnabled,
        expectedUpdatedAt: pkg.updatedAt
    });
}

async function softDeletePackageRecord(product, pkg) {
    const confirmed = await confirmCatalogAction({
        title: adminT("delete_package", "Delete Package"),
        message: `${pkg.packageCode} · ${pkg.name}\n${adminT("delete_package_message", "This hides the package from customers while preserving history, audits, and supplier mappings.")}`,
        confirmText: adminT("delete", "Delete"),
        danger: true
    });

    if (!confirmed) return;

    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/packages/${encodeURIComponent(pkg.packageCode)}/delete`, {
        expectedUpdatedAt: pkg.updatedAt
    });
}

async function restorePackageRecord(product, pkg) {
    const confirmed = await confirmCatalogAction({
        title: adminT("restore_package", "Restore Package"),
        message: `${pkg.packageCode} · ${pkg.name}`,
        confirmText: adminT("restore", "Restore")
    });

    if (!confirmed) return;

    await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/packages/${encodeURIComponent(pkg.packageCode)}/restore`, {
        expectedUpdatedAt: pkg.updatedAt
    });
}

function openPackageEditPanel(product, pkg) {
    ensurePackageEditModal();
    const modal = document.getElementById("catalogPackageEditModal");
    const mmInput = modal.querySelector("#catalogEditMM");
    const thInput = modal.querySelector("#catalogEditTH");
    const mmEnabled = modal.querySelector("#catalogEditMMEnabled");
    const thEnabled = modal.querySelector("#catalogEditTHEnabled");
    const draft = catalogPackageEditDraft?.productCode === product.productCode &&
        catalogPackageEditDraft?.packageCode === pkg.packageCode
        ? catalogPackageEditDraft
        : null;

    modal.querySelector("#catalogEditTitle").textContent = adminT("edit_package", "Edit Package");
    modal.querySelector("#catalogEditPackageCode").value = pkg.packageCode;
    modal.querySelector("#catalogEditPackageName").value = draft?.name ?? pkg.name;
    modal.querySelector("#catalogEditEnabled").checked = draft?.enabled ?? pkg.enabled !== false;
    modal.dataset.iconAssetId = draft?.iconAssetId ?? (pkg.iconAsset?.assetId || "");
    modal.dataset.iconCleared = draft?.iconCleared ? "true" : "";
    modal.querySelector("#catalogEditIconLabel").textContent = draft?.iconLabel || pkg.iconAsset?.name || pkg.iconUrl || adminT("fallback_static_asset", "Static fallback asset");
    modal.querySelector("#catalogEditSupplierMapping").textContent = formatSupplierMapping(pkg);
    mmEnabled.checked = draft?.regionEnabled?.MM ?? Boolean(pkg.prices?.MM);
    thEnabled.checked = draft?.regionEnabled?.TH ?? Boolean(pkg.prices?.TH);
    mmInput.value = draft?.values?.MM ?? pkg.prices?.MM?.amount ?? "";
    thInput.value = draft?.values?.TH ?? pkg.prices?.TH?.amount ?? "";
    mmInput.disabled = !mmEnabled.checked;
    thInput.disabled = !thEnabled.checked;

    modal.classList.add("show");

    mmEnabled.onchange = () => {
        mmInput.disabled = !mmEnabled.checked;
    };
    thEnabled.onchange = () => {
        thInput.disabled = !thEnabled.checked;
    };
    modal.querySelector("#catalogEditIcon").onclick = async () => {
        const asset = await window.AZIEL_ADMIN_MEDIA_SELECTOR?.open?.({ category: "package_icon" });
        if (!asset) return;
        modal.dataset.iconAssetId = asset.assetId;
        modal.dataset.iconCleared = "";
        modal.querySelector("#catalogEditIconLabel").textContent = asset.name || asset.assetId;
    };
    modal.querySelector("#catalogEditIconClear").onclick = () => {
        modal.dataset.iconAssetId = "";
        modal.dataset.iconCleared = "true";
        modal.querySelector("#catalogEditIconLabel").textContent = adminT("fallback_static_asset", "Static fallback asset");
    };
    modal.querySelector("#catalogEditCancel").onclick = () => abandonPackageEditDraft();
    modal.querySelector("#catalogEditSave").onclick = () => handlePackageEditSave(product, pkg);
}

async function handlePackageEditSave(product, pkg) {
    if (catalogPackageSavePending) return;

    const modal = document.getElementById("catalogPackageEditModal");
    if (!modal?.classList.contains("show")) return;

    const draft = readPackageEditDraft(product, pkg);
    if (!validatePackageEditDraft(pkg, draft)) return;

    const changeSet = buildPackageEditChanges(pkg, draft);

    if (!changeSet.changes.length) {
        showAdminToast?.(adminT("no_changes_to_save", "No changes to save."), "info");
        return;
    }

    catalogPackageEditDraft = draft;
    closePackageEditPanel();

    const confirmed = await confirmCatalogAction({
        title: adminT("save_catalog_changes", "Save catalog changes?"),
        message: `${pkg.name}\n${changeSet.changes.join("\n")}\n${adminT("historical_orders_not_changed", "Historical orders will not be changed.")}`,
        confirmText: adminT("save_changes", "Save Changes")
    });

    if (!confirmed) {
        reopenPackageEditPanel(product, pkg, draft);
        return;
    }

    catalogPackageSavePending = true;

    try {
        const result = await mutateCatalog(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/packages/${encodeURIComponent(pkg.packageCode)}`, {
            name: changeSet.name,
            enabled: changeSet.enabled,
            iconAssetId: changeSet.iconAssetId,
            prices: changeSet.prices,
            expectedUpdatedAt: pkg.updatedAt
        });

        if (result?.success) {
            catalogPackageEditDraft = null;
            closePackageEditPanel();
            return;
        }

        if (result?.code === "CATALOG_CONFLICT") {
            catalogPackageEditDraft = null;
            showAdminToast?.(adminT("catalog_changed_refresh", "Catalog changed since you opened it. Refresh and review the latest values."), "error");
            catalogProducts = [];
            await loadAdminCatalog(true);
            if (product.productCode) await selectCatalogProduct(product.productCode, true);
            return;
        }

        reopenPackageEditPanel(product, pkg, draft);
    } finally {
        catalogPackageSavePending = false;
    }
}

function validatePackageEditDraft(pkg, draft) {
    const checks = [
        ["MM", draft.regionEnabled.MM],
        ["TH", draft.regionEnabled.TH]
    ];

    if (!draft.name.trim()) {
        showAdminToast?.(adminT("catalog_update_failed", "Catalog update failed"), "error");
        return false;
    }

    if (!draft.regionEnabled.MM && !draft.regionEnabled.TH) {
        showAdminToast?.(adminT("catalog_update_failed", "Catalog update failed"), "error");
        return false;
    }

    for (const [region, enabled] of checks) {
        if (!enabled) continue;

        const value = draft.values[region];
        const amount = Number(value);

        if (!value || !Number.isFinite(amount) || amount <= 0) {
            showAdminToast?.(adminT("catalog_update_failed", "Catalog update failed"), "error");
            return false;
        }
    }

    return true;
}

function readPackageEditDraft(product, pkg) {
    const modal = document.getElementById("catalogPackageEditModal");
    const mmInput = modal?.querySelector("#catalogEditMM");
    const thInput = modal?.querySelector("#catalogEditTH");
    const mmEnabled = Boolean(modal?.querySelector("#catalogEditMMEnabled")?.checked);
    const thEnabled = Boolean(modal?.querySelector("#catalogEditTHEnabled")?.checked);

    return {
        productCode: product.productCode,
        packageCode: pkg.packageCode,
        name: String(modal?.querySelector("#catalogEditPackageName")?.value || "").trim(),
        enabled: Boolean(modal?.querySelector("#catalogEditEnabled")?.checked),
        iconAssetId: modal?.dataset.iconCleared === "true" ? "" : (modal?.dataset.iconAssetId || pkg.iconAsset?.assetId || ""),
        iconCleared: modal?.dataset.iconCleared === "true",
        iconLabel: modal?.querySelector("#catalogEditIconLabel")?.textContent || "",
        regionEnabled: {
            MM: mmEnabled,
            TH: thEnabled
        },
        values: {
            MM: mmEnabled ? String(mmInput?.value || "").trim() : "",
            TH: thEnabled ? String(thInput?.value || "").trim() : ""
        }
    };
}

function buildPackageEditChanges(pkg, draft) {
    const prices = {};
    const changes = [];
    const nextName = draft.name.trim();
    const currentIconAssetId = pkg.iconAsset?.assetId || "";
    let iconAssetId;
    let enabled;

    if (nextName && nextName !== pkg.name) {
        changes.push(`${adminT("package_name", "Package Name")}: ${pkg.name} → ${nextName}`);
    }

    if (draft.enabled !== (pkg.enabled !== false)) {
        enabled = draft.enabled;
        changes.push(adminT(draft.enabled ? "enable_package" : "disable_package", draft.enabled ? "Enable Package" : "Disable Package"));
    }

    if (draft.iconAssetId !== currentIconAssetId) {
        iconAssetId = draft.iconAssetId;
        changes.push(adminT("package_icon", "Package Icon"));
    }

    ["MM", "TH"].forEach(region => {
        const existing = pkg.prices?.[region];
        const desiredEnabled = draft.regionEnabled[region];

        if (desiredEnabled !== Boolean(existing && existing.enabled !== false)) {
            prices[region] = {
                ...(prices[region] || {}),
                enabled: desiredEnabled
            };
            changes.push(`${region}: ${desiredEnabled ? "Available" : "Unavailable"}`);
        }
    });

    if (pkg.prices?.MM && Number(draft.values.MM) !== Number(pkg.prices.MM.amount)) {
        prices.MM = { ...(prices.MM || {}), amount: draft.values.MM };
        changes.push(`MMK ${formatRegionalPrice(pkg.prices.MM)} → ${Number(draft.values.MM).toLocaleString()} MMK`);
    } else if (!pkg.prices?.MM && draft.regionEnabled.MM) {
        prices.MM = { ...(prices.MM || {}), enabled: true, amount: draft.values.MM };
        changes.push(`MM: ${Number(draft.values.MM).toLocaleString()} MMK`);
    }

    if (pkg.prices?.TH && Number(draft.values.TH) !== Number(pkg.prices.TH.amount)) {
        prices.TH = { ...(prices.TH || {}), amount: draft.values.TH };
        changes.push(`THB ${formatRegionalPrice(pkg.prices.TH)} → ${Number(draft.values.TH).toLocaleString()} THB`);
    } else if (!pkg.prices?.TH && draft.regionEnabled.TH) {
        prices.TH = { ...(prices.TH || {}), enabled: true, amount: draft.values.TH };
        changes.push(`TH: ${Number(draft.values.TH).toLocaleString()} THB`);
    }

    return { name: nextName, enabled, iconAssetId, prices, changes };
}

function reopenPackageEditPanel(product, pkg, draft) {
    catalogPackageEditDraft = draft;
    openPackageEditPanel(product, pkg);
}

function ensurePackageEditModal() {
    if (document.getElementById("catalogPackageEditModal")) return;

    const modal = document.createElement("div");
    modal.id = "catalogPackageEditModal";
    modal.className = "admin-action-modal catalog-edit-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box">
            <h3 id="catalogEditTitle"></h3>
            <label>${adminT("package_code", "Package Code")} <input id="catalogEditPackageCode" type="text" readonly></label>
            <label>${adminT("package_name", "Package Name")} <input id="catalogEditPackageName" type="text" maxlength="120"></label>
            <label class="catalog-toggle-row"><span>${adminT("enabled", "Enabled")}</span><input id="catalogEditEnabled" type="checkbox"></label>
            <fieldset class="catalog-edit-fieldset catalog-chip-fieldset">
                <legend>${adminT("supported_regions", "Supported Regions")}</legend>
                <label class="catalog-choice-chip"><input id="catalogEditMMEnabled" type="checkbox"> Myanmar</label>
                <label class="catalog-choice-chip"><input id="catalogEditTHEnabled" type="checkbox"> Thailand</label>
            </fieldset>
            <label>${adminT("mmk_price", "MMK Price")} <input id="catalogEditMM" type="number" step="0.01" min="0"></label>
            <label>${adminT("thb_price", "THB Price")} <input id="catalogEditTH" type="number" step="0.01" min="0"></label>
            <button id="catalogEditIcon" class="admin-secondary-btn" type="button">${adminT("select_package_icon", "Select Package Icon")}</button>
            <button id="catalogEditIconClear" class="admin-icon-btn danger" type="button">${adminT("remove_icon", "Remove Icon")}</button>
            <p id="catalogEditIconLabel"></p>
            <label>${adminT("supplier_mapping", "Supplier Mapping")} <input id="catalogEditSupplierMapping" type="text" readonly></label>
            <div class="admin-action-modal-actions">
                <button id="catalogEditCancel" type="button">${adminT("cancel", "Cancel")}</button>
                <button id="catalogEditSave" class="admin-primary-btn" type="button">${adminT("save_changes", "Save Changes")}</button>
            </div>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) abandonPackageEditDraft();
    });
    document.body.appendChild(modal);
}

function closePackageEditPanel() {
    document.getElementById("catalogPackageEditModal")?.classList.remove("show");
}

function abandonPackageEditDraft() {
    catalogPackageEditDraft = null;
    closePackageEditPanel();
}

async function mutateCatalog(url, body, options) {
    const mutationOptions = options || {};
    const data = await adminFetch(url, {
        method: mutationOptions.method || "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!data) return null;

    if (!data.success) {
        showAdminToast?.(data.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
        return data;
    }

    showAdminToast?.(data.unchanged ? adminT("no_changes_to_save", "No changes to save.") : adminT("catalog_updated", "Catalog updated"), data.unchanged ? "info" : "success");
    catalogProducts = [];
    await loadAdminCatalog(true);
    if (data.product?.productCode) {
        await selectCatalogProduct(data.product.productCode, true);
    } else if (selectedCatalogProductCode) {
        await selectCatalogProduct(selectedCatalogProductCode, true);
    }

    return data;
}

async function confirmCatalogAction(options = {}) {
    if (window.AZIEL_UI?.confirm) {
        return window.AZIEL_UI.confirm({
            title: options.title || "",
            message: options.message || "",
            confirmText: options.confirmText || adminT("save_changes", "Save Changes"),
            cancelText: adminT("cancel", "Cancel"),
            danger: Boolean(options.danger)
        });
    }

    const result = await window.AZIEL_ADMIN_ACTION_MODAL?.open?.({
        title: options.title || "",
        message: options.message || "",
        input: false,
        confirmText: options.confirmText || adminT("save_changes", "Save Changes"),
        cancelText: adminT("cancel", "Cancel"),
        danger: Boolean(options.danger)
    });

    return Boolean(result?.confirmed);
}

function renderCatalogEmpty(message = adminT("select_product", "Select a product")) {
    const detail = document.getElementById("adminCatalogDetailPanel");
    if (!detail) return;
    detail.innerHTML = `
        <div class="catalog-detail-empty">
            <strong>${escapeHtml(message)}</strong>
        </div>
    `;
}

function renderCatalogError(message) {
    const list = document.getElementById("adminCatalogProducts");
    if (!list) return;
    list.innerHTML = `
        <div class="admin-error-state">
            <p>${escapeHtml(message)}</p>
            <button class="admin-secondary-btn" type="button" data-catalog-retry>${adminT("retry", "Retry")}</button>
        </div>
    `;
    list.querySelector("[data-catalog-retry]")?.addEventListener("click", () => loadAdminCatalog(true));
    renderCatalogDetailError(message);
}

function renderCatalogDetailError(message) {
    const detail = document.getElementById("adminCatalogDetailPanel");
    if (!detail) return;
    detail.innerHTML = `
        <div class="admin-error-state">
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

function setCatalogSource(source) {
    const label = document.getElementById("catalogSourceLabel");
    if (label) label.textContent = source || "-";
}

function setCatalogActiveSource(source) {
    const label = document.getElementById("catalogActiveSourceLabel");
    if (label) label.textContent = source || "-";
}

function detailItem(key, value) {
    return `
        <p>
            <span data-admin-i18n="${key}">${adminT(key, key)}</span>
            <b>${escapeHtml(value || "-")}</b>
        </p>
    `;
}

function detailDefinition(key, value) {
    return `
        <div>
            <dt data-admin-i18n="${key}">${adminT(key, key)}</dt>
            <dd>${escapeHtml(value || "-")}</dd>
        </div>
    `;
}

function renderCatalogEmptyState({ icon = "fa-regular fa-circle", title = "", description = "", action = "" } = {}) {
    return `
        <div class="catalog-empty-state">
            <i class="${escapeHtml(icon)}" aria-hidden="true"></i>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(description)}</p>
            ${action}
        </div>
    `;
}

function formatRegions(regions = []) {
    return Array.isArray(regions) && regions.length ? regions.join(" / ") : "-";
}

function formatRegionalPrice(price) {
    if (!price || price.enabled === false) {
        return adminT("not_available", "Not available");
    }

    const amount = Number(price.amount);
    const formatted = Number.isFinite(amount) ? amount.toLocaleString("en-US") : String(price.amount || "");
    return `${formatted} ${price.currency || ""}`.trim();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
