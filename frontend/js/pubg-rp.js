// frontend/js/pubg-rp.js
// Thin PUBG Royale Pass page configuration for the shared AZIEL game flow.

window.AZIEL_GAME_FLOW?.init({
    game: "PUBG Mobile Royale Pass Pack",
    gameKey: "pubgrp",
    productCode: "pubgrp",
    userIdSelector: "#userId",
    zoneIdSelector: "",
    zoneRequired: false,
    accountFields: window.AZIEL_GAME_INPUT_CONTRACTS?.forProduct("pubgrp")?.accountFields,
    pendingReturnUrl: "/games/pubg-rp"
});
