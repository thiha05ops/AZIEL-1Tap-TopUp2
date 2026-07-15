# AZIEL V2.5 Production Launch Runbook

This runbook is the operational gate for a controlled public launch. It records what to verify without printing secrets, mutating production data unexpectedly, or rolling back financial truth blindly.

## PRE-DEPLOY

- Confirm the Git working tree is clean, or record the intentional diff being deployed.
- Record the commit SHA and the Render service/environment target.
- Verify production environment status by variable name only. Do not paste secret values into logs, chat, screenshots, or tickets.
- Confirm required production configuration is present: `NODE_ENV`, `MONGO_URI`, `JWT_SECRET`, `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `OMISE_MODE`, `OMISE_PUBLIC_KEY`, `OMISE_SECRET_KEY`, `EMAIL_USER`, `EMAIL_PASS`, `REGISTRATION_OTP_PEPPER`, `TWO_FACTOR_ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, `STORAGE_MODE`, and durable storage provider settings.
- Confirm MongoDB backup/snapshot availability before deploying.
- Run `npm run verify:public-launch`.
- Run the full readiness verifier suite listed in the Phase 16 checklist.
- Confirm payment mode. Production live launch must not use test keys unless the launch owner explicitly accepts a non-live payment launch.
- Confirm the payment webhook target points to the production service URL and the expected `/api/payment/webhook` path.
- Confirm email policy/status. Email is launch-critical because registration and password reset use OTP email.
- Confirm persistent media status. Production must use durable storage; Render local filesystem must not be the only storage for payment evidence, support evidence, media, banners, or profile photos.

## DEPLOY

- Deploy one known commit.
- Observe startup logs.
- Confirm production readiness validation runs before Mongo connection and before `server.listen`.
- Confirm Mongo connects before the server accepts traffic.
- Check `GET /health`.
- Check `GET /ready`.
- Confirm `/ready` reports configuration and Mongo ready without exposing secrets.
- Confirm no unexpected startup fallback to development secrets, local origins, local storage, or MemoryStore occurs.

## POST-DEPLOY SMOKE

- Load Home.
- Log in with a controlled customer account.
- Perform one non-mutating Admin login/navigation check.
- Create one controlled test order appropriate for the configured payment mode.
- Confirm payment status visibility.
- Confirm Admin Orders visibility.
- Confirm fulfillment visibility without starting an unintended real supplier action.
- Confirm notification delivery/history for the smoke flow.
- Confirm wallet truth only if the smoke flow legitimately affects wallet state.
- Confirm uploaded evidence/media remains accessible after a restart or redeploy test in a non-production environment.

## ROLLBACK

- Identify the previous known-good commit/deploy.
- Roll application code back to that known commit.
- Do not blindly roll MongoDB data backward.
- Assess whether migrations or index declarations changed.
- Preserve payment/webhook evidence.
- Preserve wallet ledger records.
- Preserve Admin audit logs.
- Verify `GET /health` and `GET /ready` after rollback.
- Re-run the non-destructive readiness verifier suite after rollback.

## INCIDENT STOP CONDITIONS

- Duplicate wallet credit or debit.
- Webhook replay causing duplicate financial effect.
- Order amount, currency, package, or product mismatch.
- Admin authentication bypass or RBAC bypass.
- Public mutation route exposure.
- MongoDB unavailable or not ready.
- Payment live/test mode mismatch.
- Production startup using unsafe development secrets.
- Persistent upload loss affecting payment evidence, wallet evidence, support evidence, media library assets, banners, or profile photos.
- Email OTP delivery unavailable for registration or password reset.
