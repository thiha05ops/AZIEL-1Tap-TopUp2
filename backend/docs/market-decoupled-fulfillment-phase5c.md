# Phase 5C supplier-only auto-fulfillment gates

`AZIEL_SUPPLIER_GATE_MODE` has three controlled modes:

- `LEGACY_PRODUCT_ONLY` (default): the existing product-specific switch is authoritative. The supplier switch is observed but not required.
- `SUPPLIER_AND_PRODUCT`: both the supplier emergency switch and the existing product-specific switch must be explicitly true.
- `SUPPLIER_ONLY`: only the supplier emergency switch participates in gate authorization. Product-specific switches are ignored. Mapping identity, PRIMARY role, enabled/archive state, eligibility, readiness, pricing/cost freshness, route resolution, adapter configuration, and processor contracts remain independently required.

The supplier switches are `WONDD_AUTO_FULFILLMENT_ENABLED` and `FAZERCARDS_AUTO_FULFILLMENT_ENABLED`. Only the case-insensitive string `true` enables them. Missing, false, malformed, or unknown supplier configuration fails closed.

`SUPPLIER_ONLY` is an operational migration mode, not a routing or catalog mode. It does not change `AZIEL_FULFILLMENT_ROUTING_MODE`, customer-market eligibility, canonical/provider identities, supplier payloads, prices, or payment behavior. Legacy product variables may remain during deployment, but have no authorization effect in this mode.

Automatic route assessment and fulfillment startup use the adapter's centralized effective gate state. Both supplier adapters enforce the same state again immediately before provider submission. Recovery scheduling uses that effective supplier decision and does not erase already-accepted attempts when disabled. Manual administrative fulfillment retains its existing route and authorization behavior, while any resulting live supplier submission remains protected at the adapter boundary.
