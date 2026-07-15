// frontend/js/prices.js
// Compatibility package renderer/selection bridge. Public catalog owns prices.

let selectedPackage = null;

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("pricesRendered", bindPackageSelection);

  renderGamePrices();

  window.addEventListener("aziel:shopRegionChanged", () => {
    const selectedCode =
      selectedPackage?.code ||
      document.querySelector(".pack.active")?.dataset.code ||
      "";

    renderGamePrices({
      reselectCode: selectedCode,
      reason: "region_changed"
    });
  });

  document.addEventListener("aziel:catalog-updated", event => {
    if (event.detail?.status !== "ready") return;
    const selectedCode = selectedPackage?.code || "";
    renderGamePrices({
      reselectCode: selectedCode,
      reason: "catalog_updated"
    });
  });
});

function getShopRegion() {
  return window.AZIEL?.getShopRegion?.() || "MM";
}

function getShopSymbol(currency) {
  if (currency === "THB") return "฿";
  if (currency === "MMK") return "Ks";
  return window.AZIEL?.getShopSymbol?.() || (getShopRegion() === "TH" ? "฿" : "Ks");
}

function formatPackagePrice(amount, currency) {
  return `${Number(amount || 0).toLocaleString()} ${getShopSymbol(currency)}`;
}

function getCurrentGameKey() {
  return document.getElementById("packages")?.dataset.game || "";
}

function getProductMobilePackagePreview() {
  const product = window.AZIEL_CATALOG?.getProduct?.(getCurrentGameKey());
  if (!product) return "";

  const configuredPreview =
    product.mobilePackagePreviewUrl ||
    product.mobilePackagePreview?.url ||
    product.mobilePackagePreview?.asset?.secureUrl ||
    product.mobilePackagePreview?.asset?.url ||
    "";

  if (!configuredPreview) return "";

  return window.AZIEL_CATALOG_PRESENTATION?.resolveMobilePackagePreview?.(product) || configuredPreview;
}

function getStaticPreviewFallbackIcon(icon = null) {
  if (icon?.dataset?.staticFallbackSrc) return icon.dataset.staticFallbackSrc;

  const currentSrc = icon?.getAttribute?.("src") || "";
  if (currentSrc) return currentSrc;

  return window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(getCurrentGameKey()) || "";
}

function getPreviewPlaceholderIcon(icon = null) {
  return getProductMobilePackagePreview() || getStaticPreviewFallbackIcon(icon);
}

function rememberDefaultPackageIcon(icon, preview) {
  if (!icon) return "";

  const currentSrc = icon.getAttribute("src") || "";
  const isShowingPackage = preview?.classList.contains("has-package");

  if (!icon.dataset.staticFallbackSrc && currentSrc && !isShowingPackage) {
    icon.dataset.staticFallbackSrc = currentSrc;
  }

  const managedPreview = getProductMobilePackagePreview();

  if (managedPreview) {
    icon.dataset.defaultSrc = managedPreview;
  } else if (!icon.dataset.defaultSrc) {
    icon.dataset.defaultSrc = getStaticPreviewFallbackIcon(icon);
  }

  return icon.dataset.defaultSrc || "";
}

function setPackagePreviewIcon(icon, src, fallbackSrc = "") {
  if (!icon) return;

  const fallback = fallbackSrc || icon.dataset.defaultSrc || getPreviewPlaceholderIcon(icon);
  if (fallback) icon.dataset.fallbackSrc = fallback;

  icon.onerror = function handlePackagePreviewIconError() {
    const safeSrc = this.dataset.fallbackSrc || this.dataset.defaultSrc || "";

    if (safeSrc && this.getAttribute("src") !== safeSrc) {
      this.src = safeSrc;
      return;
    }

    this.onerror = null;
  };

  if (src) {
    icon.src = src;
    return;
  }

  if (fallback) {
    icon.src = fallback;
  }
}

function emitPackageEvent(name, detail = {}) {
  document.dispatchEvent(
    new CustomEvent(name, {
      detail
    })
  );
}

function emitPricesRendered(detail = {}) {
  document.dispatchEvent(new Event("pricesRendered"));
  emitPackageEvent("prices:rendered", detail);
}

function showCatalogMessage(packageContainer, message, retry = false) {
    packageContainer.innerHTML = `
    <div class="catalog-unavailable">
      <p>${escapeHtml(message)}</p>
      ${retry ? `<button type="button" class="catalog-retry-btn" data-catalog-retry>${escapeHtml(t("catalogRetry", "Retry"))}</button>` : ""}
    </div>
  `;

  packageContainer.querySelector("[data-catalog-retry]")?.addEventListener("click", () => {
    renderGamePrices({ forceRefresh: true });
  });
}

