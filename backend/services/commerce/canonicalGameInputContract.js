"use strict";

const FAMILY_BY_PRODUCT = Object.freeze({
    mlbb: "MLBB",
    "mlbb-twilight-weekly-pass": "MLBB",
    freefire: "FREEFIRE",
    "freefire-pass-membership": "FREEFIRE",
    pubg: "PUBG",
    pubgrp: "PUBG",
    hok: "HOK",
    "hok-pass-cards": "HOK",
    valorant: "VALORANT"
});

const CONTRACTS = Object.freeze({
    MLBB: Object.freeze({ required: Object.freeze(["userId", "zoneId"]), optional: Object.freeze([]) }),
    FREEFIRE: Object.freeze({ required: Object.freeze(["userId"]), optional: Object.freeze([]) }),
    PUBG: Object.freeze({ required: Object.freeze(["userId"]), optional: Object.freeze([]) }),
    HOK: Object.freeze({ required: Object.freeze(["userId"]), optional: Object.freeze([]) }),
    VALORANT: Object.freeze({ required: Object.freeze(["riotId"]), optional: Object.freeze([]) })
});

function gameFamilyForProduct(productCode = "") {
    return FAMILY_BY_PRODUCT[String(productCode || "").trim().toLowerCase()] || "";
}

function inputContractForProduct(productCode = "") {
    const family = gameFamilyForProduct(productCode);
    return family ? { family, ...CONTRACTS[family] } : null;
}

function providerGameCodeForProduct(productCode = "") {
    const family = gameFamilyForProduct(productCode);
    return ({ MLBB: "mlbb", FREEFIRE: "freefire", PUBG: "pubg", HOK: "hok", VALORANT: "valorant" })[family] || "";
}

module.exports = Object.freeze({ CONTRACTS, FAMILY_BY_PRODUCT, gameFamilyForProduct, inputContractForProduct, providerGameCodeForProduct });
