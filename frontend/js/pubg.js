// frontend/js/pubg.js
// Thin PUBG page configuration for the shared AZIEL game flow.

window.AZIEL_GAME_FLOW?.init({
    game: "PUBG Mobile",
    gameKey: "pubg",
    userIdSelector: "#userId",
    zoneIdSelector: "",
    zoneRequired: false,
    accountFields: [
        { key: "userId", label: "PUBG Player ID", selector: "#userId", required: true, requiredMessage: "Please enter your PUBG Player ID." }
    ],
    directWallet: true,
    pendingReturnUrl: "pubg.html"
});
