// frontend/js/mlbb.js
// Thin Mobile Legends page configuration for the shared AZIEL game flow.

window.AZIEL_GAME_FLOW?.init({
    game: "Mobile Legends",
    gameKey: "mlbb",
    userIdSelector: "#userId",
    zoneIdSelector: "#serverId",
    zoneRequired: true,
    accountFields: [
        { key: "userId", label: "MLBB User ID", selector: "#userId", required: true, requiredMessage: "Please enter your MLBB User ID." },
        { key: "zoneId", label: "Server ID", selector: "#serverId", required: true, requiredMessage: "Please enter your Server ID." }
    ],
    userIdRequiredMessage: "Please enter your MLBB User ID.",
    zoneRequiredMessage: "Please enter your Server ID.",
    pendingReturnUrl: "mlbb.html"
});
