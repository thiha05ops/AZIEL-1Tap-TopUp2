# Multi-Currency Supplier Pricing Foundation

## Scope and currency domains

Phase 2A separates three currency domains without enabling a new checkout currency:

- **Supplier/source cost currencies:** MMK, THB, USD (`SUPPLIER_CURRENCY`).
- **Pricing calculation source currencies:** the supported supplier currencies. The target is always a supported storefront currency.
- **Storefront/customer settlement currencies:** MMK and THB only (`STOREFRONT_CURRENCY`; the legacy `CURRENCY` export remains an alias).

Adding USD supplier cost therefore does not permit USD checkout, wallet settlement, promotion currency, PricingPolicy settlement, or CommerceOrder settlement.

## Authority chain

The server-side authority chain is:

1. `Supplier` defines the supplier's source currency and supported regions.
2. `SupplierProductMapping` binds one canonical product/package/region to exact provider product and offer identities. Its typed `supplierCostAuthority` can preserve raw cost evidence; legacy `mappingMetadata.supplierCost` remains readable.
3. Daily Pricing resolves the enabled mapping and ignores a client-submitted cost when an API supplier mapping is used.
4. `SupplierProductMapping`/`CatalogPackage` raw evidence is normalized by `supplierCostService`.
5. The active regional `PricingPolicy`, or the existing environment authority, supplies the server-side FX record.
6. `pricingCalculationEngine` converts the raw source cost, adds explicit acquisition adjustments, and produces landed cost before applying the existing supplier fee, business cost, gateway/platform costs, tax, profit, and rounding rules.
7. `PricingQuote` snapshots the internal evidence; checkout receives only the server-produced quote.
8. Public catalog projection exposes the regional selling price and display-discount fields only.

## Raw supplier cost

The internal models can preserve:

- `rawSupplierCost`
- `rawSupplierCurrency`
- `supplierCostTimestamp`/`capturedAt`
- `supplierCostSource`
- provider product/category identity
- provider offer/package identity

Existing `supplierCost` and `supplierCurrency` remain valid compatibility fields. For existing WonDD records, raw cost and landed cost are the same THB amount unless new evidence fields are populated.

Provider adapters must not silently convert supplier prices. A future FazerCards catalog reconciliation should write the authenticated `price_usd` value as raw USD evidence on an exact mapping.

## Landed cost

The calculation model is:

```text
rawSupplierCost × fxRate
= fxConvertedCost
+ fundingCost
+ otherAcquisitionCost
= landedCost
→ existing AZIEL selling-price policy
```

`fundingCost` and `otherAcquisitionCost` are explicit target-currency acquisition adjustments. They are applied before the existing selling-price rules and are not aliases for gateway fees, platform fees, general business costs, or profit.

The internal persisted representation supports:

- raw amount/currency
- FX rate, source, captured/effective timestamps
- converted cost
- funding and other acquisition costs
- landed amount/currency

## FX authority and freshness

No public FX site is scraped and no hard-coded USD/THB rate exists.

An FX record contains:

- `sourceCurrency`
- `targetCurrency`
- positive `rate`
- `source`
- `capturedAt`
- optional `effectiveAt` and `expiresAt`
- `maxAgeSeconds`

For a source currency outside the settlement domain, bounded freshness evidence is mandatory. Missing source, captured time, maximum age, invalid pair, non-positive rate, expired rate, or a rate older than its maximum age fails preview and therefore prevents publication.

Same-currency THB→THB and MMK→MMK use the existing rate-one path. Existing THB→MMK policy/environment behavior remains compatible; it may adopt bounded freshness metadata separately without a destructive migration.

An operational manual USD/USDT acquisition rate is valid authority when recorded with its actual source, capture time, and bounded lifetime. Phase 2A does not integrate Binance or any public-rate provider.

## Daily Pricing

Daily Pricing can now display and carry:

- supplier and raw source cost
- FX pair, rate, source, and timestamp
- converted and landed cost
- THB/MMK selling price and profit

Supplier and region changes reload server-owned supplier mappings. API-mode suppliers require an enabled exact mapping. Mapping cost overrides submitted row cost. FX is never accepted from a Daily Pricing row; preview and publish both resolve it from the same server-side PricingPolicy/environment authority. Missing or stale bounded FX produces a blocked preview and cannot publish.

Phase 2A creates no FazerCards supplier, mapping, catalog row, price, or fulfillment configuration.

## Admin and public boundary

Raw cost, provider identity, FX acquisition evidence, landed cost, and margin evidence are Admin/internal data. `catalogService` only includes them when `includeAdminPricing` is enabled. `catalogProjection.normalizePrice` and public checkout/quote application results continue to omit them.

## Future FazerCards flow

```text
FazerCards offer price_usd
→ exact SupplierProductMapping raw USD evidence
→ authoritative operational USD/THB acquisition rate
→ landed THB supplier cost
→ existing pricing engine/policy
→ THB selling price
```

The future adapter remains a separate phase. No provider order, validation POST, fulfillment gate, or automatic publication is introduced here.

## Compatibility

- Existing WonDD THB cost remains valid without rewriting production documents.
- THB→THB remains rate one.
- Existing MMK settlement remains constrained to MMK.
- Missing new evidence fields default safely and do not require a bulk migration.
- Storefront/customer settlement remains MMK/THB.
