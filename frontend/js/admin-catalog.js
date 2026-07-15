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

document.addEventListener("DOMContentLoaded", () => {
    initAdminCatalogController();
});

function initAdminCatalogController() {
    if (adminCatalogInitialized) return;
    adminCatalogInitialized = true;

    document.getElementById("refreshCatalogBtn")?.addEventListener("click", () => {
        loadAdminCatalog(true);
    });

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "catalog") {
            loadAdminCatalog();
        }
    });

    window.addEventListener("aziel:admin-locale-changed", () => {
        renderCatalogProducts();
        if (selectedCatalogProductCode) {
            selectCatalogProduct(selectedCatalogProductCode, false);
        } else {
            renderCatalogEmpty();
        }
    });

    if (document.getElementById("section-catalog")?.classList.contains("active")) {
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
        const statusKey = product.enabled ? "active" : "inactive";

        return `
            <button class="catalog-product-row ${active}" type="button" data-product-code="${escapeHtml(product.productCode)}">
                <span>
                    <strong>${escapeHtml(product.name)}</strong>
                    <small>${escapeHtml(product.productCode)}</small>
                </span>
                <span class="catalog-row-meta">
                    <b>${adminT(statusKey, product.enabled ? "Active" : "Inactive")}</b>
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

    detail.innerHTML = `
        <div class="catalog-detail-head">
            <button class="admin-mobile-back-btn" type="button" data-mobile-back="catalog">
                ← ${adminT("back_to_catalog", "Catalog")}
            </button>
            <span>${adminT("product", "Product")}</span>
            <h3>${escapeHtml(product.name)}</h3>
            <b class="admin-status-pill ${product.enabled ? "is-ok" : "is-muted"}">
                ${adminT(product.enabled ? "enabled" : "disabled", product.enabled ? "Enabled" : "Disabled")}
            </b>
            <button class="admin-secondary-btn catalog-product-toggle ${product.enabled ? "danger" : ""}"
                type="button"
                data-product-toggle="${product.enabled ? "disable" : "enable"}">
                ${adminT(product.enabled ? "disable_product" : "enable_product", product.enabled ? "Disable Product" : "Enable Product")}
            </button>
        </div>

        <div class="catalog-detail-grid">
            ${detailItem("product_code", product.productCode)}
            ${detailItem("name", product.name)}
            ${detailItem("supported_regions", formatRegions(product.supportedRegions))}
            ${detailItem("package_count", String(product.packageCount || packages.length))}
        </div>

        <div class="catalog-media-panel">
            <div class="panel-head catalog-package-head">
                <h3 data-admin-i18n="attached_media">${adminT("attached_media", "Attached Media")}</h3>
            </div>
            ${renderProductImageControl(product)}
            ${renderMobilePackagePreviewControl(product)}
        </div>

        <div class="catalog-package-table-wrap">
            <div class="panel-head catalog-package-head">
                <h3 data-admin-i18n="packages">${adminT("packages", "Packages")}</h3>
                <button class="admin-secondary-btn" type="button" data-add-package>${adminT("add_package", "Add Package")}</button>
            </div>
            ${renderPackageTable(packages)}
        </div>

        <div class="catalog-banners-panel">
            <div class="panel-head catalog-package-head">
                <h3 data-admin-i18n="banners">${adminT("banners", "Banners")}</h3>
                <button class="admin-secondary-btn" type="button" data-add-banner>${adminT("add_banner", "Add Banner")}</button>
            </div>
            ${renderBannerList(selectedCatalogBanners)}
        </div>
    `;

    detail.querySelector("[data-product-toggle]")?.addEventListener("click", () => toggleProductAvailability(product));
    detail.querySelector('[data-mobile-back="catalog"]')?.addEventListener("click", () => {
        window.AZIEL_ADMIN_LAYOUT?.showList?.("catalog");
    });
    detail.querySelector("[data-change-product-image]")?.addEventListener("click", () => attachProductImage(product));
    detail.querySelector("[data-remove-product-image]")?.addEventListener("click", () => clearProductImage(product));
    detail.querySelector("[data-change-mobile-preview]")?.addEventListener("click", () => attachMobilePackagePreview(product));
    detail.querySelector("[data-remove-mobile-preview]")?.addEventListener("click", () => clearMobilePackagePreview(product));
    detail.querySelector("[data-add-package]")?.addEventListener("click", () => openPackageCreatePanel(product));
    detail.querySelector("[data-add-banner]")?.addEventListener("click", () => openBannerEditor(product));
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
    bindBannerControls(detail, product);
    window.AZIEL_ADMIN_I18N?.translate?.(detail);
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
        return `<p class="admin-empty-state">${adminT("no_packages_found", "No packages found")}</p>`;
    }

    return `
        <div class="catalog-package-table">
            <div class="catalog-package-row catalog-package-header">
                <span data-admin-i18n="package_code">${adminT("package_code", "Package Code")}</span>
                <span data-admin-i18n="package_name">${adminT("package_name", "Package Name")}</span>
                <span data-admin-i18n="package_icon">${adminT("package_icon", "Package Icon")}</span>
                <span data-admin-i18n="mmk_price">${adminT("mmk_price", "MMK Price")}</span>
                <span data-admin-i18n="thb_price">${adminT("thb_price", "THB Price")}</span>
                <span data-admin-i18n="status">${adminT("status", "Status")}</span>
                <span data-admin-i18n="action">${adminT("action", "Action")}</span>
            </div>
            ${packages.map(item => `
                <div class="catalog-package-row">
                    <span>${escapeHtml(item.packageCode)}</span>
                    <span>${escapeHtml(item.name)}</span>
                    <span class="catalog-icon-cell">${renderPackageIconControl(item)}</span>
                    <span>${formatRegionalPrice(item.prices?.MM)}</span>
                    <span>${formatRegionalPrice(item.prices?.TH)}</span>
                    <span>${adminT(item.enabled ? "enabled" : "disabled", item.enabled ? "Enabled" : "Disabled")}</span>
                    <span class="catalog-package-actions">
                        <button class="admin-icon-btn" type="button" data-edit-package="${escapeHtml(item.packageCode)}">${adminT("edit_package", "Edit")}</button>
                        <button class="admin-icon-btn ${item.enabled ? "danger" : ""}" type="button" data-toggle-package="${escapeHtml(item.packageCode)}">
                            ${adminT(item.enabled ? "disable_package" : "enable_package", item.enabled ? "Disable" : "Enable")}
                        </button>
                    </span>
                </div>
            `).join("")}
        </div>
    `;
}

function renderBannerList(banners = []) {
    if (!banners.length) {
        return `<p class="admin-empty-state">${adminT("no_banners_found", "No banners found")}</p>`;
    }

    return `
        <div class="catalog-banner-list">
            ${banners.map((banner, index) => `
                <article class="catalog-banner-row" data-banner-id="${escapeHtml(banner.id)}">
                    <div class="catalog-banner-preview">
                        ${banner.mediaAsset?.secureUrl || banner.mediaAsset?.url
                            ? `<img src="${escapeHtml(banner.mediaAsset.secureUrl || banner.mediaAsset.url)}" alt="${escapeHtml(banner.mediaAsset.altText || banner.name)}">`
                            : `<span>${adminT("banner_image", "Banner Image")}</span>`}
                    </div>
                    <div>
                        <strong>${escapeHtml(banner.name)}</strong>
                        <small>${adminT(banner.enabled ? "enabled" : "disabled", banner.enabled ? "Enabled" : "Disabled")} · ${adminT("sort_order", "Sort Order")} ${Number(banner.sortOrder || 0)}</small>
                        <small>${formatBannerSchedule(banner)}</small>
                    </div>
                    <div class="catalog-package-actions">
                        <button class="admin-icon-btn" type="button" data-edit-banner="${escapeHtml(banner.id)}">${adminT("edit", "Edit")}</button>
                        <button class="admin-icon-btn" type="button" data-toggle-banner="${escapeHtml(banner.id)}">${adminT(banner.enabled ? "disable" : "enable", banner.enabled ? "Disable" : "Enable")}</button>
                        <button class="admin-icon-btn" type="button" data-move-banner-up="${escapeHtml(banner.id)}" ${index === 0 ? "disabled" : ""}>${adminT("move_up", "Move Up")}</button>
                        <button class="admin-icon-btn" type="button" data-move-banner-down="${escapeHtml(banner.id)}" ${index === banners.length - 1 ? "disabled" : ""}>${adminT("move_down", "Move Down")}</button>
                        <button class="admin-icon-btn danger" type="button" data-remove-banner="${escapeHtml(banner.id)}">${adminT("remove", "Remove")}</button>
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

function renderPackageIconControl(item) {
    const asset = item.iconAsset || null;
    const imageUrl = asset?.secureUrl || asset?.url || item.iconUrl || "";

    return `
        <span class="catalog-icon-control">
            ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(asset?.altText || item.name)}">` : `<b>-</b>`}
            <span class="catalog-package-actions">
                <button class="admin-icon-btn" type="button" data-change-package-icon="${escapeHtml(item.packageCode)}">${adminT("change_icon", "Change Icon")}</button>
                ${asset ? `<button class="admin-icon-btn danger" type="button" data-remove-package-icon="${escapeHtml(item.packageCode)}">${adminT("remove_icon", "Remove Icon")}</button>` : ""}
            </span>
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

async function moveBanner(product, bannerId, direction) {
    const currentIndex = selectedCatalogBanners.findIndex(item => item.id === bannerId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= selectedCatalogBanners.length) return;

    const next = [...selectedCatalogBanners];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
    const data = await adminFetch(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/banners/order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: next.map(item => item.id) })
    });
    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
        return;
    }
    selectedCatalogBanners = data.banners || [];
    await selectCatalogProduct(product.productCode, false);
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