function t(key, fallback) {
  return window.AZIEL_I18N?.t?.(key) || window.i18n?.t?.(key) || fallback;
}

function clearSelectedPackage(reason = "cleared") {
  selectedPackage = null;
  window.selectedPackage = null;
  resetSelectedPackagePreview();
  emitPackageEvent("package:cleared", { reason });
}

async function renderGamePrices(options = {}) {
  const packageContainer = document.getElementById("packages");
  if (!packageContainer) return;

  const game = packageContainer.dataset.game;
  const catalog = window.AZIEL_CATALOG;

  if (!catalog) {
    packageContainer.dataset.catalogSynced = "false";
    showCatalogMessage(packageContainer, t("catalogPricesUnavailable", "Prices are temporarily unavailable. Please try again shortly."), false);
    clearSelectedPackage("catalog_client_missing");
    emitPricesRendered({ game, hasPackages: false, ready: false });
    return;
  }

  packageContainer.dataset.catalogSynced = "false";
  showCatalogMessage(packageContainer, "Loading packages...", false);

  try {
    await catalog.load({ force: Boolean(options.forceRefresh) });
  } catch (error) {
    showCatalogMessage(packageContainer, t("catalogPricesUnavailable", "Prices are temporarily unavailable. Please try again shortly."), true);
    clearSelectedPackage("catalog_unavailable");
    emitPricesRendered({ game, hasPackages: false, ready: false, error: true });
    return;
  }

  const product = catalog.getProduct(game);

  if (!product) {
    showCatalogMessage(packageContainer, t("catalogProductUnavailable", "This product is temporarily unavailable."), false);
    clearSelectedPackage("product_disabled");
    emitPricesRendered({ game, hasPackages: false, ready: true, unavailable: true });
    return;
  }

  const packages = catalog.getPackages(game, getShopRegion());
  packageContainer.dataset.catalogSynced = "true";

  if (!packages.length) {
    showCatalogMessage(packageContainer, t("catalogPackagesUnavailable", "Packages temporarily unavailable."), true);
    clearSelectedPackage("no_regional_packages");
    emitPricesRendered({ game, hasPackages: false, ready: true });
    return;
  }

  packageContainer.innerHTML = packages.map(item => `
    <div class="pack"
         data-name="${escapeAttr(item.name)}"
         data-price="${escapeAttr(item.amount)}"
         data-amount="${escapeAttr(item.amount)}"
         data-currency="${escapeAttr(item.currency)}"
         data-region="${escapeAttr(item.region)}"
         data-code="${escapeAttr(item.packageCode)}"
         data-product-code="${escapeAttr(item.productCode)}"
         data-icon="${escapeAttr(item.icon)}"
         data-fallback-icon="${escapeAttr(item.fallbackIcon || "")}"
         data-catalog-synced="true">
      <div class="pack-icon">
        <img src="${escapeAttr(item.icon)}" alt="${escapeAttr(item.name)}" data-fallback-src="${escapeAttr(item.fallbackIcon || "")}">
      </div>

      <div class="pack-info">
        <strong class="pack-name">${escapeHtml(item.name)}</strong>
        <span class="pack-price">
          ${formatPackagePrice(item.amount, item.currency)}
        </span>
      </div>
    </div>
  `).join("");

  bindPackageIconFallbacks(packageContainer);

  emitPricesRendered({
    game,
    hasPackages: true,
    ready: true
  });

  if (options.reselectCode) {
    const escapedCode = cssEscape(options.reselectCode);
    const packToSelect = document.querySelector(
      `.pack[data-code="${escapedCode}"]`
    );

    if (packToSelect) {
      selectPackage(packToSelect);
      return;
    }

    clearSelectedPackage(options.reason === "region_changed"
      ? "package_missing_after_region_change"
      : "package_missing_after_catalog_refresh");
    window.PaymentUtils?.showToast?.(t("catalogPackageUnavailable", "This package is no longer available. Please select another package."));
    return;
  }

  clearSelectedPackage("prices_rendered");
}

function bindPackageSelection() {
  document.querySelectorAll(".pack").forEach(pack => {
    pack.onclick = () => selectPackage(pack);
  });
}

