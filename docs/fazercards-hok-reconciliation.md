# FazerCards Honor of Kings rollout preparation

Generated: 2026-08-26T10:02:59.821Z

FazerCards support confirmed that `honor_of_kings` accepts Thailand accounts when the catalog has no restriction and requires only `player_id`. No provider POST occurred.

## Exact disabled mappings

| Canonical | Category | Offer | Identity | Raw USD | Enabled |
|---|---|---|---|---|---|
| HOK_16_TOKENS | honor_of_kings | 16_tokens | 16 Tokens | 0.1687 | false |
| HOK_80_TOKENS | honor_of_kings | 80_tokens | 80 Tokens | 0.84 | false |
| HOK_240_TOKENS | honor_of_kings | 240_tokens | 240 Tokens | 2.51 | false |
| HOK_400_TOKENS | honor_of_kings | 400_tokens | 400 Tokens | 4.19 | false |
| HOK_560_TOKENS | honor_of_kings | 560_tokens | 560 Tokens | 5.87 | false |
| HOK_830_TOKENS | honor_of_kings | 830_tokens | 830 Tokens | 8.38 | false |
| HOK_1245_TOKENS | honor_of_kings | 1245_tokens | 1245 Tokens | 12.57 | false |
| HOK_2508_TOKENS | honor_of_kings | 2508_tokens | 2508 Tokens | 25.15 | false |
| HOK_4180_TOKENS | honor_of_kings | 4180_tokens | 4180 Tokens | 41.92 | false |
| HOK_8360_TOKENS | honor_of_kings | 8360_tokens | 8360 Tokens | 83.84 | false |

## Thailand pricing preview

| Canonical | Offer | Raw USD | FX | Converted THB | Landed THB | Selling THB | Profit THB |
|---|---|---|---|---|---|---|---|
| HOK_16_TOKENS | 16_tokens | 0.1687 | 35.25 | 5.946675 | 5.946675 | 6.24 | 0.3 |
| HOK_80_TOKENS | 80_tokens | 0.84 | 35.25 | 29.61 | 29.61 | 31.09 | 1.48 |
| HOK_240_TOKENS | 240_tokens | 2.51 | 35.25 | 88.4775 | 88.4775 | 92.9 | 4.42 |
| HOK_400_TOKENS | 400_tokens | 4.19 | 35.25 | 147.6975 | 147.6975 | 155.08 | 7.38 |
| HOK_560_TOKENS | 560_tokens | 5.87 | 35.25 | 206.9175 | 206.9175 | 217.26 | 10.35 |
| HOK_830_TOKENS | 830_tokens | 8.38 | 35.25 | 295.395 | 295.395 | 310.16 | 14.77 |
| HOK_1245_TOKENS | 1245_tokens | 12.57 | 35.25 | 443.0925 | 443.0925 | 465.25 | 22.15 |
| HOK_2508_TOKENS | 2508_tokens | 25.15 | 35.25 | 886.5375 | 886.5375 | 930.86 | 44.33 |
| HOK_4180_TOKENS | 4180_tokens | 41.92 | 35.25 | 1477.68 | 1477.68 | 1551.56 | 73.88 |
| HOK_8360_TOKENS | 8360_tokens | 83.84 | 35.25 | 2955.36 | 2955.36 | 3103.13 | 147.77 |

## Input and validation

AZIEL `userId` maps to order `fields.player_id`. The formatter trims whitespace, rejects missing/empty values, and never adds server, zone, or region fields. HOK validation remains **NOT AVAILABLE / NOT ADVERTISED** and no validation POST was made.

## Deliberately excluded

New candidates: . Special/pass: double_token_lucky_bag, honor_point_value_pack, standard_purchase_rebate_pack, weekly_card, premium_purchase_rebate_pack, weekly_card_plus.

## Gate state

All HOK mappings are disabled, fulfillment is not ready, prices are unpublished, and the storefront is unchanged.
