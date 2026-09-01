# First Production Supplier-Catalog Reconciliation Runbook

This runbook is documentation only. It approves no current offer. Current mutation status remains locked and the first real reconciliation is separately authorized.

## Preconditions

1. Select exactly one offer after fresh human review; never manufacture a candidate to progress rollout.
2. Prove exact canonical semantic equivalence without relying on denomination, display name, price, product family, or market alone.
3. Record explicit approval of the existing canonical target.
4. Confirm exact supplier, namespace, provider product identity, and provider offer identity. WonDD requires confirmed transactional `serviceCode` authority.
5. Capture the current source offer hash, revision, last-change time, semantic hash, product evidence hash, and cost hash from the trusted review endpoint.
6. Review restrictions, supplier market, availability completeness, and canonical-to-provider input transformation.
7. Run `verify:supplier-catalog-reconciliation-production-indexes`; require zero missing/conflicting indexes and zero decisions unless the authorized plan accounts for history.
8. Obtain explicit OWNER authorization for the one decision and separately authorize setting `SUPPLIER_CATALOG_RECONCILIATION_MUTATIONS_ENABLED=true` in the production runtime.
9. Confirm authenticated OWNER identity, request ID, decision type, reason, target, mapping market, and unique idempotency token.
10. Capture all protected business fingerprints, mapping business-state hash, decision count, publication count, storefront count, and current mapping alternatives.

## Future mutation enablement checklist

- Fresh candidate review and evidence package approved.
- OWNER approval and single-offer scope recorded.
- Decision indexes verified after the exact deployment/restart that will execute the command.
- Environment change reviewed and applied only to the intended production process.
- Restart/redeployment implications understood; health, authentication, RBAC, GET review, and disabled supplier-call boundaries verified.
- Source lock fetched again after restart and immediately before confirmation.
- Before fingerprints captured after gate enablement but before POST.
- Unique idempotency token stored in the reviewed execution record.
- Post-write fingerprints and exact authorized delta plan ready.
- Gate disable/re-lock and restart plan ready before execution begins.

## Execution

1. Confirm the target offer/source lock still matches and the offer remains unmapped and `EXACT_CANONICAL_MATCH`.
2. Reconcile exactly one offer using the narrow reconciliation POST and the reviewed idempotency token.
3. Require a committed transaction result containing one decision and one mapping.
4. Verify the mapping is fail-closed: `enabled=false`, role `DISABLED`, execution `MANUAL`, eligibility `UNKNOWN`, empty market allowlist, all readiness flags false, no cost authority, no automatic failover.
5. Verify the decision identity, version, source hashes, actor, reason, before/after state, and audit trail.
6. Verify the mapping references the exact `supplierCatalogOfferId` and canonical target.
7. Verify publication, pricing, existing roles, eligibility, readiness, routing, inventory, supplier catalog observations, orders, and fulfillment are unchanged.

## Post-execution

1. Capture the same protected fingerprints immediately.
2. Require that only the authorized decision and fail-closed mapping changed; investigate any other delta.
3. Disable `SUPPLIER_CATALOG_RECONCILIATION_MUTATIONS_ENABLED` and redeploy/restart unless continued enablement has separate written authorization.
4. Verify the gate is actively disabled, application health is normal, and GET review shows the decision/mapping accurately.
5. Attach reviewed evidence, command result, fingerprint comparison, actor, request ID, and timestamps to the change record.
6. Stop. Do not reconcile a second offer under the first authorization.

## Abort conditions

Abort before mutation if the source lock, identity, semantics, cost, restrictions, input contract, market, availability evidence, target, current decision, mapping alternatives, index state, RBAC, gate scope, or fingerprints differ from the reviewed plan. Abort if any supplier call would be needed.

## Rollback and correction

Do not delete decision history or a mapping. If the newly created fail-closed mapping is wrong, keep it disabled, archive it through the existing reviewed mapping lifecycle with actor/reason/evidence, supersede/reopen the reconciliation decision, and preserve all references. If any order or fulfillment history references it, it must never be erased. Disable the mutation gate first and stop for a separate correction authorization.
