# Moxie Backend — Durable State Machine

Moxie v2.0 treats PostgreSQL as the system of record. Process memory is never required for business correctness.

## Reliability model

`WhatsApp webhook -> webhook_events -> webhook worker -> PostgreSQL transaction -> outbox_messages -> outbox worker -> WhatsApp API`

Match state and match notification intent are committed in the same transaction. Relay state and durable match chat context are also committed with the outbound intent. Worker queues use PostgreSQL row locks and leases so another process can recover abandoned work after a crash.

## Process classes

Run these independently in production:

```text
Web/API process       npm start
Webhook worker        npm run start:webhook-worker
Outbox worker         npm run start:outbox-worker
Maintenance/Cron      npm run maintenance
```

The maintenance command is intentionally a one-shot process. Run it from a platform cron/scheduler. There is no application-level business `setInterval()` dependency.

## Startup guarantees

The web process does not listen until migrations, a database readiness query, and adapter initialization succeed.

- `/health` = liveness
- `/ready` = readiness
- `/webhooks/whatsapp` = durable ingestion only; it writes the event ledger and acknowledges the provider

## Database migrations

The migration runner bootstraps a fresh database from the existing schema, records the baseline, then applies numbered resilience migrations exactly once. Production startup fails closed on migration errors instead of serving a partially initialized application.

## Crash semantics

### Webhook crash

A webhook is inserted into `webhook_events` before business processing. A worker claims it with a lease. If the worker dies, the lease expires and another worker can reclaim the event.

### Match creation crash

Match state and both notification jobs are written in one PostgreSQL transaction. A process crash before or after commit cannot produce a durable `matched` state without the corresponding outbox records.

### Outbox crash

Outbox delivery is at-least-once. Jobs are leased and retried with exponential backoff, and each logical send has a durable dedupe key. A provider-side exactly-once guarantee still requires provider idempotency support; the database provides durable intent and recovery, not magical exactly-once network delivery.

### Host sleep / restart

Maintenance decisions are timestamp-backed (`started_at`, `last_activity_at`) and evaluated by PostgreSQL queries. A cold boot or the next scheduled maintenance invocation recovers stale state without relying on old timer callbacks.

## Verification

Static architecture checks:

```bash
npm run build
node tests/resilience-static.js
```

For full failure verification, run the integration suite against a disposable PostgreSQL database and deliberately kill worker processes during active transactions. The required acceptance properties are:

1. five concurrent identical webhook deliveries create one `webhook_events` row;
2. concurrent daily reward claims increment trust exactly once;
3. expired matches are resolved by the maintenance command after a cold boot;
4. committed matches always have the two expected pending outbox jobs;
5. worker leases allow abandoned webhook/outbox jobs to be reclaimed.

## PostgreSQL resilience integration suite

Use a disposable PostgreSQL database. The suite is destructive and truncates application tables between tests. It requires `INTEGRATION_DATABASE_URL` and deliberately refuses to reuse the normal `DATABASE_URL` variable.

1. Start PostgreSQL:

```bash
npm run db:up
```

2. Create a local environment file and verify it:

```bash
npm run setup:env
npm run check:env
```

3. Run the complete resilience gate:

```bash
PowerShell: `$env:INTEGRATION_DATABASE_URL='postgresql://moxie:moxie_dev@localhost:5432/moxie'; npm run test:resilience`

Bash: `INTEGRATION_DATABASE_URL=postgresql://moxie:moxie_dev@localhost:5432/moxie npm run test:resilience`
```

The integration suite verifies:

- 5 concurrent copies of the same webhook event produce exactly one durable event.
- 20 concurrent daily-reward claims produce exactly one reward.
- Match creation updates both users and inserts both outbox notifications in the same database transaction.
- A worker process killed with `SIGKILL` while holding an outbox lease is recovered after lease expiry.
- Cold-boot maintenance detects and closes stale matches and creates durable end notifications.

The crash test deliberately kills a child process. Run it only against a disposable integration database.

## Render deployment contract

Work 2 is a multi-process deployment. Do not replace the old Render Web Service with `npm start` alone. Configure these processes from the same Git revision:

| Render process | Command | Purpose |
|---|---|---|
| Web Service | `npm start` | Health checks, dashboard, Meta webhook ingestion |
| Background Worker | `npm run start:webhook-worker` | Processes durable `webhook_events` |
| Background Worker | `npm run start:outbox-worker` | Delivers durable `outbox_messages` |
| Cron Job | `npm run maintenance` | Cold-start/stale-state reconciliation |

Required production environment variables:

```text
DATABASE_URL
WHATSAPP_TOKEN
WHATSAPP_PHONE_ID
WHATSAPP_API_VERSION
WHATSAPP_VERIFY_TOKEN
DASHBOARD_PASSWORD
ADMIN_IDS
```

Never commit `.env`, production credentials, `dist/`, or `node_modules/`. Use `.env.example` as the safe configuration template.

Before changing the live Render services, run the full resilience suite against a disposable PostgreSQL database.