function selectPackage(packEl) {
  if (!packEl) return;

  document.querySelectorAll(".pack").forEach(item => {
    item.classList.remove("active");
  });

  packEl.classList.add("active");
  window.AZIEL_MOTION?.emphasize(packEl, "selected");

  selectedPackage = {
    productCode: packEl.dataset.productCode || getCurrentGameKey(),
    packageCode: packEl.dataset.code,
    name: packEl.dataset.name,
    price: Number(packEl.dataset.price || 0),
    amount: Number(packEl.dataset.amount || packEl.dataset.price || 0),
    currency: packEl.dataset.currency || "",
    region: packEl.dataset.region || getShopRegion(),
    code: packEl.dataset.code,
    icon: packEl.dataset.icon,
    fallbackIcon: packEl.dataset.fallbackIcon || "",
    formattedPrice: formatPackagePrice(packEl.dataset.price, packEl.dataset.currency),
    catalogSynced: packEl.dataset.catalogSynced === "true"
  };

  window.selectedPackage = selectedPackage;

  updateSelectedPackagePreview(selectedPackage);

  document.dispatchEvent(
    new CustomEvent("packageSelected", {
      detail: selectedPackage
    })
  );

  emitPackageEvent("package:selected", selectedPackage);
}

function updateSelectedPackagePreview(pkg) {
  if (!pkg) return;

  const preview =
    document.getElementById("selectedPackagePreview") ||
    document.getElementById("openPackagePanel") ||
    document.querySelector("[data-selected-package-preview]") ||
    document.querySelector(".selected-package-preview");

  const icon =
    document.getElementById("selectedPackageIcon") ||
    document.getElementById("mobilePackageIcon") ||
    document.querySelector("[data-selected-package-icon]");

  const title =
    document.getElementById("selectedPackageTitle") ||
    document.getElementById("selectedPackageName") ||
    document.getElementById("mobileSelectedPackageName") ||
    document.querySelector("[data-selected-package-title]");

  const subtitle =
    document.getElementById("selectedPackageSubtitle") ||
    document.getElementById("selectedPackagePrice") ||
    document.getElementById("mobileSelectedPackagePrice") ||
    document.querySelector("[data-selected-package-subtitle]");

  const code =
    document.getElementById("selectedPackageCode") ||
    document.querySelector("[data-selected-package-code]");

  const defaultIcon = rememberDefaultPackageIcon(icon, preview);

  if (preview) preview.classList.add("selected", "has-package");
  setPackagePreviewIcon(icon, pkg.icon, pkg.fallbackIcon || defaultIcon);
  if (title) {
    window.AZIEL_MOTION?.swapText(title, pkg.name) ||
      (title.textContent = pkg.name);
  }
  if (subtitle) {
    window.AZIEL_MOTION?.swapText(subtitle, pkg.formattedPrice) ||
      (subtitle.textContent = pkg.formattedPrice);
  }
  if (code) {
    window.AZIEL_MOTION?.swapText(code, pkg.code) ||
      (code.textContent = pkg.code);
  }

  window.AZIEL_MOTION?.emphasize(preview, "updated");
}

function resetSelectedPackagePreview() {
  const preview =
    document.getElementById("selectedPackagePreview") ||
    document.getElementById("openPackagePanel") ||
    document.querySelector("[data-selected-package-preview]") ||
    document.querySelector(".selected-package-preview");

  const icon =
    document.getElementById("selectedPackageIcon") ||
    document.getElementById("mobilePackageIcon") ||
    document.querySelector("[data-selected-package-icon]");

  const title =
    document.getElementById("selectedPackageTitle") ||
    document.getElementById("selectedPackageName") ||
    document.getElementById("mobileSelectedPackageName") ||
    document.querySelector("[data-selected-package-title]");

  const subtitle =
    document.getElementById("selectedPackageSubtitle") ||
    document.getElementById("selectedPackagePrice") ||
    document.getElementById("mobileSelectedPackagePrice") ||
    document.querySelector("[data-selected-package-subtitle]");

  const defaultIcon = rememberDefaultPackageIcon(icon, preview);
  const staticFallbackIcon = getStaticPreviewFallbackIcon(icon);

  if (preview) preview.classList.remove("selected", "has-package");
  if (icon) setPackagePreviewIcon(icon, defaultIcon, staticFallbackIcon || defaultIcon);
  if (title) title.textContent = "Select Top-Up Amount";
  if (subtitle) subtitle.textContent = "Choose your package";
}

function getSelectedPackage() {
  return selectedPackage;
}

function bindPackageIconFallbacks(root) {
  root?.querySelectorAll?.(".pack-icon img[data-fallback-src]")?.forEach(img => {
    img.onerror = function handlePackageIconError() {
      const fallback = this.dataset.fallbackSrc || "";

      if (fallback && this.getAttribute("src") !== fallback) {
        this.src = fallback;
        return;
      }

      this.onerror = null;
    };
  });
}

function escapeAttr(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value = "") {
  return escapeAttr(value);
}

function cssEscape(value = "") {
  if (window.CSS?.escape) return CSS.escape(String(value));

  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
}

window.renderGamePrices = renderGamePrices;
window.getSelectedPackage = getSelectedPackage;
window.selectPackage = selectPackage;
window.clearSelectedPackage = clearSelectedPackage;
