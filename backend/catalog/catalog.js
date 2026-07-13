const REGION_PRICES = {
    MM: "MMK",
    TH: "THB"
};

function prices(mmk, thb) {
    return {
        MM: { currency: REGION_PRICES.MM, amount: mmk },
        TH: { currency: REGION_PRICES.TH, amount: thb }
    };
}

const products = [
    {
        productCode: "mlbb",
        name: "Mobile Legends",
        enabled: true,
        aliases: ["mobile legends", "mobile legends mlbb", "mlbb"],
        packages: [
            { packageCode: "MLBB_WEEKLY_1X", name: "Weekly Pass 1x", enabled: true, prices: prices(6800, 55) },
            { packageCode: "MLBB_13_1", name: "13+1 Diamonds", enabled: true, prices: prices(1100, 10) },
            { packageCode: "MLBB_22", name: "22 Diamonds", enabled: true, prices: prices(1800, 12) },
            { packageCode: "MLBB_42", name: "42 Diamonds", enabled: true, prices: prices(3456, 27) },
            { packageCode: "MLBB_56", name: "56 Diamonds", enabled: true, prices: prices(3750, 30) },
            { packageCode: "MLBB_86", name: "86 Diamonds", enabled: true, prices: prices(5700, 45) },
            { packageCode: "MLBB_112", name: "112 Diamonds", enabled: true, prices: prices(7200, 56) },
            { packageCode: "MLBB_172", name: "172 Diamonds", enabled: true, prices: prices(12400, 88) },
            { packageCode: "MLBB_284", name: "284 Diamonds", enabled: true, prices: prices(22000, 162) },
            { packageCode: "MLBB_344", name: "344 Diamonds", enabled: true, prices: prices(22800, 170) },
            { packageCode: "MLBB_570", name: "570 Diamonds", enabled: true, prices: prices(35000, 274) },
            { packageCode: "MLBB_716", name: "716 Diamonds", enabled: true, prices: prices(51000, 340) },
            { packageCode: "MLBB_1163", name: "1163 Diamonds", enabled: true, prices: prices(70500, 545) },
            { packageCode: "MLBB_1160_186", name: "1160+186 Diamonds", enabled: true, prices: prices(84500, 652) },
            { packageCode: "MLBB_1360_335", name: "1360+335 Diamonds", enabled: true, prices: prices(138500, 989) },
            { packageCode: "MLBB_2015_475", name: "2015+475 Diamonds", enabled: true, prices: prices(193000, 1490) },
            { packageCode: "MLBB_5000_1000", name: "5000+1000 Diamonds", enabled: true, prices: prices(193000, 1490) },
            { packageCode: "MLBB_7740_1548", name: "7740+1548 Diamonds", enabled: true, prices: prices(193000, 1490) }
        ]
    },
    {
        productCode: "pubg",
        name: "PUBG Mobile",
        enabled: true,
        aliases: ["pubg", "pubg mobile", "pubg mobile uc"],
        packages: [
            { packageCode: "PUBG_60_UC", name: "60 UC", enabled: true, prices: prices(3910, 30.31) },
            { packageCode: "PUBG_300_25_UC", name: "300 + 25 UC", enabled: true, prices: prices(19273, 149.40) },
            { packageCode: "PUBG_600_60_UC", name: "600 + 60 UC", enabled: true, prices: prices(38585, 299.11) },
            { packageCode: "PUBG_1500_300_UC", name: "1500 + 300 UC", enabled: true, prices: prices(95566, 740.82) },
            { packageCode: "PUBG_3000_850_UC", name: "3000 + 850 UC", enabled: true, prices: prices(193081, 1496.75) },
            { packageCode: "PUBG_6000_2100_UC", name: "6000 + 2100 UC", enabled: true, prices: prices(386200, 2993.80) },
            { packageCode: "PUBG_12000_4200_UC", name: "12000 + 4200 UC", enabled: true, prices: prices(772439, 5987.90) },
            { packageCode: "PUBG_18000_6300_UC", name: "18000 + 6300 UC", enabled: true, prices: prices(1158678, 8982.00) },
            { packageCode: "PUBG_24000_8400_UC", name: "24000 + 8400 UC", enabled: true, prices: prices(1579635, 12245.23) },
            { packageCode: "PUBG_30000_10500_UC", name: "30000 + 10500 UC", enabled: true, prices: prices(1931156, 14970.20) }
        ]
    },
    {
        productCode: "freefire",
        name: "Free Fire",
        enabled: true,
        aliases: ["free fire", "freefire", "free fire diamonds"],
        packages: [
            { packageCode: "FF_100_DIA", name: "100 Diamonds", enabled: true, prices: prices(4279, 33.17) },
            { packageCode: "FF_210_DIA", name: "210 Diamonds", enabled: true, prices: prices(8560, 66.36) },
            { packageCode: "FF_310_DIA", name: "310 Diamonds", enabled: true, prices: prices(11642, 90.25) },
            { packageCode: "FF_520_DIA", name: "520 Diamonds", enabled: true, prices: prices(17883, 138.63) },
            { packageCode: "FF_530_DIA", name: "530 Diamonds", enabled: true, prices: prices(21399, 165.88) },
            { packageCode: "FF_1060_DIA", name: "1,060 Diamonds", enabled: true, prices: prices(35613, 276.07) },
            { packageCode: "FF_1080_DIA", name: "1080 Diamonds", enabled: true, prices: prices(42797, 331.76) },
            { packageCode: "FF_2180_DIA", name: "2,180 Diamonds", enabled: true, prices: prices(72997, 565.87) }
        ]
    },
    {
        productCode: "pubgrp",
        name: "PUBG Mobile Royale Pass Pack",
        enabled: true,
        aliases: ["pubgrp", "pubg-rp", "pubg royale pass", "pubg mobile royale pass pack"],
        packages: [
            { packageCode: "PUBGRP_ELITE_1_100", name: "Elite Pass (LV1-100)", enabled: true, prices: prices(46364, 359.41) },
            { packageCode: "PUBGRP_ELITE_PLUS_1_100", name: "Elite Pass Plus (LV1-100)", enabled: true, prices: prices(115967, 898.97) },
            { packageCode: "PUBGRP_ELITE_1_50", name: "Elite Pass (LV1-50)", enabled: true, prices: prices(23162, 179.55) },
            { packageCode: "PUBGRP_WEEKLY_MYTHIC", name: "Weekly Mythic Emblem Value Pack", enabled: true, prices: prices(14307, 110.91) },
            { packageCode: "PUBGRP_MYTHIC_EMBLEM", name: "Mythic Emblem Pack", enabled: true, prices: prices(19119, 148.21) },
            { packageCode: "PUBGRP_WEEKLY_DEAL_1", name: "Weekly Deal Pack 1", enabled: true, prices: prices(3913, 30.33) },
            { packageCode: "PUBGRP_WEEKLY_DEAL_2", name: "Weekly Deal Pack 2", enabled: true, prices: prices(11819, 91.62) },
            { packageCode: "PUBGRP_PRIME_1M", name: "Prime (1 Month)", enabled: true, prices: prices(3824, 29.64) },
            { packageCode: "PUBGRP_PRIME_3M", name: "Prime (3 Months)", enabled: true, prices: prices(11557, 89.59) },
            { packageCode: "PUBGRP_PRIME_6M", name: "Prime (6 Months)", enabled: true, prices: prices(23158, 179.52) },
            { packageCode: "PUBGRP_PRIME_12M", name: "Prime (12 Months)", enabled: true, prices: prices(46359, 359.37) },
            { packageCode: "PUBGRP_PRIME_PLUS_1M", name: "Prime Plus (1 Month)", enabled: true, prices: prices(38625, 299.42) },
            { packageCode: "PUBGRP_PRIME_PLUS_3M", name: "Prime Plus (3 Months)", enabled: true, prices: prices(115962, 898.93) },
            { packageCode: "PUBGRP_PRIME_PLUS_6M", name: "Prime Plus (6 Months)", enabled: true, prices: prices(231968, 1798.20) },
            { packageCode: "PUBGRP_PRIME_PLUS_12M", name: "Prime Plus (12 Months)", enabled: true, prices: prices(463979, 3596.74) },
            { packageCode: "PUBGRP_FIREARM_MATERIALS", name: "Upgradable Firearm Materials Pack", enabled: true, prices: prices(11557, 89.59) },
            { packageCode: "PUBGRP_FIRST_PURCHASE", name: "First Purchase Pack", enabled: true, prices: prices(3824, 29.64) }
        ]
    },
    {
        productCode: "hok",
        name: "Honor of Kings",
        enabled: true,
        aliases: ["hok", "honor of kings", "honor of kings tokens"],
        packages: [
            { packageCode: "HOK_WEEKLY_CARD", name: "Weekly Card", enabled: true, prices: prices(4337, 33.62) },
            { packageCode: "HOK_WEEKLY_CARD_PLUS", name: "Weekly Card Plus", enabled: true, prices: prices(12798, 99.21) },
            { packageCode: "HOK_16_TOKENS", name: "16 Tokens", enabled: true, prices: prices(832, 6.45) },
            { packageCode: "HOK_80_TOKENS", name: "80 Tokens", enabled: true, prices: prices(3817, 29.59) },
            { packageCode: "HOK_240_TOKENS", name: "240 Tokens", enabled: true, prices: prices(11531, 89.39) },
            { packageCode: "HOK_400_TOKENS", name: "400 Tokens", enabled: true, prices: prices(19246, 149.19) },
            { packageCode: "HOK_560_TOKENS", name: "560 Tokens", enabled: true, prices: prices(26958, 208.98) },
            { packageCode: "HOK_800_30_TOKENS", name: "800 + 30 Tokens", enabled: true, prices: prices(38530, 298.68) },
            { packageCode: "HOK_1200_45_TOKENS", name: "1200 + 45 Tokens", enabled: true, prices: prices(57814, 448.17) }
        ]
    },
    {
        productCode: "aovid",
        name: "Arena of Valor (ID)",
        enabled: true,
        aliases: ["aovid", "aov-id", "arena of valor", "arena of valor (id)", "arena of valor id"],
        packages: [
            { packageCode: "AOVID_40", name: "40 Vouchers", enabled: true, prices: prices(2414, 18.71) },
            { packageCode: "AOVID_90", name: "90 Vouchers", enabled: true, prices: prices(4826, 37.41) },
            { packageCode: "AOVID_230", name: "230 Vouchers", enabled: true, prices: prices(12067, 93.54) },
            { packageCode: "AOVID_470", name: "470 Vouchers", enabled: true, prices: prices(24132, 187.07) },
            { packageCode: "AOVID_950", name: "950 Vouchers", enabled: true, prices: prices(48265, 374.15) },
            { packageCode: "AOVID_1430", name: "1430 Vouchers", enabled: true, prices: prices(72397, 561.22) },
            { packageCode: "AOVID_2390", name: "2390 Vouchers", enabled: true, prices: prices(120663, 935.37) },
            { packageCode: "AOVID_4800", name: "4800 Vouchers", enabled: true, prices: prices(241325, 1870.74) },
            { packageCode: "AOVID_24050", name: "24050 Vouchers", enabled: true, prices: prices(1206627, 9353.70) },
            { packageCode: "AOVID_48200", name: "48200 Vouchers", enabled: true, prices: prices(2413255, 18707.40) }
        ]
    },
    {
        productCode: "telegram",
        name: "Telegram Top Up",
        enabled: true,
        aliases: ["telegram", "telegram top up", "telegram stars", "telegram premium"],
        packages: [
            { packageCode: "TG_50_STARS", name: "50 Stars", enabled: true, prices: prices(3433, 26.61) },
            { packageCode: "TG_75_STARS", name: "75 Stars", enabled: true, prices: prices(5195, 40.27) },
            { packageCode: "TG_100_STARS", name: "100 Stars", enabled: true, prices: prices(6864, 53.21) },
            { packageCode: "TG_150_STARS", name: "150 Stars", enabled: true, prices: prices(10295, 79.81) },
            { packageCode: "TG_250_STARS", name: "250 Stars", enabled: true, prices: prices(17192, 133.27) },
            { packageCode: "TG_350_STARS", name: "350 Stars", enabled: true, prices: prices(24087, 186.72) },
            { packageCode: "TG_500_STARS", name: "500 Stars", enabled: true, prices: prices(34384, 266.54) },
            { packageCode: "TG_750_STARS", name: "750 Stars", enabled: true, prices: prices(51574, 399.80) },
            { packageCode: "TG_1000_STARS", name: "1000 Stars", enabled: true, prices: prices(68766, 533.07) },
            { packageCode: "TG_1500_STARS", name: "1500 Stars", enabled: true, prices: prices(103117, 799.36) },
            { packageCode: "TG_2500_STARS", name: "2500 Stars", enabled: true, prices: prices(171853, 1332.19) },
            { packageCode: "TG_5000_STARS", name: "5000 Stars", enabled: true, prices: prices(343737, 2664.63) },
            { packageCode: "TG_10000_STARS", name: "10000 Stars", enabled: true, prices: prices(687472, 5329.24) },
            { packageCode: "TG_PREMIUM_3M", name: "Premium 3 Months", enabled: true, prices: prices(54945, 425.93) },
            { packageCode: "TG_PREMIUM_6M", name: "Premium 6 Months", enabled: true, prices: prices(73280, 568.06) },
            { packageCode: "TG_PREMIUM_12M", name: "Premium 12 Months", enabled: true, prices: prices(132864, 1029.95) }
        ]
    },
    {
        productCode: "genshin",
        name: "Genshin Impact",
        enabled: false,
        aliases: ["genshin", "genshin impact"],
        packages: []
    },
    {
        productCode: "roblox",
        name: "Roblox",
        enabled: false,
        aliases: ["roblox", "roblox robux"],
        packages: []
    },
    {
        productCode: "valorant",
        name: "Valorant",
        enabled: false,
        aliases: ["valorant"],
        packages: []
    }
];

module.exports = {
    products,
    supportedRegions: Object.keys(REGION_PRICES),
    regionCurrencies: REGION_PRICES
};
