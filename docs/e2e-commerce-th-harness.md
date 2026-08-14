# TH/THB Commerce E2E harness

This harness is test infrastructure. It cannot target `azielplay.com` or any `*.azielplay.com` host, cannot run with `NODE_ENV=production`, and never falls back to the normal `MONGO_URI`.

## Required environment

```sh
export NODE_ENV=test
export AZIEL_E2E_TEST_MODE=true
export AZIEL_E2E_TEST_SCOPE=local_th
export AZIEL_E2E_TEST_CONFIRM=ISOLATED_AZIEL_E2E_ONLY
export AZIEL_E2E_MONGO_URI='mongodb://127.0.0.1:27017/aziel_e2e_local_th'
export MONGO_URI="$AZIEL_E2E_MONGO_URI"
export AZIEL_E2E_BASE_URL='http://127.0.0.1:3000'
export AZIEL_E2E_CUSTOMER_PASSWORD='<test-only password, 12+ characters>'
export AZIEL_E2E_ADMIN_PASSWORD='<different test-only password, 12+ characters>'
```

Use a database created only for this E2E scope. The application runtime under test must use the same isolated database and the same E2E gate so notification suppression applies inside the server process.

For a non-production remote staging host, additionally set `AZIEL_E2E_ALLOW_REMOTE_STAGING=true`. Production AZIEL hostnames remain forbidden.

## Commands

```sh
npm run verify:e2e-harness
npm run e2e:setup
npm run e2e:preflight
npm run e2e:commerce-th
npm run e2e:inspect -- <RUN_ID>
npm run e2e:cleanup-review -- <RUN_ID>
```

There is deliberately no delete command. `cleanup-review` prints the exact owner-bound graph for deliberate review.

## Isolation and evidence

- Customer: `aziel_e2e_customer_<scope>@example.invalid`.
- Admin: `aziel_e2e_operations_<scope>`, role `OPERATIONS`.
- Transactions: owned by the exact test customer and carry `aziel-e2e:<run-id>` idempotency/request markers.
- Run manifests: `.aziel-e2e/runs/<run-id>.json` with mode `0600`.
- Suppressed outbound events: `.aziel-e2e/events.jsonl`, recording no real recipient value.
- Receipt: a 1×1 PNG fixture with no bank, account, customer, or payment content; uploaded via the normal Commerce receipt endpoint and shared storage service.

The run stops and records endpoint, HTTP status, error code, request marker, resolved order type, and queued-attempt state if fulfillment start returns `FULFILLMENT_START_REQUIRES_ORDER`.
