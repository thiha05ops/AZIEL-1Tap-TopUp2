// frontend/js/pubg.js
// Thin PUBG page configuration for the shared AZIEL game flow.

window.AZIEL_GAME_FLOW?.init({
    game: "PUBG Mobile",
    gameKey: "pubg",
    userIdSelector: "#userId",
    zoneIdSelector: "",
    zoneRequired: false,
    accountFields: window.AZIEL_GAME_INPUT_CONTRACTS?.forProduct("pubg")?.accountFields,
    directWallet: true,
    pendingReturnUrl: "pubg.html"
});
