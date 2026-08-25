# WonDD production catalog readiness

Captured from the authenticated read-only WonDD pack-list on 2026-08-25. No `topup` method was used during onboarding.

## Summary

- WonDD live catalog: **11 families / 153 packages**
- Supplier-confirmed families: **10**
- Supplier-supported packages onboarded and explicitly mapped: **131**
- Pricing-ready WonDD mappings: **2**
- Input-ready mappings: **20**
- Production-ready mappings: **1** (`mlbb / MLBB_86 / ML00086`)
- Enabled WonDD mappings: **1**
- Duplicate supplier packcodes or canonical mappings: **0**

| Game | serviceid | servicecode | WonDD packages | AZIEL product | Mapped | Input contract | Pricing status | Auto fulfillment | Blockers |
|---|---:|---|---:|---|---:|---|---|---|---|
| RoV | 9601 | `rov` | 8 | `aovid` | 8 | Needs confirmation | 0 ready | Disabled | `INPUT_NEEDS_CONFIRMATION` |
| Free Fire | 9602 | `freefire` | 19 | `freefire` | 19 | Needs confirmation | 1 ready | Disabled | `INPUT_NEEDS_CONFIRMATION` |
| Undawn | 9603 | `undawn` | 17 | `undawn` | 17 | Needs confirmation | 0 ready | Disabled | `INPUT_NEEDS_CONFIRMATION` |
| Black Clover M | 9604 | — | 17 | — | 0 | Unknown | Not onboarded | Disabled | `NEEDS_SERVICECODE` |
| Call of Duty Mobile | 9605 | `callofduty` | 8 | `callofduty` | 8 | Needs confirmation | 0 ready | Disabled | `INPUT_NEEDS_CONFIRMATION` |
| Delta Force | 9606 | `deltaforce` | 16 | `deltaforce` | 16 | Needs confirmation | 0 ready | Disabled | `INPUT_NEEDS_CONFIRMATION` |
| Haikyu!! Fly High | 9607 | `haikyuflyhigh` | 23 | `haikyuflyhigh` | 23 | Needs confirmation | 0 ready | Disabled | `INPUT_NEEDS_CONFIRMATION` |
| PUBG Mobile | 9621 | `pubg` | 6 | `pubg` | 6 | Needs confirmation | 0 ready | Disabled | `INPUT_NEEDS_CONFIRMATION` |
| Mobile Legends | 9622 | `mlbb` | 20 | `mlbb` | 20 | `User ID + " " + Zone ID` | 1 ready | `MLBB_86` only | Other packages require pricing review and controlled enablement |
| Valorant | 9623 | `val` | 6 | `valorant` | 6 | Needs confirmation | 0 ready | Disabled | `INPUT_NEEDS_CONFIRMATION` |
| Heartopia | 9624 | `HTP` | 13 | `heartopia` | 8 | Needs confirmation | 0 ready | Disabled | Input confirmation; five non-Diamond packages excluded |

## Authority and safety

Numeric `serviceid` is discovery metadata only. `servicecode` comes exclusively from explicit supplier confirmation, and every `packcode` is persisted directly from the authenticated supplier catalog. Runtime code never derives either identifier from display names, price, position, or serviceid.

The actual charged supplier cost is `netpricedealer`. For `ML00086`, both `amount` and `netpricedealer` were 41.00 THB and the controlled fulfillment deducted exactly 41 THB, confirming the current contract. All mappings preserve `amount`, `discount`, and `netpricedealer` with capture time.

New packages are disabled and have no automatically published selling price. AZIEL Pricing Engine remains authoritative for customer pricing. Existing selling prices were not overwritten. A mapping is considered production-ready only when supplier mapping, input contract, pricing, controlled fulfillment readiness, and enablement are all independently true.

Only MLBB has a configured WonDD player-input formatter. Unknown products fail closed with `WONDD_INPUT_CONTRACT_NOT_CONFIGURED`. All live fulfillment gates remained off during onboarding.
