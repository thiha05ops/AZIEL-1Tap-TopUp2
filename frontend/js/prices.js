// frontend/js/prices.js - AZIEL V2.5 Shop Region Prices + Package Select Engine

function assetFallback(path) {
  return path.replace(/^\/+/, "");
}

function mlbbIcon(file) {
  return window.ASSET?.mlbb?.(`icons/${file}`) || assetFallback(`assets/mlbb/icons/${file}`);
}

function pubgIcon(file) {
  return window.ASSET?.pubg?.(`icons/${file}`) || assetFallback(`assets/pubg/icons/${file}`);
}

function freefireIcon(file) {
  return window.ASSET?.freefire?.(`icons/${file}`) || assetFallback(`assets/freefire/icons/${file}`);
}

function hokIcon(file) {
  return window.ASSET?.hok?.(`icons/${file}`) || assetFallback(`assets/hok/icons/${file}`);
}

function aovidIcon(file) {
  return window.ASSET?.aovid?.(`icons/${file}`) || assetFallback(`assets/aovid/icons/${file}`);
}

function pubgrpIcon(file) {
  return window.ASSET?.pubgrp?.(`icons/${file}`) || assetFallback(`assets/pubgrp/icons/${file}`);
}

function telegramIcon(file) {
  return window.ASSET?.telegram?.(`icons/${file}`) || assetFallback(`assets/telegram/icons/${file}`);
}

function genshinIcon(file) {
  return window.ASSET?.genshin?.(`icons/${file}`) || assetFallback(`assets/genshin/icons/${file}`);
}

