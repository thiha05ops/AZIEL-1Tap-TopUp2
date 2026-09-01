"use strict";

const OBSERVED_AT = "2026-08-30T00:00:00.000Z";

const products = Object.freeze({
    fazerMlbb: { supplierCode: "FAZERCARDS", catalogNamespace: "TOPUP", supplierProductCode: "mobile_legends_global", supplierMarketCode: "GLOBAL", displayName: "Mobile Legends (Global)" },
    fazerPubg: { supplierCode: "FAZERCARDS", catalogNamespace: "TOPUP", supplierProductCode: "pubg_mobile_auto", supplierMarketCode: "GLOBAL", displayName: "PUBG Mobile (Auto)" },
    fazerFreefire: { supplierCode: "FAZERCARDS", catalogNamespace: "TOPUP", supplierProductCode: "free_fire_th", supplierMarketCode: "TH", displayName: "Free Fire (TH)" },
    fazerHok: { supplierCode: "FAZERCARDS", catalogNamespace: "TOPUP", supplierProductCode: "honor_of_kings", supplierMarketCode: "UNSPECIFIED", displayName: "Honor of Kings" },
    fazerValorant: { supplierCode: "FAZERCARDS", catalogNamespace: "TOPUP", supplierProductCode: "valorant_th", supplierMarketCode: "TH", displayName: "Valorant (TH)" },
    wonddMlbb: { supplierCode: "WONDD", catalogNamespace: "TOPUP", supplierProductCode: "9622", supplierMarketCode: "UNSPECIFIED", displayName: "Mobile Legends: Bang Bang", metadata: { serviceCode: "mlbb", supplierCurrency: "THB", legacyMappingRegion: "TH" } }
});

const offers = Object.freeze({
    mlbbOrdinary: { supplierProductCode: "mobile_legends_global", supplierOfferCode: "42_diamonds", name: "42 Diamonds", price: { amount: 0.7, currency: "USD", observedAt: OBSERVED_AT }, semantics: { currencyType: "DIAMONDS", baseAmount: 42, bonusAmount: 0, displayTotal: 42 } },
    mlbbBonus: { supplierProductCode: "mobile_legends_global", supplierOfferCode: "78_8_diamonds", name: "78 + 8 Diamonds", price: { amount: 1.1668, currency: "USD", observedAt: OBSERVED_AT }, semantics: { currencyType: "DIAMONDS", baseAmount: 78, bonusAmount: 8, displayTotal: 86 } },
    mlbbFlat: { supplierProductCode: "mobile_legends_global", supplierOfferCode: "86_diamonds", name: "86 Diamonds", price: { amount: 1.2, currency: "USD", observedAt: OBSERVED_AT }, semantics: { currencyType: "DIAMONDS", baseAmount: 86, bonusAmount: 0, displayTotal: 86 } },
    weeklyPass: { supplierProductCode: "mobile_legends_global", supplierOfferCode: "weekly_pass", name: "Weekly Pass", price: { amount: 1.4456, currency: "USD", observedAt: OBSERVED_AT }, semantics: { passType: "WEEKLY_PASS", repeatability: "REPEATABLE", subscriptionDuration: "P7D" } },
    oneTimeWeekly: { supplierProductCode: "9622", supplierOfferCode: "MLOTW01", name: "One Time Weekly", price: { amount: 49, currency: "THB", observedAt: OBSERVED_AT }, semantics: { passType: "ONE_TIME_WEEKLY_PASS", repeatability: "ONE_TIME", subscriptionDuration: "P7D" } }
});

module.exports = Object.freeze({ OBSERVED_AT, products, offers });
