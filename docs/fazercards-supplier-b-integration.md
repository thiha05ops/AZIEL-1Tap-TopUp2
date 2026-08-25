# FazerCards Supplier B integration

## Scope and safety

Phase 2B adds a production-shaped but disabled FazerCards integration for exact PUBG Mobile Auto offers. It does not enable `FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED`, configure a webhook, publish a price, create a FazerCards order, or change the public PUBG storefront. Credentials and webhook secrets remain environment-only.

## Authority chain

The fulfillment identity is:

`CommerceOrder → FulfillmentAttempt → SupplierProductMapping(FAZERCARDS, TH, pubg, canonical package) → category_id + offer_id`

The category is `pubg_mobile_auto`. The approved offers are `60_uc`, `325_uc`, `660_uc`, `1800_uc`, `3850_uc`, and `8100_uc`. Offer ID alone is never sufficient. `PUBG_60_UC` is the only existing canonical identity reused. The other five use disabled FazerCards-scoped canonical package codes because legacy “base + bonus” labels were not proven semantically identical.

Each mapping stores the authenticated `price_usd` as `supplierCostAuthority.rawSupplierCost`, currency `USD`, capture time, provider category, and provider offer. This is source evidence, not a storefront price.

## Adapter contract

`fazercardsAdapter.js` authenticates with `X-API-Key` from `FAZERCARDS_API_KEY` and provides:

- safe reads: account, balance, categories, offers, and order status;
- separate player validation via `POST /topups/validate-id` (implemented but not invoked during Phase 2B/2C verification). Current provider capability metadata identifies the PUBG validation family as `pubg_mobile`, distinct from the order category `pubg_mobile_auto`; both use `fields.player_id`;
- guarded order creation via `POST /topups/order`;
- raw-body webhook signature verification.

The adapter is provider-generic. PUBG field formatting is isolated in `fazercardsInputFormatters.js`: AZIEL `userId`/`playerId` maps to `fields.player_id`; no zone, server, or suffix is added.

## Gate and idempotency

`FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED` defaults off. The adapter checks it before making an order transport call. Enabling it authorizes only product `pubg`; the fulfillment service separately requires an enabled exact mapping with all readiness flags true.

The provider `Idempotency-Key` is the persisted `FulfillmentAttempt.idempotencyKey`. An uncertain submission stays `SUBMISSION_UNCERTAIN`; it must not receive a new key. The provider order ID is saved immediately after a confirmed response and before polling begins.

## Status and reconciliation

- `processing`, `pending`, `created`, `queued`, `in_progress` → non-terminal
- `completed`, `succeeded` → fulfillment/order success
- `failed`, `cancelled` → fulfillment failure
- `refunded` → fulfillment failure plus provider-refund evidence and manual financial review; it does not refund an AZIEL wallet
- unknown → non-terminal manual attention and no resubmission

Polling and signed webhooks call the same reconciliation path. Terminal FulfillmentAttempt indexes and state checks make convergence idempotent.

## Webhook foundation

`POST /api/webhooks/fazercards` is unavailable unless `FAZERCARDS_WEBHOOK_ENABLED=true`. No webhook is configured in this phase. The route receives an `application/json` buffer before global JSON parsing, verifies `X-Webhook-Signature` (`sha256=<hex>`) with HMAC-SHA256 over the exact bytes using a timing-safe comparison, then parses JSON. `ProviderWebhookEvent` uniquely deduplicates `(provider,event_id)`. Supported events are `order.created` and `order.status_changed`; unknown events are acknowledged and ignored.

## Pricing and storefront readiness

Daily Pricing can inspect disabled supplier mappings, raw USD cost, mapping readiness, and the exact provider IDs. A valid server-authoritative USD→THB acquisition rate is required before landed THB cost can be calculated. Without it, `pricingReady`, `fulfillmentReady`, and `storefrontReady` remain false and mappings remain disabled. No spot/audit rate is substituted.

The public storefront remains unchanged until all of these are true: exact mapping, input readiness, landed-cost authority, regional price readiness, fulfillment readiness, enabled mapping, enabled canonical package/price, and controlled live test PASS.

## Controlled-test prerequisites

1. Fund/confirm FazerCards balance.
2. Configure a bounded, current USD→THB acquisition rate and approve landed costs and selling prices.
3. Verify one exact mapping and real PUBG Player ID with the validation endpoint if operationally approved.
4. Configure and test the webhook secret/receiver separately.
5. Enable only the selected mapping and its readiness flags.
6. Temporarily enable only `FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED` for one controlled CommerceOrder.
7. Confirm provider order ID persistence, polling/webhook convergence, balance deduction, and terminal evidence; then turn the gate off.