const GAME_PRICES = {
  mlbb: [
    { name: "Weekly Pass 1x", mmk: 6800, thb: 55, code: "MLBB_WEEKLY_1X", icon: mlbbIcon("weekly.webp") },
    { name: "13+1 Diamonds", mmk: 1100, thb: 10, code: "MLBB_13_1", icon: mlbbIcon("small.webp") },
    { name: "22 Diamonds", mmk: 1800, thb: 12, code: "MLBB_22", icon: mlbbIcon("small.webp") },
    { name: "42 Diamonds", mmk: 3456, thb: 27, code: "MLBB_42", icon: mlbbIcon("small.webp") },
    { name: "56 Diamonds", mmk: 3750, thb: 30, code: "MLBB_56", icon: mlbbIcon("medium.webp") },
    { name: "86 Diamonds", mmk: 5700, thb: 45, code: "MLBB_86", icon: mlbbIcon("medium.webp") },
    { name: "112 Diamonds", mmk: 7200, thb: 56, code: "MLBB_112", icon: mlbbIcon("medium.webp") },
    { name: "172 Diamonds", mmk: 12400, thb: 88, code: "MLBB_172", icon: mlbbIcon("medium.webp") },
    { name: "284 Diamonds", mmk: 22000, thb: 162, code: "MLBB_284", icon: mlbbIcon("big.webp") },
    { name: "344 Diamonds", mmk: 22800, thb: 170, code: "MLBB_344", icon: mlbbIcon("cheset.webp") },
    { name: "570 Diamonds", mmk: 35000, thb: 274, code: "MLBB_570", icon: mlbbIcon("cheset2.webp") },
    { name: "716 Diamonds", mmk: 51000, thb: 340, code: "MLBB_716", icon: mlbbIcon("cheset2.webp") },
    { name: "1163 Diamonds", mmk: 70500, thb: 545, code: "MLBB_1163", icon: mlbbIcon("cheset3.webp") },
    { name: "1160+186 Diamonds", mmk: 84500, thb: 652, code: "MLBB_1160_186", icon: mlbbIcon("cheset3.webp") },
    { name: "1360+335 Diamonds", mmk: 138500, thb: 989, code: "MLBB_1360_335", icon: mlbbIcon("cheset3.webp") },
    { name: "2015+475 Diamonds", mmk: 193000, thb: 1490, code: "MLBB_2015_475", icon: mlbbIcon("cheset4.webp") },
    { name: "5000+1000 Diamonds", mmk: 193000, thb: 1490, code: "MLBB_5000_1000", icon: mlbbIcon("cheset5.webp") },
    { name: "7740+1548 Diamonds", mmk: 193000, thb: 1490, code: "MLBB_7740_1548", icon: mlbbIcon("cheset5.webp") }
  ],

  pubg: [
    { name: "60 UC", mmk: 3910, thb: 30.31, code: "PUBG_60_UC", icon: pubgIcon("uc.webp") },
    { name: "300 + 25 UC", mmk: 19273, thb: 149.40, code: "PUBG_300_25_UC", icon: pubgIcon("uc.webp") },
    { name: "600 + 60 UC", mmk: 38585, thb: 299.11, code: "PUBG_600_60_UC", icon: pubgIcon("uc.webp") },
    { name: "1500 + 300 UC", mmk: 95566, thb: 740.82, code: "PUBG_1500_300_UC", icon: pubgIcon("uc.webp") },
    { name: "3000 + 850 UC", mmk: 193081, thb: 1496.75, code: "PUBG_3000_850_UC", icon: pubgIcon("uc.webp") },
    { name: "6000 + 2100 UC", mmk: 386200, thb: 2993.80, code: "PUBG_6000_2100_UC", icon: pubgIcon("uc.webp") },
    { name: "12000 + 4200 UC", mmk: 772439, thb: 5987.90, code: "PUBG_12000_4200_UC", icon: pubgIcon("uc.webp") },
    { name: "18000 + 6300 UC", mmk: 1158678, thb: 8982.00, code: "PUBG_18000_6300_UC", icon: pubgIcon("uc.webp") },
    { name: "24000 + 8400 UC", mmk: 1579635, thb: 12245.23, code: "PUBG_24000_8400_UC", icon: pubgIcon("uc.webp") },
    { name: "30000 + 10500 UC", mmk: 1931156, thb: 14970.20, code: "PUBG_30000_10500_UC", icon: pubgIcon("uc.webp") }
  ],

  freefire: [
    { name: "100 Diamonds", mmk: 4279, thb: 33.17, code: "FF_100_DIA", icon: freefireIcon("diamond.webp") },
    { name: "210 Diamonds", mmk: 8560, thb: 66.36, code: "FF_210_DIA", icon: freefireIcon("diamond.webp") },
    { name: "310 Diamonds", mmk: 11642, thb: 90.25, code: "FF_310_DIA", icon: freefireIcon("diamond.webp") },
    { name: "520 Diamonds", mmk: 17883, thb: 138.63, code: "FF_520_DIA", icon: freefireIcon("diamond.webp") },
    { name: "530 Diamonds", mmk: 21399, thb: 165.88, code: "FF_530_DIA", icon: freefireIcon("diamond.webp") },
    { name: "1,060 Diamonds", mmk: 35613, thb: 276.07, code: "FF_1060_DIA", icon: freefireIcon("diamond.webp") },
    { name: "1080 Diamonds", mmk: 42797, thb: 331.76, code: "FF_1080_DIA", icon: freefireIcon("diamond.webp") },
    { name: "2,180 Diamonds", mmk: 72997, thb: 565.87, code: "FF_2180_DIA", icon: freefireIcon("diamond.webp") }
  ],

  pubgrp: [
    { name: "Elite Pass (LV1-100)", mmk: 46364, thb: 359.41, code: "PUBGRP_ELITE_1_100", icon: pubgrpIcon("rp.webp") },
    { name: "Elite Pass Plus (LV1-100)", mmk: 115967, thb: 898.97, code: "PUBGRP_ELITE_PLUS_1_100", icon: pubgrpIcon("rp.webp") },
    { name: "Elite Pass (LV1-50)", mmk: 23162, thb: 179.55, code: "PUBGRP_ELITE_1_50", icon: pubgrpIcon("rp.webp") },
    { name: "Weekly Mythic Emblem Value Pack", mmk: 14307, thb: 110.91, code: "PUBGRP_WEEKLY_MYTHIC", icon: pubgrpIcon("rp.webp") },
    { name: "Mythic Emblem Pack", mmk: 19119, thb: 148.21, code: "PUBGRP_MYTHIC_EMBLEM", icon: pubgrpIcon("rp.webp") },
    { name: "Weekly Deal Pack 1", mmk: 3913, thb: 30.33, code: "PUBGRP_WEEKLY_DEAL_1", icon: pubgrpIcon("rp.webp") },
    { name: "Weekly Deal Pack 2", mmk: 11819, thb: 91.62, code: "PUBGRP_WEEKLY_DEAL_2", icon: pubgrpIcon("rp.webp") },
    { name: "Prime (1 Month)", mmk: 3824, thb: 29.64, code: "PUBGRP_PRIME_1M", icon: pubgrpIcon("rp.webp") },
    { name: "Prime (3 Months)", mmk: 11557, thb: 89.59, code: "PUBGRP_PRIME_3M", icon: pubgrpIcon("rp.webp") },
    { name: "Prime (6 Months)", mmk: 23158, thb: 179.52, code: "PUBGRP_PRIME_6M", icon: pubgrpIcon("rp.webp") },
    { name: "Prime (12 Months)", mmk: 46359, thb: 359.37, code: "PUBGRP_PRIME_12M", icon: pubgrpIcon("rp.webp") },
    { name: "Prime Plus (1 Month)", mmk: 38625, thb: 299.42, code: "PUBGRP_PRIME_PLUS_1M", icon: pubgrpIcon("rp.webp") },
    { name: "Prime Plus (3 Months)", mmk: 115962, thb: 898.93, code: "PUBGRP_PRIME_PLUS_3M", icon: pubgrpIcon("rp.webp") },
    { name: "Prime Plus (6 Months)", mmk: 231968, thb: 1798.20, code: "PUBGRP_PRIME_PLUS_6M", icon: pubgrpIcon("rp.webp") },
    { name: "Prime Plus (12 Months)", mmk: 463979, thb: 3596.74, code: "PUBGRP_PRIME_PLUS_12M", icon: pubgrpIcon("rp.webp") },
    { name: "Upgradable Firearm Materials Pack", mmk: 11557, thb: 89.59, code: "PUBGRP_FIREARM_MATERIALS", icon: pubgrpIcon("rp.webp") },
    { name: "First Purchase Pack", mmk: 3824, thb: 29.64, code: "PUBGRP_FIRST_PURCHASE", icon: pubgrpIcon("rp.webp") }
  ],

  hok: [
    { name: "Weekly Card", mmk: 4337, thb: 33.62, code: "HOK_WEEKLY_CARD", icon: hokIcon("weekly.webp") },
    { name: "Weekly Card Plus", mmk: 12798, thb: 99.21, code: "HOK_WEEKLY_CARD_PLUS", icon: hokIcon("weekly-plus.webp") },
    { name: "16 Tokens", mmk: 832, thb: 6.45, code: "HOK_16_TOKENS", icon: hokIcon("token.webp") },
    { name: "80 Tokens", mmk: 3817, thb: 29.59, code: "HOK_80_TOKENS", icon: hokIcon("token.webp") },
    { name: "240 Tokens", mmk: 11531, thb: 89.39, code: "HOK_240_TOKENS", icon: hokIcon("token.webp") },
    { name: "400 Tokens", mmk: 19246, thb: 149.19, code: "HOK_400_TOKENS", icon: hokIcon("token.webp") },
    { name: "560 Tokens", mmk: 26958, thb: 208.98, code: "HOK_560_TOKENS", icon: hokIcon("token.webp") },
    { name: "800 + 30 Tokens", mmk: 38530, thb: 298.68, code: "HOK_800_30_TOKENS", icon: hokIcon("token.webp") },
    { name: "1200 + 45 Tokens", mmk: 57814, thb: 448.17, code: "HOK_1200_45_TOKENS", icon: hokIcon("token.webp") }
  ],

  aovid: [
    { name: "40 Vouchers", mmk: 2414, thb: 18.71, code: "AOVID_40", icon: aovidIcon("voucher.webp") },
    { name: "90 Vouchers", mmk: 4826, thb: 37.41, code: "AOVID_90", icon: aovidIcon("voucher.webp") },
    { name: "230 Vouchers", mmk: 12067, thb: 93.54, code: "AOVID_230", icon: aovidIcon("voucher.webp") },
    { name: "470 Vouchers", mmk: 24132, thb: 187.07, code: "AOVID_470", icon: aovidIcon("voucher.webp") },
    { name: "950 Vouchers", mmk: 48265, thb: 374.15, code: "AOVID_950", icon: aovidIcon("voucher.webp") },
    { name: "1430 Vouchers", mmk: 72397, thb: 561.22, code: "AOVID_1430", icon: aovidIcon("voucher.webp") },
    { name: "2390 Vouchers", mmk: 120663, thb: 935.37, code: "AOVID_2390", icon: aovidIcon("voucher.webp") },
    { name: "4800 Vouchers", mmk: 241325, thb: 1870.74, code: "AOVID_4800", icon: aovidIcon("voucher.webp") },
    { name: "24050 Vouchers", mmk: 1206627, thb: 9353.70, code: "AOVID_24050", icon: aovidIcon("voucher.webp") },
    { name: "48200 Vouchers", mmk: 2413255, thb: 18707.40, code: "AOVID_48200", icon: aovidIcon("voucher.webp") }
  ],

  telegram: [
    { name: "50 Stars", mmk: 3433, thb: 26.61, code: "TG_50_STARS", icon: telegramIcon("stars.webp") },
    { name: "75 Stars", mmk: 5195, thb: 40.27, code: "TG_75_STARS", icon: telegramIcon("stars.webp") },
    { name: "100 Stars", mmk: 6864, thb: 53.21, code: "TG_100_STARS", icon: telegramIcon("stars.webp") },
    { name: "150 Stars", mmk: 10295, thb: 79.81, code: "TG_150_STARS", icon: telegramIcon("stars.webp") },
    { name: "250 Stars", mmk: 17192, thb: 133.27, code: "TG_250_STARS", icon: telegramIcon("stars.webp") },
    { name: "350 Stars", mmk: 24087, thb: 186.72, code: "TG_350_STARS", icon: telegramIcon("stars.webp") },
    { name: "500 Stars", mmk: 34384, thb: 266.54, code: "TG_500_STARS", icon: telegramIcon("stars.webp") },
    { name: "750 Stars", mmk: 51574, thb: 399.80, code: "TG_750_STARS", icon: telegramIcon("stars.webp") },
    { name: "1000 Stars", mmk: 68766, thb: 533.07, code: "TG_1000_STARS", icon: telegramIcon("stars.webp") },
    { name: "1500 Stars", mmk: 103117, thb: 799.36, code: "TG_1500_STARS", icon: telegramIcon("stars.webp") },
    { name: "2500 Stars", mmk: 171853, thb: 1332.19, code: "TG_2500_STARS", icon: telegramIcon("stars.webp") },
    { name: "5000 Stars", mmk: 343737, thb: 2664.63, code: "TG_5000_STARS", icon: telegramIcon("stars.webp") },
    { name: "10000 Stars", mmk: 687472, thb: 5329.24, code: "TG_10000_STARS", icon: telegramIcon("stars.webp") },
    { name: "Premium 3 Months", mmk: 54945, thb: 425.93, code: "TG_PREMIUM_3M", icon: telegramIcon("premium.webp") },
    { name: "Premium 6 Months", mmk: 73280, thb: 568.06, code: "TG_PREMIUM_6M", icon: telegramIcon("premium.webp") },
    { name: "Premium 12 Months", mmk: 132864, thb: 1029.95, code: "TG_PREMIUM_12M", icon: telegramIcon("premium.webp") }
  ],

  genshin: [],
  roblox: [],
  valorant: []
};

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
      reselectCode: selectedCode
    });
  });
});

