# Canonical product entitlement split — Phase 1

Generated: 2026-08-26T06:36:10.289Z

## Authority counts

| Metric | Before | After |
|---|---:|---:|
| products | 22 | 24 |
| nonDeletedPackages | 214 | 214 |
| enabledPackages | 114 | 114 |
| publicPackages | 70 | 56 |
| supplierMappings | 163 | 163 |

## Exact package moves

| From | Package | Family | To | Supplier mappings | TH | MM | Historical refs |
|---|---|---|---|---|---:|---:|---:|
| freefire | FF_BP_CARD | BP_CARD | freefire-pass-membership | WONDD:TH:FBPC84 | 93.5 | — | 0 |
| freefire | FF_LEVEL_10_UP_PASS | LEVEL_UP_PASS | freefire-pass-membership | WONDD:TH:FBIG10 | 20.17 | — | 0 |
| freefire | FF_LEVEL_15_UP_PASS | LEVEL_UP_PASS | freefire-pass-membership | WONDD:TH:FBIG15 | 20.17 | — | 0 |
| freefire | FF_LEVEL_20_UP_PASS | LEVEL_UP_PASS | freefire-pass-membership | WONDD:TH:FBIG20 | 20.17 | — | 0 |
| freefire | FF_LEVEL_25_UP_PASS | LEVEL_UP_PASS | freefire-pass-membership | WONDD:TH:FBIG25 | 20.17 | — | 0 |
| freefire | FF_LEVEL_30_UP_PASS | LEVEL_UP_PASS | freefire-pass-membership | WONDD:TH:FBIG30 | 26.83 | — | 0 |
| freefire | FF_LEVEL_6_UP_PASS | LEVEL_UP_PASS | freefire-pass-membership | WONDD:TH:FBIG06 | 10.17 | — | 0 |
| freefire | FF_MONTHLY_MEMBERSHIP | MEMBERSHIP_MONTHLY | freefire-pass-membership | WONDD:TH:FMON280 | 303.5 | — | 0 |
| freefire | FF_WEEKLY_MEMBERSHIP | MEMBERSHIP_WEEKLY | freefire-pass-membership | WONDD:TH:FDIM63 | 70.27 | — | 0 |
| freefire | FF_WEEKLY_MEMBERSHIP_LITE | MEMBERSHIP_WEEKLY_LITE | freefire-pass-membership | WONDD:TH:FDIM32 | 36.83 | — | 0 |
| hok | HOK_WEEKLY_CARD | CARDS_PASSES | hok-pass-cards | — | 33.62 | 4337 | 0 |
| hok | HOK_WEEKLY_CARD_PLUS | CARDS_PASSES | hok-pass-cards | — | 99.21 | 12798 | 0 |
| mlbb | MLBB_ONE_TIME_WEEKLY_PASS | WEEKLY_PASS | mlbb-twilight-weekly-pass | WONDD:TH:MLOTW01 | 53.5 | — | 0 |
| mlbb | MLBB_TWILIGHT_MIYA_PASS | TWILIGHT_PASS | mlbb-twilight-weekly-pass | WONDD:TH:MLTMP01 | 263.5 | — | 0 |

The complete 214-row migration matrix and per-row authority evidence are in `canonical-product-entitlement-split.json`. Historical snapshots were audited and not rewritten. New split products are disabled, hidden, and excluded from discovery. Prices, package IDs, package codes, mappings, roles, gates, and supplier cost evidence were preserved.
