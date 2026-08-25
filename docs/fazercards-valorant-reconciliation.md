# FazerCards Valorant reconciliation

Generated: 2026-08-25

Strictly read-only discovery. No provider POST, validation, catalog/mapping write, price publication, storefront change, or WonDD mutation occurred.

## AZIEL authority

The DB contains `valorant`, but it is disabled, soft-deleted/archived, `HIDDEN`, `COMING_SOON`, excluded from public discovery, supports no regions, and routes to `coming-soon.html?product=valorant`. It is absent from `canonicalOperationalCatalog`. Six disabled legacy packages and six disabled WonDD mappings exist, but their input/pricing/fulfillment readiness is false. There is no active customer input schema or dedicated Valorant storefront route.

This distinguishes DB existence from closed canonical authority: **Valorant is not currently an operational AZIEL product.**

## Provider category matrix

| Category | Region | Delivery | Fields | Offers | Classification | TH usability |
|---|---|---|---|---:|---|---|
| `valorant_id` | Indonesia | Direct top-up | `riot_id` | 6 | DIRECT_TOPUP / REGIONAL_VARIANT | TH_EXCLUDED |
| `valorant_kh` | Cambodia | Direct top-up | `riot_id` | 6 | DIRECT_TOPUP / REGIONAL_VARIANT | TH_EXCLUDED |
| `valorant_my` | Malaysia | Direct top-up | `riot_id` | 6 | DIRECT_TOPUP / REGIONAL_VARIANT | TH_EXCLUDED |
| `valorant_ph` | Philippines | Direct top-up | `riot_id` | 6 | DIRECT_TOPUP / REGIONAL_VARIANT | TH_EXCLUDED |
| `valorant_sg` | Singapore | Direct top-up | `riot_id` | 6 | DIRECT_TOPUP / REGIONAL_VARIANT | TH_EXCLUDED |
| `valorant_th` | Thailand | Direct top-up | `riot_id` | 6 | DIRECT_TOPUP / REGIONAL_VARIANT | TH_SUPPORTED |
| `valorant_vn` | Vietnam | Direct top-up | `riot_id` | 6 | DIRECT_TOPUP / REGIONAL_VARIANT | TH_EXCLUDED |

Every category is region-locked and says delivery is direct to the account. No category requires login/password. No voucher/code or manual category was found.

## Input contract

For `valorant_th`, the provider advertises one text field:

- key: `riot_id`
- label: Riot ID
- example/format: `Name#TAG`
- region: Thailand account required

No separate tagline, server, region, email, or password field is advertised. No Valorant validation capability is advertised. AZIEL has no active Valorant input authority, so classification is **AZIEL_INPUT_CHANGE_REQUIRED**.

## Thailand offers and hypothetical economics

Active policy: 33.52 THB/USD, `manual_admin`, fixed THB 2 profit plus current gateway/platform policy. These are audit calculations only.

| Offer | Provider identity | Raw USD | Converted/landed THB | Preview selling THB | Profit THB | Classification |
|---|---|---:|---:|---:|---:|---|
| `475_vp` | 475 VP | 3.70 | 124.0240 | 127.5240 | 2 | NEW_CANONICAL_CANDIDATE |
| `1000_vp` | 1000 VP | 7.40 | 248.0480 | 251.5480 | 2 | NEW_CANONICAL_CANDIDATE |
| `2050_vp` | 2050 VP | 14.81 | 496.4312 | 499.9312 | 2 | NEW_CANONICAL_CANDIDATE |
| `3650_vp` | 3650 VP | 26.19 | 877.8888 | 881.3888 | 2 | NEW_CANONICAL_CANDIDATE |
| `5350_vp` | 5350 VP | 37.58 | 1259.6816 | 1263.1816 | 2 | NEW_CANONICAL_CANDIDATE |
| `11000_vp` | 11000 VP | 75.17 | 2519.6984 | 2523.1984 | 2 | NEW_CANONICAL_CANDIDATE |

The disabled DB packages use names such as “Valorant 475 Point,” while FazerCards authority says “475 VP.” Numeric equality alone is insufficient; therefore exact existing matches are zero.

## Canonical decision

**CANONICAL_REPAIR_REQUIRED**

Proposed, not applied:

1. Approve Valorant as a closed canonical operational product and add an explicit registry entry.
2. Restore or replace the archived DB product with TH scope, deliberate lifecycle/public state, and a dedicated `valorant.html` route.
3. Define canonical Riot ID input with the provider-authoritative `Name#TAG` format.
4. Approve canonical VP package identities/codes for 475, 1000, 2050, 3650, 5350, and 11000 VP; do not silently rename legacy Point packages.
5. Only afterward create disabled `valorant_th` mappings and run mapped Daily Pricing preview.

## Mapping blockers

- Valorant is absent from the closed canonical registry.
- The DB product is archived/hidden and has no supported region.
- No dedicated storefront route or active customer-input schema exists.
- Legacy package display identities use “Point,” not provider-authoritative “VP.”
- No Valorant validation capability is advertised; its optionality must be recorded before fulfillment rollout.
