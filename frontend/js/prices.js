// frontend/js/prices.js
// Compatibility package renderer/selection bridge. Public catalog owns prices.

let selectedPackage = null;
let pricingRenderRequestId = 0;
let catalogLoadInFlight = false;
const MOBILE_PACKAGE_PICKER_QUERY = "(max-width: 768px)";
let mobilePackagePickerState = null;

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("pricesRendered", bindPackageSelection);
  setupMobilePackagePicker();

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

  window.addEventListener("aziel:locale-changed", () => {
    const selectedCode = selectedPackage?.code || document.querySelector(".pack.active")?.dataset.code || "";
    renderGamePrices({ reselectCode: selectedCode, reason: "locale_changed" });
  });

  document.addEventListener("aziel:catalog-updated", event => {
    if (event.detail?.status !== "ready") return;
    if (event.detail?.source === "purchase") return;
    if (catalogLoadInFlight) return;
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

function availabilityMessage(code, fallback = "") {
  return window.AZIEL_CATALOG?.availabilityMessage?.(code) || fallback || "This product is currently unavailable.";
}

function showPackageSkeletons(packageContainer) {
  packageContainer.setAttribute("aria-busy", "true");
  packageContainer.innerHTML = Array.from({ length: 8 }, (_, index) => `
    <div class="pack pack-skeleton az-storefront-skeleton" aria-hidden="true">
      <span class="pack-skeleton-name"></span>
      <span class="pack-skeleton-price"></span>
    </div>
  `).join("") + '<span class="az-visually-hidden" role="status">Loading available packages</span>';
  syncMobilePackagePickerLayout();
}

function finishPackageLoading(packageContainer) {
  packageContainer?.setAttribute("aria-busy", "false");
  syncMobilePackagePickerLayout();
}

function t(key, fallback) {
  return window.AZIEL_I18N?.t?.(key) || window.i18n?.t?.(key) || fallback;
}

async function loadAuthoritativePrice(item) {
  const response = await fetch("/api/pricing/preview", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      productCode: item.productCode,
      packageCode: item.packageCode,
      region: item.region,
      currency: item.currency
    })
  });
  const data = await response.json().catch(() => ({}));
  const amount = Number(data.quote?.finalAmount);
  if (!response.ok || !data.success || !Number.isFinite(amount) || amount <= 0) {
    const error = new Error(data.message || "Authoritative package price unavailable");
    error.code = data.availabilityCode || "PRICING_UNAVAILABLE";
    error.businessUnavailable = ["PRODUCT_HIDDEN", "PRODUCT_DISABLED", "REGION_UNAVAILABLE", "PACKAGE_UNAVAILABLE", "SETUP_INCOMPLETE", "COMING_SOON"].includes(error.code);
    throw error;
  }
  return {
    ...item,
    amount,
    price: amount,
    referencePrice: Number(data.quote.referencePrice || 0),
    saveAmount: Number(data.quote.saveAmount || 0),
    discountPercent: Number(data.quote.discountPercent || 0),
    authoritativePreview: data.quote
  };
}

async function settleAuthoritativePrices(items, requestId) {
  const results = [];
  const concurrency = 4;
  for (let index = 0; index < items.length; index += concurrency) {
    if (requestId !== pricingRenderRequestId) return null;
    const batch = items.slice(index, index + concurrency);
    results.push(...await Promise.allSettled(batch.map(loadAuthoritativePrice)));
  }
  return results;
}

function clearSelectedPackage(reason = "cleared") {
  selectedPackage = null;
  window.selectedPackage = null;
  resetSelectedPackagePreview();
  emitPackageEvent("package:cleared", { reason });
}