function openPackageEditPanel(product, pkg) {
    ensurePackageEditModal();
    const modal = document.getElementById("catalogPackageEditModal");
    const mmInput = modal.querySelector("#catalogEditMM");
    const thInput = modal.querySelector("#catalogEditTH");
    const draft = catalogPackageEditDraft?.productCode === product.productCode &&
        catalogPackageEditDraft?.packageCode === pkg.packageCode
        ? catalogPackageEditDraft
        : null;

    modal.querySelector("#catalogEditTitle").textContent = adminT("edit_package", "Edit Package");
    modal.querySelector("#catalogEditPackageName").textContent = pkg.name;
    modal.querySelector("#catalogEditPackageCode").textContent = pkg.packageCode;
    mmInput.value = draft?.values?.MM ?? pkg.prices?.MM?.amount ?? "";
    thInput.value = draft?.values?.TH ?? pkg.prices?.TH?.amount ?? "";
    mmInput.disabled = !pkg.prices?.MM;
    thInput.disabled = !pkg.prices?.TH;

    modal.classList.add("show");

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
        ["MM", pkg.prices?.MM],
        ["TH", pkg.prices?.TH]
    ];

    for (const [region, price] of checks) {
        if (!price) continue;

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

    return {
        productCode: product.productCode,
        packageCode: pkg.packageCode,
        values: {
            MM: mmInput?.disabled ? "" : String(mmInput?.value || "").trim(),
            TH: thInput?.disabled ? "" : String(thInput?.value || "").trim()
        }
    };
}

