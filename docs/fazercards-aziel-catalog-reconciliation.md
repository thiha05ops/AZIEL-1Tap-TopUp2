# FazerCards ↔ AZIEL catalog reconciliation

Generated: 2026-08-25T14:40:56.614Z

> Documentation-only reconciliation. No order, validation POST, WonDD top-up, price publication, fulfillment gate, or storefront mutation occurred.

## Summary

| Metric | Value |
|---|---|
| azielProductsReviewed | 16 |
| fazerCardsCategoriesReviewed | 44 |
| exactProductMatches | 8 |
| exactCategoryMatches | 11 |
| regionalVariants | 24 |
| exactPackageMatches | 61 |
| newPackageCandidates | 585 |
| ambiguousPackages | 85 |
| inputCompatibleProducts | 3 |
| productsRequiringInputChanges | 8 |
| fazerCardsPreferred | 1 |
| wonddPreferred | 0 |
| needsReview | 0 |

## Priority queue

| Priority | Products | Reason |
|---|---|---|
| A | PUBG Mobile | Six exact disabled mappings, compatible Player ID input, pricing preview and adapter ready. |
| A | Free Fire, Mobile Legends | Existing canonical products and automatic provider variants; reconcile exact packages and regional restrictions product-by-product. |
| B | Honor of Kings, Blood Strike, Marvel Rivals, LifeAfter, Magic Chess Go Go, CapCut | Canonical products exist, but package semantics and/or generic input surfaces require cleanup. |
| B | Valorant, Genshin Impact | Provider family overlap exists but neither is in the current closed canonical operational registry. |
| C |  | Strong provider evidence; deliberately not onboarded in this phase. |
| D |  | Password/login-based categories are unsuitable. |

## Product / region / input matrix

| Product | Region | Category | Identity | Provider fields | AZIEL fields | Compatible | Required change |
|---|---|---|---|---|---|---|---|
| Mobile Legends | BR | mobile_legends_brazil | REGIONAL_VARIANT | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | UNKNOWN | mobile_legends_exclusive | EXACT_MATCH | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | Global | mobile_legends_global | EXACT_MATCH | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | ID | mobile_legends_indonesia | REGIONAL_VARIANT | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | MY | mobile_legends_malaysia | REGIONAL_VARIANT | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | PH | mobile_legends_philippines | REGIONAL_VARIANT | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | UNKNOWN | mobile_legends_promo | EXACT_MATCH | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | RU | mobile_legends_ru | REGIONAL_VARIANT | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | SG | mobile_legends_singapore | REGIONAL_VARIANT | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | UNKNOWN | mobile_legends_special | EXACT_MATCH | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | TR | mobile_legends_turkey | REGIONAL_VARIANT | player_id, zone_id | userId, zoneId | YES | NONE |
| Mobile Legends | US | mobile_legends_united_states | REGIONAL_VARIANT | player_id, zone_id | userId, zoneId | YES | NONE |
| PUBG Mobile | Global | pubg_mobile_auto | EXACT_MATCH | player_id | userId | YES | NONE |
| PUBG Mobile | Global | pubg_mobile_fast | RELATED_BUT_DIFFERENT | player_id | userId | YES | NONE |
| PUBG Mobile | Global | pubg_mobile_manual | RELATED_BUT_DIFFERENT | player_id | userId | YES | NONE |
| PUBG Mobile | Global | pubg_mobile_reserve | RELATED_BUT_DIFFERENT | player_id | userId | YES | NONE |
| Free Fire | Bangladesh | free_fire_bd | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | Brazil | free_fire_br | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | CIS | free_fire_cis | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | Europe | free_fire_eu | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | Indonesia | free_fire_id | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | LATAM | free_fire_latam | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | MENA | free_fire_mena | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | Malaysia/Singapore | free_fire_my_sg | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | Philippines | free_fire_ph | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | Pakistan | free_fire_pk | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | Singapore | free_fire_sg | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | Thailand | free_fire_th | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | Taiwan | free_fire_tw | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Free Fire | Vietnam | free_fire_vn | REGIONAL_VARIANT | player_id | userId | YES | NONE |
| Honor of Kings | UNKNOWN | honor_of_kings | EXACT_MATCH | UNKNOWN | userId | NO | PROVIDER_INPUT_CONTRACT_REQUIRED |
| Valorant | Indonesia | valorant_id | AMBIGUOUS | UNKNOWN | NONE | NO | CANONICAL_PRODUCT_AUTHORITY_REQUIRED |
| Valorant | Philippines | valorant_ph | AMBIGUOUS | UNKNOWN | NONE | NO | CANONICAL_PRODUCT_AUTHORITY_REQUIRED |
| Valorant | Singapore | valorant_sg | AMBIGUOUS | UNKNOWN | NONE | NO | CANONICAL_PRODUCT_AUTHORITY_REQUIRED |
| Valorant | Thailand | valorant_th | AMBIGUOUS | UNKNOWN | NONE | NO | CANONICAL_PRODUCT_AUTHORITY_REQUIRED |
| Valorant | Vietnam | valorant_vn | AMBIGUOUS | UNKNOWN | NONE | NO | CANONICAL_PRODUCT_AUTHORITY_REQUIRED |
| Genshin Impact | Global | genshin_impact_global | AMBIGUOUS | UNKNOWN | NONE | NO | CANONICAL_PRODUCT_AUTHORITY_REQUIRED |
| Blood Strike | Global | blood_strike | EXACT_MATCH | UNKNOWN | userId | NO | PROVIDER_INPUT_CONTRACT_REQUIRED |
| Blood Strike | MENA | blood_strike_mena | REGIONAL_VARIANT | UNKNOWN | userId | NO | PROVIDER_INPUT_CONTRACT_REQUIRED |
| Marvel Rivals | UNKNOWN | marvel_rivals | EXACT_MATCH | UNKNOWN | userId | NO | PROVIDER_INPUT_CONTRACT_REQUIRED |
| LifeAfter | UNKNOWN | lifeafter | EXACT_MATCH | UNKNOWN | userId | NO | PROVIDER_INPUT_CONTRACT_REQUIRED |
| Magic Chess Go Go | Global | magic_chess_gogo_global | EXACT_MATCH | player_id, zone_id | userId | NO | PRODUCT_SPECIFIC_INPUT_SCHEMA_REQUIRED |
| Magic Chess Go Go | Russia | magic_chess_gogo_ru | REGIONAL_VARIANT | player_id, zone_id | userId | NO | PRODUCT_SPECIFIC_INPUT_SCHEMA_REQUIRED |
| CapCut | UNKNOWN | capcut | EXACT_MATCH | UNKNOWN | userId | NO | PROVIDER_INPUT_CONTRACT_REQUIRED |

