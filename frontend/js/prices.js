// frontend/js/prices.js

const GAME_PRICES = {
  mlbb: [
    { name: "Weekly pass 1x", mmk: 6800, thb: 55, code: "MLBB_Weekly pass 1x", icon: "assets/mlbb/icons/weekly.webp" },
    { name: "13+1 Diamonds", mmk: 1100, thb: 10, code: "MLBB_13+1", icon: "assets/mlbb/icons/smaill.webp" },
    { name: "22 Diamonds", mmk: 1800, thb: 12, code: "MLBB_22", icon: "assets/mlbb/icons/small.webp" },
    { name: "42 Diamonds", mmk: 3456, thb: 27, code: "MLBB_42", icon: "assets/mlbb/icons/small.webp" },
    { name: "56 Diamonds", mmk: 3750, thb: 30, code: "MLBB_56", icon: "assets/mlbb/icons/medium.webp" },
    { name: "86 Diamonds", mmk: 5700, thb: 45, code: "MLBB_86", icon: "assets/mlbb/icons/medium.webp" },
    { name: "112 Diamonds", mmk: 7200, thb: 56, code: "MLBB_112", icon: "assets/mlbb/icons/medium.webp" },
    { name: "172 Diamonds", mmk: 12400, thb: 88, code: "MLBB_172", icon: "assets/mlbb/icons/medium.webp" },
    { name: "284 Diamonds", mmk: 22000, thb: 162, code: "MLBB_284", icon: "assets/mlbb/icons/big.webp" },
    { name: "284 Diamonds", mmk: 22000, thb: 162, code: "MLBB_284", icon: "assets/mlbb/icons/big.webp" },
    { name: "344 Diamonds", mmk: 22800, thb: 170, code: "MLBB_344", icon: "assets/mlbb/icons/cheset.webp" },
    { name: "344 Diamonds", mmk: 22800, thb: 170, code: "MLBB_344", icon: "assets/mlbb/icons/cheset.webp" },
    { name: "570 Diamonds", mmk: 35000, thb: 274, code: "MLBB_570", icon: "assets/mlbb/icons/cheset2.webp" },
    { name: "716 Diamonds", mmk: 51000, thb: 340, code: "MLBB_716", icon: "assets/mlbb/icons/cheset2.webp" },
    { name: "1163 Diamonds", mmk: 70500, thb: 545, code: "MLBB_1163", icon: "assets/mlbb/icons/cheset3.webp" },
    { name: "1163 Diamonds", mmk: 70500, thb: 545, code: "MLBB_1163", icon: "assets/mlbb/icons/cheset3.webp" },
    { name: "1160+186 Diamonds", mmk: 84500, thb: 652, code: "MLBB_1160+186", icon: "assets/mlbb/icons/cheset3.webp" },
    { name: "1360+335 Diamonds", mmk: 138500, thb: 989, code: "MLBB_1360+335", icon: "assets/mlbb/icons/cheset3.webp" },
    { name: "2015+475 Diamonds", mmk: 193000, thb: 1490, code: "MLBB_2015+475", icon: "assets/mlbb/icons/cheset4.webp" },
    { name: "2015+475 Diamonds", mmk: 193000, thb: 1490, code: "MLBB_2015+475", icon: "assets/mlbb/icons/cheset4.webp" },
    { name: "2015+475 Diamonds", mmk: 193000, thb: 1490, code: "MLBB_2015+475", icon: "assets/mlbb/icons/cheset4.webp" },
    { name: "5000+1000 Diamonds", mmk: 193000, thb: 1490, code: "MLBB_5000+1000", icon: "assets/mlbb/icons/cheset5.webp" },
    { name: "7740+1548 Diamonds", mmk: 193000, thb: 1490, code: "MLBB_7740+1548", icon: "assets/mlbb/icons/cheset5.webp" }
  ]
};

document.addEventListener("DOMContentLoaded", () => {
  const packageContainer = document.getElementById("packages");
  if (!packageContainer) return;

  const game = packageContainer.dataset.game;
  const region = localStorage.getItem("region") || "MM";
  const currencySymbol = region === "TH" ? "฿" : "Ks";

  const packages = GAME_PRICES[game];

  if (!packages || !packages.length) {
    packageContainer.innerHTML = `<p style="color:#aaa;">No packages available.</p>`;
    return;
  }

  packageContainer.innerHTML = "";
  packages.forEach(item => {
    const price = region === "TH" ? item.thb : item.mmk;

    packageContainer.innerHTML += `
      <div class="pack" data-name="${item.name}" data-price="${price}" data-code="${item.code}">
    <div class="pack-icon">
        <img src="${item.icon || "assets/mlbb/icons/small.webp"}" alt="${item.name}">
    </div>

    <div class="pack-info">
        <strong class="pack-name">${item.name}</strong>
        <span class="pack-price">
            ${Number(price).toLocaleString()} ${currencySymbol}
        </span>
    </div>
   </div>
    `;
  });
});

window.GAME_PRICES = GAME_PRICES;