"use strict";

const DEFINITIONS = Object.freeze({
    mlbb: [family("DIAMONDS", "Diamonds", 10), family("FIRST_TOP_UP", "First Top-Up", 20), family("OTHER_SPECIAL", "Other / Special", 90)],
    "mlbb-twilight-weekly-pass": [family("WEEKLY_PASS", "Weekly Diamonds", 10), family("TWILIGHT_PASS", "Twilight Pass", 20), family("OTHER_SPECIAL", "Other / Special", 90)],
    pubg: [family("UC", "UC", 10), family("ROYALE_PASS", "Royale Pass", 20), family("OTHER_SPECIAL", "Other / Special", 90)],
    pubgrp: [family("ROYALE_PASS", "Royale Pass", 10), family("OTHER_SPECIAL", "Other / Special", 90)],
    freefire: [family("DIAMONDS", "Diamonds", 10), family("OTHER_SPECIAL", "Other / Special", 90)],
    "freefire-pass-membership": [family("LEVEL_UP_PASS", "Level Up Pass", 10), family("BP_CARD", "BP Card", 20), family("MEMBERSHIP", "Membership", 30), family("OTHER_SPECIAL", "Other / Special", 90)],
    hok: [family("TOKENS", "Tokens", 10), family("OTHER_SPECIAL", "Other / Special", 90)],
    "hok-pass-cards": [family("CARDS_PASSES", "Cards / Passes", 10), family("OTHER_SPECIAL", "Other / Special", 90)],
    telegram: [family("STARS_TOP_UP", "Top Up · Stars", 10), family("PREMIUM", "Premium", 20), family("OTHER_SPECIAL", "Other / Special", 90)],
    valorant: [family("VALORANT_POINTS", "Valorant Points", 10), family("OTHER_SPECIAL", "Other / Special", 90)]
});
function family(code, name, sortOrder, parentCode = "") { return Object.freeze({ code, name, sortOrder, parentCode }); }
const clean = value => String(value == null ? "" : value).trim();
function canonicalFamily(productCode, packageName) {
    const product = clean(productCode).toLowerCase(); const name = clean(packageName);
    let code = "OTHER_SPECIAL";
    if (product === "mlbb") code = /first top-up/i.test(name) ? "FIRST_TOP_UP" : /weekly pass/i.test(name) ? "WEEKLY_PASS" : /twilight/i.test(name) ? "TWILIGHT_PASS" : /diamond/i.test(name) ? "DIAMONDS" : code;
    else if (product === "mlbb-twilight-weekly-pass") code = /twilight/i.test(name) ? "TWILIGHT_PASS" : /weekly pass/i.test(name) ? "WEEKLY_PASS" : code;
    else if (product === "pubg") code = /royale pass/i.test(name) ? "ROYALE_PASS" : /\buc\b/i.test(name) ? "UC" : code;
    else if (product === "pubgrp") code = "ROYALE_PASS";
    else if (product === "freefire") code = /diamonds?/i.test(name) ? "DIAMONDS" : code;
    else if (product === "freefire-pass-membership") code = /level \d+ up pass/i.test(name) ? "LEVEL_UP_PASS" : /^bp card$/i.test(name) ? "BP_CARD" : /membership/i.test(name) ? "MEMBERSHIP" : code;
    else if (product === "hok") code = /tokens?/i.test(name) ? "TOKENS" : code;
    else if (product === "hok-pass-cards") code = /card|pass/i.test(name) ? "CARDS_PASSES" : code;
    else if (product === "telegram") code = /stars?/i.test(name) ? "STARS_TOP_UP" : /premium/i.test(name) ? "PREMIUM" : code;
    else if (product === "valorant") code = /point|\bvp\b/i.test(name) ? "VALORANT_POINTS" : code;
    return (DEFINITIONS[product] || [family("OTHER_SPECIAL", "Other / Special", 90)]).find(item => item.code === code);
}
function familyDefinitions(productCode) { return DEFINITIONS[clean(productCode).toLowerCase()] || [family("OTHER_SPECIAL", "Other / Special", 90)]; }
function validateFamily(productCode, value = {}) { const match = familyDefinitions(productCode).find(item => item.code === clean(value.code).toUpperCase()); if (!match) throw Object.assign(new Error("Package family is not valid for this product."), { code: "CATALOG_PACKAGE_FAMILY_INVALID" }); return match; }
module.exports = { DEFINITIONS, canonicalFamily, familyDefinitions, validateFamily };
