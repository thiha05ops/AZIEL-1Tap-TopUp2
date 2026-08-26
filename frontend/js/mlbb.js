// frontend/js/mlbb.js
// Thin Mobile Legends page configuration for the shared AZIEL game flow.

const requestedProduct = new URLSearchParams(window.location.search).get("product");
const isPassProduct = requestedProduct === "mlbb-twilight-weekly-pass";
const productCode = isPassProduct ? requestedProduct : "mlbb";
const productName = isPassProduct
    ? "Mobile Legends Twilight Pass & Weekly Diamonds"
    : "Mobile Legends Diamonds";

document.querySelectorAll("[data-mlbb-product-name]").forEach(node => { node.textContent = productName; });
document.querySelectorAll("[data-mlbb-package-instruction]").forEach(node => {
    node.textContent = isPassProduct ? "Select your Weekly Diamonds or Twilight Pass package." : "Select your diamond package.";
});
document.querySelector("#packages")?.setAttribute("data-game", productCode);
document.title = `${productName} | AZIEL 1Tap Shop`;

window.AZIEL_GAME_FLOW?.init({
    game: productName,
    gameKey: productCode,
    productCode,
    userIdSelector: "#userId",
    zoneIdSelector: "#serverId",
    zoneRequired: true,
    accountFields: window.AZIEL_GAME_INPUT_CONTRACTS?.forProduct(productCode)?.accountFields,
    userIdRequiredMessage: "Please enter your MLBB User ID.",
    zoneRequiredMessage: "Please enter your Zone ID.",
    pendingReturnUrl: isPassProduct ? "mlbb.html?product=mlbb-twilight-weekly-pass" : "mlbb.html"
});
