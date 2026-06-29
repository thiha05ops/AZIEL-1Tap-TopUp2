// frontend/js/prices.js - AZIEL V2.5 Shop Region Prices + Asset Manager

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
    { name: "60 UC", mmk: 0, thb: 0, code: "PUBG_60_UC", icon: pubgIcon("uc.webp") },
    { name: "325 UC", mmk: 0, thb: 0, code: "PUBG_325_UC", icon: pubgIcon("uc.webp") }
  ],

  freefire: [
    { name: "100 Diamonds", mmk: 0, thb: 0, code: "FF_100_DIA", icon: freefireIcon("diamond.webp") },
    { name: "310 Diamonds", mmk: 0, thb: 0, code: "FF_310_DIA", icon: freefireIcon("diamond.webp") }
  ],

  hok: [
    { name: "80 Tokens", mmk: 0, thb: 0, code: "HOK_80_TOKENS", icon: hokIcon("token.webp") },
    { name: "240 Tokens", mmk: 0, thb: 0, code: "HOK_240_TOKENS", icon: hokIcon("token.webp") }
  ],

  genshin: [],
  roblox: [],
  valorant: []
};

document.addEventListener("DOMContentLoaded", () => {
  renderGamePrices();

  window.addEventListener("aziel:shopRegionChanged", renderGamePrices);
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

function renderGamePrices() {
  const packageContainer = document.getElementById("packages");
  if (!packageContainer) return;

  const game = packageContainer.dataset.game;
  const packages = GAME_PRICES[game];
  const symbol = getShopSymbol();

  if (!packages || !packages.length) {
    packageContainer.innerHTML = `<p style="color:#aaa;">No packages available.</p>`;
    document.dispatchEvent(new Event("pricesRendered"));
    return;
  }

  packageContainer.innerHTML = packages.map(item => {
    const price = getPriceByRegion(item);

    return `
            <div class="pack"
                 data-name="${item.name}"
                 data-price="${price}"
                 data-code="${item.code}">
                <div class="pack-icon">
                    <img src="${item.icon}" alt="${item.name}">
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

  document.dispatchEvent(new Event("pricesRendered"));
}

window.GAME_PRICES = GAME_PRICES;
window.renderGamePrices = renderGamePrices;