## Supplier comparison

| AZIEL package | WonDD THB | Fazer USD | Fazer landed THB | Selling THB | Recommendation |
|---|---|---|---|---|---|
| pubg/PUBG_60_UC | 37.17 | 0.8874 | 29.745648 | 32.31 | FAZERCARDS_PREFERRED |
| pubg/PUBG_FAZER_325_UC | - | 4.4421 | 148.899192 | - | ONLY_FAZERCARDS |
| pubg/PUBG_FAZER_660_UC | - | 8.8697 | 297.312344 | - | ONLY_FAZERCARDS |
| pubg/PUBG_FAZER_1800_UC | - | 22.2105 | 744.49596 | - | ONLY_FAZERCARDS |
| pubg/PUBG_FAZER_3850_UC | - | 44.421 | 1488.99192 | - | ONLY_FAZERCARDS |
| pubg/PUBG_FAZER_8100_UC | - | 88.0051 | 2949.930952 | - | ONLY_FAZERCARDS |

## MLBB special review

Safest catalog candidate for a later controlled validation/test: `mobile_legends_global/5_diamonds` (5 Diamonds, 0.08 USD). This is catalog evidence only; no live validation or top-up was performed. Existing WonDD MLBB authority remains unchanged.

## PUBG state

Six existing FazerCards mappings remain disabled. Controlled test: **DEFERRED_UNTIL_REAL_CUSTOMER**.

## Catalog inconsistencies before rollout

