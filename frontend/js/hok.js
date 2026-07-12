// frontend/js/hok.js
// Thin Honor of Kings page configuration for the shared AZIEL game flow.

window.AZIEL_GAME_FLOW?.init({
    game: "Honor of Kings",
    gameKey: "hok",
    userIdSelector: "#userId",
    zoneIdSelector: "",
    zoneRequired: false,
    directWallet: true,
    legacyPaymentPreferred: true,
    pendingReturnUrl: "hok.html"
});
