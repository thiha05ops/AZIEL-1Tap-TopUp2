# Global + Asia supplier catalog coverage review

Status: repository implementation complete; production business mutation not authorized or executed.

## Evidence boundary

- The current durable catalog contains 16 supplier products and 259 supplier offers.
- The authenticated FazerCards full-catalog artifact was generated on 2026-08-25 and contains 318 categories and 5,457 offers.
- A live read-only FazerCards category refresh on 2026-08-31 returned HTTP 403 because the subscription is inactive.
- Therefore the historical full-catalog artifact is useful review evidence, but it is not asserted to be the current live catalog.
- WonDD persists all 11 product families with `supplierMarketCode=UNSPECIFIED`; those 153 offers remain market-review candidates rather than being guessed into Asia scope.

## Historical FazerCards accounting

Applying the repository market policy to the authenticated 2026-08-25 artifact produces:

| State | Categories | Offers |
|---|---:|---:|
| ELIGIBLE_GLOBAL | 30 | 611 |
| ELIGIBLE_ASIA | 19 | 281 |
| ELIGIBLE_ASIA_COUNTRY | 71 | 780 |
| NON_TARGET_MARKET | 19 | 275 |
| UNKNOWN_MARKET | 171 | 3,186 |
| UNSUPPORTED | 8 | 324 |
| Total | 318 | 5,457 |

Historical target candidates total 120 categories and 1,672 offers. These are not production mutation instructions because source freshness and exact package semantics must be reconfirmed.

## Current durable accounting

The production read-only projection reports:

- 90 target-eligible durable offers: 72 Global and 18 Asia-country.
- 26 target offers already mapped.
- 64 target offers requiring semantic/canonical review.
- 169 offers fail closed as unknown-market evidence, including all 153 WonDD offers.
- Every durable offer receives a disposition; unaccounted durable offers are zero.

## Reviewed operation contract

Run `npm run plan:global-asia-supplier-catalog-coverage` to emit the complete current durable offer set with source identity, market state, mapping state, disposition, readiness blockers, publication state, and source-set hash. The generator is read-only by default. An optional `--output=<new-file>` uses create-only file semantics and never writes MongoDB.

No canonical product, canonical package, mapping, pricing, publication, cost authority, production role, order, quote, or fulfillment mutation is approved by this document.

## Required operational sequence

1. Renew or restore read-only FazerCards catalog access.
2. Perform a fresh complete discovery and compare source identities with the reviewed artifact.
3. Confirm WonDD market semantics from provider-owned evidence.
4. Review exact product, package, input, restriction, and market semantics.
5. Use the existing gated reconciliation authority for exact links.
6. Create canonical identities only through a separately reviewed canonical-authority operation.
7. Configure approved supplier cost, pricing, eligibility, readiness, and Owner routing independently.
8. Let Admin decide SELL/OFF through PackageMarketPublication.
