// frontend/js/genshin.js
// Thin Genshin Impact page configuration for the shared AZIEL game flow.

window.AZIEL_GAME_FLOW?.init({
    game: "Genshin Impact",
    gameKey: "genshin",
    userIdSelector: "#userId",
    zoneIdSelector: "#serverId",
    zoneRequired: true,
    userIdRequiredMessage: "Please enter your Genshin UID.",
    zoneRequiredMessage: "Please select your Genshin server.",
    pendingReturnUrl: "genshin.html"
});