function getShopRegion() {
  return window.AZIEL?.getShopRegion?.() || "MM";
}

function getShopSymbol() {
  return window.AZIEL?.getShopSymbol?.() || (getShopRegion() === "TH" ? "฿" : "Ks");
}

function getPriceByRegion(item) {
  return getShopRegion() === "TH" ? item.thb : item.mmk;
}

function formatPackagePrice(price) {
  return `${Number(price || 0).toLocaleString()} ${getShopSymbol()}`;
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

function clearSelectedPackage(reason = "cleared") {
  selectedPackage = null;
  window.selectedPackage = null;
  resetSelectedPackagePreview();
  emitPackageEvent("package:cleared", { reason });
}

function renderGamePrices(options = {}) {
  const packageContainer = document.getElementById("packages");
  if (!packageContainer) return;

  const game = packageContainer.dataset.game;
  const packages = GAME_PRICES[game];
  const symbol = getShopSymbol();

  if (!packages || !packages.length) {
    packageContainer.innerHTML = `<p style="color:#aaa;">No packages available.</p>`;
    clearSelectedPackage("catalog_unavailable");
    emitPricesRendered({
      game,
      hasPackages: false
    });
    return;
  }

  packageContainer.innerHTML = packages.map(item => {
    const price = getPriceByRegion(item);

    return `
      <div class="pack"
           data-name="${escapeAttr(item.name)}"
           data-price="${price}"
           data-code="${escapeAttr(item.code)}"
           data-icon="${escapeAttr(item.icon)}">
        <div class="pack-icon">
          <img src="${item.icon}" alt="${escapeAttr(item.name)}">
        </div>

        <div class="pack-info">
          <strong class="pack-name">${item.name}</strong>
          <span class="pack-price">
            ${Number(price || 0).toLocaleString()} ${symbol}
          </span>
        </div>
      </div>
    `;
  }).join("");

  emitPricesRendered({
    game,
    hasPackages: true
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

    clearSelectedPackage("package_missing_after_region_change");
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
    name: packEl.dataset.name,
    price: Number(packEl.dataset.price || 0),
    amount: Number(packEl.dataset.price || 0),
    code: packEl.dataset.code,
    icon: packEl.dataset.icon,
    formattedPrice: formatPackagePrice(packEl.dataset.price)
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

  if (preview) preview.classList.add("selected", "has-package");
  if (icon && pkg.icon) icon.src = pkg.icon;
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

  if (preview) preview.classList.remove("selected", "has-package");
  if (icon) icon.removeAttribute("src");
  if (title) title.textContent = "Select Top-Up Amount";
  if (subtitle) subtitle.textContent = "Choose your package";
}

function getSelectedPackage() {
  return selectedPackage;
}

function escapeAttr(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function cssEscape(value = "") {
  if (window.CSS?.escape) return CSS.escape(String(value));

  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
}

window.GAME_PRICES = GAME_PRICES;
window.renderGamePrices = renderGamePrices;
window.getSelectedPackage = getSelectedPackage;
window.selectPackage = selectPackage;
window.clearSelectedPackage = clearSelectedPackage;