- **CATEGORY — pubg_mobile_fast:** RELATED_BUT_DIFFERENT
- **CATEGORY — pubg_mobile_manual:** RELATED_BUT_DIFFERENT
- **CATEGORY — pubg_mobile_reserve:** RELATED_BUT_DIFFERENT
- **CATEGORY — valorant_id:** AMBIGUOUS
- **CATEGORY — valorant_ph:** AMBIGUOUS
- **CATEGORY — valorant_sg:** AMBIGUOUS
- **CATEGORY — valorant_th:** AMBIGUOUS
- **CATEGORY — valorant_vn:** AMBIGUOUS
- **CATEGORY — genshin_impact_global:** AMBIGUOUS
- **PACKAGE — free_fire_br/evo_access_3d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_br/evo_access_7d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_br/evo_access_30d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_cis/evo_access_3d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_cis/evo_access_7d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_cis/evo_access_30d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_eu/evo_access_3d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_eu/evo_access_7d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_eu/evo_access_30d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_sg/evo_access_3d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_sg/evo_access_7d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_sg/evo_access_30d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_tw/evo_access_3d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_tw/evo_access_7d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_tw/evo_access_30d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_vn/evo_access_3d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_vn/evo_access_7d:** No exact canonical denomination/semantic identity.
- **PACKAGE — free_fire_vn/evo_access_30d:** No exact canonical denomination/semantic identity.
- **PACKAGE — honor_of_kings/double_token_lucky_bag:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/51_bc:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/105_bc:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/320_bc:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/540_bc:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/1100_bc:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/2260_bc:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/5800_bc:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/0_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/0_49_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/1_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/2_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/3_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/4_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/6_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/5_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/7_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/8_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/9_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/ultra_skin_lucky_chest:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/lucky_bag_week:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/enable_cornucopia:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike/bloodstrike_pre_order_item:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/0_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/0_49_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/1_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/2_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/3_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/4_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/5_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/6_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/7_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/8_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/9_99_deal:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/lucky_bag_week:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/ultra_skin_lucky_chest:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/enable_cornucopia:** No exact canonical denomination/semantic identity.
- **PACKAGE — blood_strike_mena/bloodstrike_pre_order_item:** No exact canonical denomination/semantic identity.
- **PACKAGE — marvel_rivals/100_lattices:** No exact canonical denomination/semantic identity.
- **PACKAGE — marvel_rivals/500_lattices:** No exact canonical denomination/semantic identity.
- **PACKAGE — marvel_rivals/1000_lattices:** No exact canonical denomination/semantic identity.
- **PACKAGE — marvel_rivals/2180_lattices:** No exact canonical denomination/semantic identity.
- **PACKAGE — marvel_rivals/5680_lattices:** No exact canonical denomination/semantic identity.
- **PACKAGE — marvel_rivals/11680_lattices:** No exact canonical denomination/semantic identity.
- **PACKAGE — lifeafter/survival_expert_card:** No exact canonical denomination/semantic identity.
- **PACKAGE — lifeafter/trade_vip_card:** No exact canonical denomination/semantic identity.
- **PACKAGE — lifeafter/lifeafter_lucky_star:** No exact canonical denomination/semantic identity.
- **PACKAGE — lifeafter/lifeafter_fund:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_global/first_recharge_100_50_50_bonus:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_global/battle_for_discounts:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_global/lukas_s_battle_bounty:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_global/lancelot_s_limited_time_gift:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_global/first_recharge_300_150_150_bonus:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_global/first_recharge_500_250_250_bonus:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_global/first_recharge_1000_500_500_bonus:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_ru/first_recharge_100_50_50_bonus:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_ru/battle_for_discounts:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_ru/lukas_s_battle_bounty:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_ru/first_recharge_300_150_150_bonus:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_ru/first_recharge_500_250_250_bonus:** No exact canonical denomination/semantic identity.
- **PACKAGE — magic_chess_gogo_ru/first_recharge_1000_500_500_bonus:** No exact canonical denomination/semantic identity.
- **PACKAGE — capcut/1_month_eu_standard:** No exact canonical denomination/semantic identity.
- **PACKAGE — capcut/1_month_uk_standard:** No exact canonical denomination/semantic identity.
- **PACKAGE — capcut/1_month_us_standard:** No exact canonical denomination/semantic identity.
- **PACKAGE — capcut/1_month_eu_pro:** No exact canonical denomination/semantic identity.
- **PACKAGE — capcut/1_month_uk_pro:** No exact canonical denomination/semantic identity.
- **PACKAGE — capcut/1_month_us_pro:** No exact canonical denomination/semantic identity.
- **CANONICAL_REGISTRY — Valorant/Genshin Impact:** Provider overlaps exist, but current AZIEL closed canonical registry has no corresponding product code.

The complete category, offer, restriction, package classification, product, and ambiguity records are in the companion JSON file.
