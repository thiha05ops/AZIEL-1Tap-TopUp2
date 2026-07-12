// frontend/js/mlbb.js
// Thin Mobile Legends page configuration for the shared AZIEL game flow.

window.AZIEL_GAME_FLOW?.init({
    game: "Mobile Legends",
    gameKey: "mlbb",
    userIdSelector: "#userId",
    zoneIdSelector: "#serverId",
    zoneRequired: true,
    userIdRequiredMessage: "Please enter your MLBB User ID.",
    zoneRequiredMessage: "Please enter your Server ID.",
    pendingReturnUrl: "mlbb.html"
});
