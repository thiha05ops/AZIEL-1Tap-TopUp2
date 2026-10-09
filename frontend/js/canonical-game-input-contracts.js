(function () {
    "use strict";
    const family = Object.freeze({ mlbb: "MLBB", "mlbb-twilight-weekly-pass": "MLBB", freefire: "FREEFIRE", "freefire-pass-membership": "FREEFIRE", pubg: "PUBG", pubgrp: "PUBG", hok: "HOK", "hok-pass-cards": "HOK", valorant: "VALORANT" });
    const fields = Object.freeze({
        MLBB: Object.freeze([
            { key: "userId", label: "MLBB User ID", selector: "#userId", required: true, requiredMessage: "Please enter your MLBB User ID." },
            { key: "zoneId", label: "Zone ID", selector: "#serverId", required: true, requiredMessage: "Please enter your Zone ID." }
        ]),
        FREEFIRE: Object.freeze([{ key: "userId", label: "User ID", selector: "#userId", required: true, requiredMessage: "Please enter your User ID." }]),
        PUBG: Object.freeze([{ key: "userId", label: "PUBG Player ID", selector: "#userId", required: true, requiredMessage: "Please enter your PUBG Player ID." }]),
        HOK: Object.freeze([{ key: "userId", label: "Honor of Kings Player ID", selector: "#userId", required: true, requiredMessage: "Please enter your Honor of Kings Player ID." }]),
        VALORANT: Object.freeze([{ key: "riotId", label: "Riot ID", selector: "#userId", required: true, requiredMessage: "Please enter your Riot ID (Name#TAG)." }])
    });
    function forProduct(productCode) { const gameFamily = family[String(productCode || "").trim().toLowerCase()]; return gameFamily ? { gameFamily, accountFields: fields[gameFamily].map(item => ({ ...item })) } : null; }
    window.AZIEL_GAME_INPUT_CONTRACTS = Object.freeze({ forProduct });
})();
