# Moxie Backend — Durable State Machine

Moxie v2.0 treats PostgreSQL as the system of record. Process memory is never required for business correctness.

## Reliability model

`WhatsApp webhook -> webhook_events -> webhook worker -> PostgreSQL transaction -> outbox_messages -> outbox worker -> WhatsApp API`

Match state and match notification intent are committed in the same transaction. Relay state and durable match chat context are also committed with the outbound intent. Worker queues use PostgreSQL row locks and leases so another process can recover abandoned work after a crash.

## Process classes

Run these independently in production:

```text
Single-service runtime  npm start
  ├─ Web/API             node dist/app.js
  ├─ Webhook worker      node dist/workers/webhook-worker.js
  └─ Outbox worker       node dist/workers/outbox-worker.js
Maintenance (one-shot)  npm run maintenance

For hosts that support separate process types, the individual commands remain available as `npm run start:web`, `npm run start:webhook-worker`, and `npm run start:outbox-worker`.
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

2. Create a local environment file. `npm run check:env` validates production configuration; the destructive test suite validates `INTEGRATION_DATABASE_URL` separately.

```bash
npm run setup:env
npm run check:env:integration
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
- The exact legacy Moxie schema is populated with representative users, matches, reports, blocks, contacts, and feedback, then upgraded in place; all legacy rows and IDs must survive and all Work 2 migrations must be recorded.

The crash test deliberately kills a child process. Run it only against a disposable integration database.

## Render deployment contract

The default production command is now intentionally **single-service compatible**:

```bash
npm start
```

`npm start` launches a small supervisor that starts all three critical runtime processes from the same Render Web Service:

| Child process | Purpose |
| --- | --- |
| Web/API | Health checks, dashboard, Meta webhook ingestion |
| Webhook worker | Processes durable `webhook_events` |
| Outbox worker | Delivers durable `outbox_messages` |

If any critical child exits unexpectedly, the supervisor terminates the remaining children and exits non-zero so Render can restart the whole service. Durable webhook/outbox leases in PostgreSQL allow work to resume after restart.

This is the recommended configuration for a single Render Web Service. Set the Render **Start Command** to `npm start` (or leave it at the package default).

Hosts with dedicated process types can still run the components separately using:

```bash
npm run start:web
npm run start:webhook-worker
npm run start:outbox-worker
```

Maintenance remains a one-shot command:

```bash
npm run maintenance
```

The web process also performs one maintenance reconciliation during cold boot, so restart recovery does not depend on a scheduler. A periodic scheduler is still useful for stale-state cleanup on an always-running service.

Before changing the live Render service, run the full resilience suite against a disposable PostgreSQL database.