async function renderGamePrices(options = {}) {
  const requestId = ++pricingRenderRequestId;
  const packageContainer = document.getElementById("packages");
  if (!packageContainer) return;

  const game = packageContainer.dataset.game;
  const catalog = window.AZIEL_CATALOG;

  if (!catalog) {
    packageContainer.dataset.catalogSynced = "false";
    showCatalogMessage(packageContainer, availabilityMessage("CATALOG_UNAVAILABLE", "Catalog is temporarily unavailable. Please try again shortly."), false);
    clearSelectedPackage("catalog_client_missing");
    emitPricesRendered({ game, hasPackages: false, ready: false });
    finishPackageLoading(packageContainer);
    return { ready: false, error: true, selectedPackage: null };
  }

  packageContainer.dataset.catalogSynced = "false";
  showPackageSkeletons(packageContainer);

  catalogLoadInFlight = true;
  try {
    await catalog.load({ force: Boolean(options.forceRefresh) });
  } catch (error) {
    if (requestId !== pricingRenderRequestId) return;
    showCatalogMessage(packageContainer, availabilityMessage("CATALOG_UNAVAILABLE", "Catalog is temporarily unavailable. Please try again shortly."), true);
    clearSelectedPackage("catalog_unavailable");
    emitPricesRendered({ game, hasPackages: false, ready: false, error: true });
    finishPackageLoading(packageContainer);
    return { ready: false, error: true, selectedPackage: null };
  } finally {
    catalogLoadInFlight = false;
  }
  if (requestId !== pricingRenderRequestId) return;

  const product = catalog.getProduct(game);

  if (!product) {
    showCatalogMessage(packageContainer, availabilityMessage("PRODUCT_HIDDEN"), false);
    clearSelectedPackage("product_disabled");
    emitPricesRendered({ game, hasPackages: false, ready: true, unavailable: true });
    finishPackageLoading(packageContainer);
    return { ready: false, unavailable: true, selectedPackage: null };
  }

  const catalogPackages = catalog.getPackages(game, getShopRegion());
  packageContainer.dataset.catalogSynced = "true";

  if (!catalogPackages.length) {
    const availability = catalog.getAvailability?.(game, getShopRegion()) || { code: "PACKAGE_UNAVAILABLE" };
    showCatalogMessage(packageContainer, availability.message || availabilityMessage(availability.code), false);
    clearSelectedPackage("no_regional_packages");
    emitPricesRendered({ game, hasPackages: false, ready: true });
    finishPackageLoading(packageContainer);
    return { ready: false, unavailable: true, selectedPackage: null };
  }

  const previewResults = await settleAuthoritativePrices(catalogPackages, requestId);
  if (!previewResults) return;
  if (requestId !== pricingRenderRequestId) return;
  const packages = previewResults.filter(result => result.status === "fulfilled").map(result => result.value);
  const failures = previewResults.filter(result => result.status === "rejected");
  if (failures.length) {
    console.warn(`Authoritative pricing preview failures: ${JSON.stringify(failures.map(result => result.reason?.message || "Preview unavailable"))}`);
  }
  if (!packages.length) {
    const businessFailure = failures.find(result => result.reason?.businessUnavailable);
    const failureCode = businessFailure?.reason?.code || "PRICING_UNAVAILABLE";
    showCatalogMessage(packageContainer, availabilityMessage(failureCode), !businessFailure);
    clearSelectedPackage("authoritative_price_unavailable");
    emitPricesRendered({ game, hasPackages: false, ready: false, error: true });
    finishPackageLoading(packageContainer);
    return { ready: false, error: true, selectedPackage: null };
  }

  const familyGroups = [];
  packages.forEach(item => {
    const family = item.packageFamily?.code ? item.packageFamily : { code: "OTHER_SPECIAL", name: t("product.otherSpecial", "Other / Special"), sortOrder: 90 };
    let group = familyGroups.find(entry => entry.code === family.code);
    if (!group) { group = { ...family, packages: [] }; familyGroups.push(group); }
    group.packages.push(item);
  });
  familyGroups.sort((a, b) => Number(a.sortOrder || 90) - Number(b.sortOrder || 90));
  const renderPackage = item => {
    const artwork = String(item.artwork || "").trim();
    return `
    <div class="pack"
         role="button"
         tabindex="0"
         aria-pressed="false"
         aria-label="${escapeAttr(`${item.name}, ${formatPackagePrice(item.amount, item.currency)}`)}"
         data-name="${escapeAttr(item.name)}"
         data-price="${escapeAttr(item.amount)}"
         data-amount="${escapeAttr(item.amount)}"
         data-currency="${escapeAttr(item.currency)}"
         data-region="${escapeAttr(item.region)}"
         data-code="${escapeAttr(item.packageCode)}"
         data-customer-note="${escapeAttr(item.customerNote || "")}"
         title="${escapeAttr(item.customerNote || "")}"
         data-product-code="${escapeAttr(item.productCode)}"
         data-icon="${escapeAttr(item.icon)}"
         data-artwork="${escapeAttr(artwork)}"
         data-fallback-icon="${escapeAttr(item.fallbackIcon || "")}"
         data-reference-price="${escapeAttr(item.referencePrice || 0)}"
         data-save-amount="${escapeAttr(item.saveAmount || 0)}"
         data-discount-percent="${escapeAttr(item.discountPercent || 0)}"
         data-show-discount="${item.showDiscount === true}"
         data-show-original-price="${item.showOriginalPrice === true}"
         data-catalog-synced="true">
      ${artwork ? `<div class="pack-icon" data-package-media>
        <img src="${escapeAttr(artwork)}" alt="${escapeAttr(item.artworkAlt || item.name)}" width="88" height="88" loading="lazy" decoding="async">
      </div>` : ""}

      <div class="pack-info">
        <strong class="pack-name">${escapeHtml(item.name)}</strong>

        ${item.showDiscount
      ? `<span class="pack-discount-text">${Number(item.discountPercent || 0).toLocaleString()}% ${escapeHtml(t("product.offerOff", "OFF"))}</span>`
      : ""
    }
      </div>

      <div class="pack-price-block">
        ${item.showOriginalPrice
      ? `<span class="pack-original-price">
                ${formatPackagePrice(item.referencePrice, item.currency)}
              </span>`
      : ""
    }

        <span class="pack-price">
          ${formatPackagePrice(item.amount, item.currency)}
        </span>
      </div>
    </div>
  `;
  };
  packageContainer.innerHTML = familyGroups.map(group => `
    <section class="package-family-section" data-package-family="${escapeAttr(group.code)}">
      <h3 class="package-family-title">${escapeHtml(group.name)}</h3>
      <div class="package-family-grid">${group.packages.map(renderPackage).join("")}</div>
    </section>
  `).join("");
  finishPackageLoading(packageContainer);

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
      return { ready: true, unavailable: false, selectedPackage };
    }

    clearSelectedPackage(options.reason === "region_changed"
      ? "package_missing_after_region_change"
      : "package_missing_after_catalog_refresh");
    window.PaymentUtils?.showToast?.(t("catalogPackageUnavailable", "This package is no longer available. Please select another package."));
    return { ready: false, unavailable: true, selectedPackage: null };
  }

  clearSelectedPackage("prices_rendered");
  return { ready: true, unavailable: false, selectedPackage: null };
}

