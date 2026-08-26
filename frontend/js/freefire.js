// frontend/js/freefire.js
// Thin Free Fire page configuration for the shared AZIEL game flow.

const requestedProduct = new URLSearchParams(window.location.search).get("product");
const isPassProduct = requestedProduct === "freefire-pass-membership";
const productCode = isPassProduct ? requestedProduct : "freefire";
const productName = isPassProduct ? "Free Fire Pass & Membership" : "Free Fire Diamonds";

document.querySelectorAll("[data-freefire-product-name]").forEach(node => { node.textContent = productName; });
document.querySelectorAll("[data-freefire-package-instruction]").forEach(node => {
    node.textContent = isPassProduct ? "Select your pass, BP Card, or membership package." : "Select your diamond package.";
});
document.querySelector("#packages")?.setAttribute("data-game", productCode);
document.title = `${productName} | AZIEL 1Tap Shop`;

window.AZIEL_GAME_FLOW?.init({
    game: productName,
    gameKey: productCode,
    productCode,
    userIdSelector: "#userId",
    zoneIdSelector: "",
    zoneRequired: false,
    accountFields: window.AZIEL_GAME_INPUT_CONTRACTS?.forProduct(productCode)?.accountFields,
    userIdRequiredMessage: "Please enter your User ID.",
    pendingReturnUrl: isPassProduct ? "freefire.html?product=freefire-pass-membership" : "freefire.html"
});
