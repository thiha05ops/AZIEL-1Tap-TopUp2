// frontend/js/telegram.js
// Thin Telegram product page configuration for the shared AZIEL game flow.

window.AZIEL_GAME_FLOW?.init({
    game: "Telegram Top Up",
    gameKey: "telegram",
    userIdSelector: "#userId",
    zoneIdSelector: "",
    zoneRequired: false,
    userIdRequiredMessage: "Please enter your Telegram username or phone number.",
    pendingReturnUrl: "telegram.html"
});