function bindPackageSelection() {
  document.querySelectorAll(".pack").forEach(pack => {
    pack.onclick = () => selectPackage(pack);
    pack.onkeydown = event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectPackage(pack);
    };
  });
  syncMobilePackagePickerLayout();
}

function selectPackage(packEl) {
  if (!packEl) return;

  document.querySelectorAll(".pack").forEach(item => {
    item.classList.remove("active");
    item.setAttribute("aria-pressed", "false");
  });

  packEl.classList.add("active");
  packEl.setAttribute("aria-pressed", "true");
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
    customerNote: packEl.dataset.customerNote || "",
    referencePrice: Number(packEl.dataset.referencePrice || 0),
    saveAmount: Number(packEl.dataset.saveAmount || 0),
    discountPercent: Number(packEl.dataset.discountPercent || 0),
    showDiscount: packEl.dataset.showDiscount === "true",
    showOriginalPrice: packEl.dataset.showOriginalPrice === "true",
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
  syncMobilePackagePickerLayout();
}

function setupMobilePackagePicker() {
  if (mobilePackagePickerState) {
    syncMobilePackagePickerLayout();
    return mobilePackagePickerState;
  }

  const packageContainer = document.getElementById("packages");
  const summary = document.getElementById("selectedPackagePreview") || document.getElementById("openPackagePanel");
  const panel = document.getElementById("mobilePackagePanel");
  const list = document.getElementById("mobilePackageList");
  const closeButton = document.getElementById("closePackagePanel");
  const confirmButton = document.getElementById("confirmPackagePanel");

  if (!packageContainer || !summary || !panel || !list) return null;

  const placeholder = document.createComment("aziel-packages-inline-anchor");
  packageContainer.parentNode?.insertBefore(placeholder, packageContainer);

  const media = window.matchMedia?.(MOBILE_PACKAGE_PICKER_QUERY);
  const isMobile = () => Boolean(media?.matches || window.innerWidth <= 768);

  mobilePackagePickerState = {
    packageContainer,
    summary,
    panel,
    list,
    closeButton,
    confirmButton,
    placeholder,
    inlineParent: placeholder.parentNode,
    isMobile
  };

  summary.setAttribute("aria-haspopup", "dialog");
  summary.setAttribute("aria-controls", panel.id || "mobilePackagePanel");
  summary.setAttribute("aria-expanded", "false");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "mobilePackagePanelTitle");
  panel.querySelector(".mobile-panel-head h3")?.setAttribute("id", "mobilePackagePanelTitle");

  summary.addEventListener("click", openMobilePackagePicker);
  closeButton?.addEventListener("click", closeMobilePackagePicker);
  confirmButton?.addEventListener("click", closeMobilePackagePicker);
  panel.addEventListener("click", event => {
    if (event.target === panel) closeMobilePackagePicker();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && panel.classList.contains("show")) {
      closeMobilePackagePicker();
    }
  });

  media?.addEventListener?.("change", syncMobilePackagePickerLayout);
  window.addEventListener("resize", syncMobilePackagePickerLayout);

  syncMobilePackagePickerLayout();
  return mobilePackagePickerState;
}