function buildPackageEditChanges(pkg, draft) {
    const prices = {};
    const changes = [];

    if (pkg.prices?.MM && Number(draft.values.MM) !== Number(pkg.prices.MM.amount)) {
        prices.MM = { amount: draft.values.MM };
        changes.push(`MMK ${formatRegionalPrice(pkg.prices.MM)} → ${Number(draft.values.MM).toLocaleString()} MMK`);
    }

    if (pkg.prices?.TH && Number(draft.values.TH) !== Number(pkg.prices.TH.amount)) {
        prices.TH = { amount: draft.values.TH };
        changes.push(`THB ${formatRegionalPrice(pkg.prices.TH)} → ${Number(draft.values.TH).toLocaleString()} THB`);
    }

    return { prices, changes };
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
            <p><b id="catalogEditPackageName"></b><br><small id="catalogEditPackageCode"></small></p>
            <label>${adminT("mmk_price", "MMK Price")} <input id="catalogEditMM" type="number" step="0.01" min="0"></label>
            <label>${adminT("thb_price", "THB Price")} <input id="catalogEditTH" type="number" step="0.01" min="0"></label>
            <div class="admin-action-modal-actions">
                <button id="catalogEditCancel" type="button">${adminT("cancel", "Cancel")}</button>
                <button id="catalogEditSave" type="button">${adminT("save_changes", "Save Changes")}</button>
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
