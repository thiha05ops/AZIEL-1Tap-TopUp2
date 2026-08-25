# FazerCards Honor of Kings rollout preparation

Generated: 2026-08-25T15:40:40.307Z

FazerCards support confirmed that `honor_of_kings` accepts Thailand accounts when the catalog has no restriction and requires only `player_id`. No provider POST occurred.

## Exact disabled mappings

| Canonical | Category | Offer | Identity | Raw USD | Enabled |
|---|---|---|---|---|---|
| HOK_16_TOKENS | honor_of_kings | 16_tokens | 16 Tokens | 0.1686 | false |
| HOK_80_TOKENS | honor_of_kings | 80_tokens | 80 Tokens | 0.84 | false |
| HOK_240_TOKENS | honor_of_kings | 240_tokens | 240 Tokens | 2.51 | false |
| HOK_400_TOKENS | honor_of_kings | 400_tokens | 400 Tokens | 4.19 | false |
| HOK_560_TOKENS | honor_of_kings | 560_tokens | 560 Tokens | 5.87 | false |

## Thailand pricing preview

| Canonical | Offer | Raw USD | FX | Converted THB | Landed THB | Selling THB | Profit THB |
|---|---|---|---|---|---|---|---|
| HOK_16_TOKENS | 16_tokens | 0.1686 | 33.52 | 5.651472 | 5.651472 | 9.15 | 2 |
| HOK_80_TOKENS | 80_tokens | 0.84 | 33.52 | 28.1568 | 28.1568 | 31.66 | 2 |
| HOK_240_TOKENS | 240_tokens | 2.51 | 33.52 | 84.1352 | 84.1352 | 87.64 | 2 |
| HOK_400_TOKENS | 400_tokens | 4.19 | 33.52 | 140.4488 | 140.4488 | 143.95 | 2 |
| HOK_560_TOKENS | 560_tokens | 5.87 | 33.52 | 196.7624 | 196.7624 | 200.26 | 2 |

## Input and validation

AZIEL `userId` maps to order `fields.player_id`. The formatter trims whitespace, rejects missing/empty values, and never adds server, zone, or region fields. HOK validation remains **NOT AVAILABLE / NOT ADVERTISED** and no validation POST was made.

## Deliberately excluded

New candidates: 830_tokens, 1245_tokens, 2508_tokens, 4180_tokens, 8360_tokens. Special/pass: double_token_lucky_bag, honor_point_value_pack, standard_purchase_rebate_pack, weekly_card, premium_purchase_rebate_pack, weekly_card_plus.

## Gate state

All HOK mappings are disabled, fulfillment is not ready, prices are unpublished, and the storefront is unchanged.