function refreshMobilePackagePickerContainer(state) {
  const current = document.getElementById("packages");
  if (!current || current === state.packageContainer) return state.packageContainer;

  state.packageContainer = current;
  if (!state.placeholder.parentNode && current.parentNode) {
    current.parentNode.insertBefore(state.placeholder, current);
    state.inlineParent = state.placeholder.parentNode;
  }
  return current;
}

function syncMobilePackagePickerLayout() {
  const state = mobilePackagePickerState;
  if (!state) return;

  const packageContainer = refreshMobilePackagePickerContainer(state);
  const { summary, panel, list, placeholder, inlineParent, isMobile } = state;

  if (isMobile()) {
    if (packageContainer.parentNode !== list) {
      list.appendChild(packageContainer);
    }
    summary.hidden = false;
    packageContainer.dataset.mobilePickerSource = "true";
    return;
  }

  if (packageContainer.parentNode !== inlineParent) {
    inlineParent.insertBefore(packageContainer, placeholder.nextSibling);
  }
  packageContainer.dataset.mobilePickerSource = "false";
  summary.hidden = true;
  panel.classList.remove("show");
  panel.setAttribute("hidden", "");
  summary.setAttribute("aria-expanded", "false");
  document.body.classList.remove("mobile-package-picker-open");
}

function openMobilePackagePicker(event) {
  const state = mobilePackagePickerState || setupMobilePackagePicker();
  if (!state || !state.isMobile()) return;

  event?.preventDefault?.();
  event?.stopImmediatePropagation?.();
  syncMobilePackagePickerLayout();
  state.panel.classList.add("show");
  state.panel.removeAttribute("hidden");
  state.summary.setAttribute("aria-expanded", "true");
  document.body.classList.add("mobile-package-picker-open");
  const active = state.packageContainer.querySelector(".pack.active");
  window.requestAnimationFrame?.(() => {
    active?.scrollIntoView?.({ block: "center", inline: "nearest" });
  });
}

function closeMobilePackagePicker() {
  const state = mobilePackagePickerState;
  if (!state) return;

  state.panel.classList.remove("show");
  state.panel.setAttribute("hidden", "");
  state.summary.setAttribute("aria-expanded", "false");
  document.body.classList.remove("mobile-package-picker-open");
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
  if (title) title.textContent = t("product.choosePackage", "Choose a package");
  if (subtitle) subtitle.textContent = t("product.tapToSelectPackage", "Tap to select");
}

function getSelectedPackage() {
  return selectedPackage;
}

function bindPackageIconFallbacks(root) {
  root?.querySelectorAll?.("[data-package-media] img")?.forEach(img => {
    img.onerror = function handlePackageIconError() {
      this.onerror = null;
      const media = this.closest("[data-package-media]");
      const card = this.closest(".pack");
      media?.remove();
      card?.classList.add("pack--text-only");
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
