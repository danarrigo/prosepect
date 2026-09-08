# Prosepect operations

This guide covers the supported Docker Compose deployment and the hosted Vercel/Render deployment. TLS must terminate at the hosting platform or a trusted reverse proxy.

## Production configuration

Production startup intentionally fails unless these invariants hold:

- `APP_ENV=production`
- `ALLOW_INSECURE_DEV_AUTH=false`
- all Google OAuth variables are present
- `TOKEN_ENCRYPTION_KEY` decodes to exactly 32 bytes
- all required S3 variables are present
- `MAX_USER_FILE_STORAGE_BYTES` is positive and does not exceed `MAX_TOTAL_FILE_STORAGE_BYTES`
- `MAX_TOTAL_FILE_STORAGE_BYTES` is set below the provider's free storage allowance
- `MAX_USER_ACCOUNTS` is a positive hard capacity when configured
- `WORKER_TRIGGER_TOKEN` contains at least 32 random characters when hosted cron is enabled
- `DATABASE_URL`, `APP_URL`, and `CORS_ALLOWED_ORIGIN` point at production services

Generate the credential-encryption key with:

```bash
openssl rand -base64 32
```

Set `INVITE_ONLY=true` for a private beta. Invite an account before first login with:

```sql
INSERT INTO account_invites (id, email)
VALUES (gen_random_uuid(), LOWER('person@example.com'));
```

Only set `TRUST_PROXY_HEADERS=true` when untrusted clients cannot bypass the hosting platform or configured reverse proxy.

For public registration, keep `INVITE_ONLY=true` until the Privacy Policy and Terms are live, Google OAuth production verification is complete, backup restoration has been tested, alerts are enabled, and production smoke tests pass. Then set `INVITE_ONLY=false` while retaining `MAX_USER_ACCOUNTS`. The account limit is checked under a PostgreSQL advisory transaction lock: new registrations are rejected at capacity, while existing users remain able to sign in. Hosted sign-in requires affirmative acceptance of the current Terms and Privacy Policy and stores the accepted versions and age confirmation in `legal_acceptances`.

## Hosted free-tier deployment

The supported hosted-beta topology is:

- Vercel serves the Vue application at `https://prosepect.com`.
- Render Free runs the Axum API at `https://api.prosepect.com`.
- Local mutations wake an in-process synchronization dispatcher and Google webhooks enqueue inbound changes.
- GitHub Actions calls an authenticated recovery and watch-renewal endpoint every 15 minutes.
- Neon PostgreSQL stores all canonical and operational state.
- A private Cloudflare R2 bucket stores attachments through presigned URLs.

This topology does not require a Google Cloud billing account. Render Free is suitable for a personal beta, not a production SLA. The synchronization trigger normally keeps the API awake and consumes most of the service's monthly free-instance allowance. If the trigger is disabled, the API sleeps after 15 idle minutes and can take about one minute to wake. Free services can be suspended when monthly allowances are exhausted. GitHub schedules can be delayed and public-repository schedules are disabled after 60 days without repository activity.

### Guided setup

Run the checked-in wizard from the repository root:

```bash
./scripts/deploy-render.sh
```

The wizard opens each required dashboard, captures secrets with hidden input, stores resumable values in ignored `.env.deploy`, configures the scheduled worker's GitHub secrets, and guides the Render Blueprint and Vercel deployments. Do not commit `.env.deploy`.

### Render API

`render.yaml` defines one Singapore-region Docker web service on the Free plan. Render builds `apps/api/Dockerfile` with the repository root as its build context, checks `/ready`, and deploys changes from the default branch. The Blueprint prompts for PostgreSQL, Google, encryption, and R2 credentials rather than storing them in Git.

Render must receive these canonical public values:

```text
APP_URL                         https://prosepect.com
CORS_ALLOWED_ORIGIN             https://prosepect.com
GOOGLE_REDIRECT_URI             https://api.prosepect.com/api/v1/auth/google/callback
GOOGLE_CALENDAR_WEBHOOK_URL     https://api.prosepect.com/webhooks/google/calendar
BIND_ADDRESS                    0.0.0.0:10000
MAX_USER_ACCOUNTS               100
MAX_USER_FILE_STORAGE_BYTES     104857600
MAX_TOTAL_FILE_STORAGE_BYTES    5368709120
```

Generate `WORKER_TRIGGER_TOKEN` with `openssl rand -hex 32`, store the same value in Render and the GitHub secret `PROSEPECT_WORKER_TRIGGER_TOKEN`, and never put it in source control.

Attach `api.prosepect.com` as a Render custom domain and add the DNS record Render displays. Managed TLS provisioning can take time.

### Scheduled worker

`.github/workflows/worker.yml` calls `POST /internal/synchronization/run` at minutes 7, 22, 37, and 52 of each hour to avoid the busiest start-of-hour scheduling window. The API verifies a bearer token, enqueues stale calendar synchronization and expiring webhook watches, and processes at most one claim. This remains the durable recovery path when an immediate dispatch or Google notification is missed. Overlapping runs are serialized. Scheduled runs use `curl` only: they do not compile Rust and do not start a worker container. The job remains skipped until `PROSEPECT_WORKER_ENABLED=true` and `PROSEPECT_WORKER_TRIGGER_TOKEN` is configured.

The same request also acts as an API availability check because network, authentication, or worker failures fail the workflow. The repository is public, so standard GitHub-hosted runners are free. Treat GitHub scheduling as best-effort, enable Actions failure notifications, and manually run the workflow after changing synchronization configuration.

### Domains and OAuth

Use these canonical values:

```text
Frontend                  https://prosepect.com
API                       https://api.prosepect.com
Google redirect           https://api.prosepect.com/api/v1/auth/google/callback
Google Calendar webhook   https://api.prosepect.com/webhooks/google/calendar
CORS allowed origin       https://prosepect.com
```

The Google OAuth client must use the redirect URI exactly. The Vercel production environment must set `VITE_API_URL=https://api.prosepect.com`.

A public Google OAuth application must configure:

```text
Application homepage     https://prosepect.com
Privacy Policy           https://prosepect.com/privacy
Terms of Service         https://prosepect.com/terms
Authorized domain        prosepect.com
```

Verify domain ownership using a Google Cloud project owner or editor in Google Search Console. Submit brand and sensitive-scope verification with an English-language video showing the full OAuth consent screen, the exact requested Calendar scopes, and the user-facing synchronization workflow. Keep production in Testing and `INVITE_ONLY=true` until Google approves it.

## Docker Compose

Validate and start the self-hosted stack:

```bash
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 api worker
```

The stack includes PostgreSQL, MinIO, API, worker, and web services. Caddy proxies `/api`, `/docs`, and the OpenAPI document to the API. Configure TLS and the public hostname in an upstream reverse proxy or replace the local Caddy listener.

`S3_ENDPOINT` is the API-to-object-storage address. `S3_PUBLIC_ENDPOINT` is placed into signed browser download URLs. Compose uses `http://minio:9000` internally and publishes MinIO on loopback as `http://localhost:9000`. MinIO and R2 use path-style requests in the supplied configuration, so `S3_VIRTUAL_HOSTED_STYLE=false`.

Do not publish PostgreSQL directly. A production reverse proxy should expose only the web application, API paths, and the configured object-storage hostname.

## Health, metrics, and logs

- `GET /health` checks the API process.
- `GET /ready` checks PostgreSQL.
- `GET /metrics` returns Prometheus text metrics.
- API logs carry request IDs and structured production logs.

Important metrics include:

- `prosepect_http_requests_total`
- `prosepect_http_request_duration_seconds`
- `prosepect_api_errors_total`
- `prosepect_synchronization_duration_seconds`
- `prosepect_sync_jobs_total`
- `prosepect_sync_job_failures_total`
- `prosepect_notification_deliveries_total`

Alert on sustained readiness failure, API 5xx responses, failed synchronization jobs, and a growing `sync_jobs` pending/failed backlog. PostgreSQL contains job errors, synchronization conflicts, and tenant-scoped activity history.

## Owner Operations dashboard

`/operations` is a read-only service-wide snapshot, not a monitoring platform. It does not change invite-only access, retry jobs, or perform destructive actions.

### Grant access

1. Identify the intended owner's **existing immutable account UUID**. The signed-in account's `user.id` is available in its own authenticated `GET /api/v1/session` response; verify that it belongs to the intended account using your trusted account-management process. Never use an email, the first registered user, a Google subject, or a client-supplied admin flag as the allowlist identity.
2. Set `ADMIN_USER_IDS` in the API runtime configuration to that UUID. Comma-separated UUIDs are supported if more than one owner must be explicitly authorized. Whitespace is trimmed; duplicates are harmless.
3. Restart/redeploy the API through your normal reviewed release process. Removing a UUID and restarting revokes access. No migration or production configuration is performed by this implementation.

Unset or whitespace-only `ADMIN_USER_IDS` denies everyone. Malformed members, including a trailing comma, fail configuration/startup instead of being ignored. Do not put this variable in frontend `VITE_*` configuration. Keep `ALLOW_INSECURE_DEV_AUTH=false` in hosted environments: existing development authentication permits impersonation and is only for trusted local development. Production configuration already rejects that mode.

### Security boundary

- `GET /api/v1/operations` uses the existing `CurrentUser` session authentication, then checks the server-side UUID allowlist through `OperationsAdmin` **before** database probing or any cross-tenant aggregate query. Missing authentication returns 401; a valid non-owner session returns 403. Development identity headers are ignored when development authentication is disabled.
- `GET /api/v1/operations/capability` is authenticated and returns only a JSON boolean for navigation. A hidden link is not authorization; direct API and page access are still checked.
- Successful responses use `Cache-Control: no-store`. The ordinary session and Google status contracts are not extended with administrative aggregates. No account lists, emails, task titles, raw job errors, provider responses, credentials, or storage keys are returned.
- Session authentication itself requires PostgreSQL. If it fails, the API fails closed with the existing sanitized error; it cannot safely return an authenticated degraded snapshot. If the database fails **after** authorization, a bounded probe produces an unavailable database status and null metrics. If the probe succeeds but the aggregate query fails/times out, database remains responding while metrics are null/unknown. Neither case becomes a zero count.

### What the snapshot means

- **API response** means this authorized snapshot request was answered, not an uptime percentage or historical error rate. **Database probe** is `SELECT 1`. Probe and aggregate query each have a five-second timeout; there is no external provider probe.
- **As of** is the response observation time. Account, file, and job counters are read in one PostgreSQL statement/snapshot after the probe.
- **Accounts** counts all currently registered user rows. A null account cap accurately means unlimited/not configured; it is not zero. Existing accounts may sign in when a configured cap is reached.
- **File usage** sums database attachment metadata across all tenants, using the same definition as quota enforcement. It is not an R2 bucket inventory, orphan-object count, proof of readable objects, or provider billing measurement. Global, per-account, and per-file limits are the API's actual configured limits.
- **Current queue**: pending, running, and failed jobs with fewer than 8 attempts (retryable, including future backoff). Running can include a stale lease pending recovery. Oldest waiting uses original creation time among pending/retryable jobs, not time overdue; null means no waiting jobs.
- **All time** means all retained job rows, not an immutable historical ledger. Final failures have at least 8 attempts; they remain counted even after later successes. Account/calendar deletion can remove job history. Completed counts use `status = 'succeeded'`; the latest completed timestamp is `updated_at`, written by `complete_sync_job`. Null means no retained completed job. Jobs include discovery, watch, synchronization, and credential revocation, so a completion never proves all calendars/providers healthy. A GitHub worker HTTP trigger returning 200 is not provider success.
- **Unknown/not verified**: live R2 health, backups and restore evidence, external alert delivery, budget, provider billing. The dashboard does not collect those signals or claim they work.

### Use and limitations

The page polls every 60 seconds after a request finishes, only while mounted and visible. Requests do not overlap; hiding/unmounting cancels in-flight requests, and late results are ignored. Requests time out after 15 seconds. Failures retain the previous snapshot with a stale warning and a retry button; authorization denial clears it. A degraded response replaces old numbers with unknowns. Last successful refresh records receipt of a snapshot (which can itself be degraded), not overall service health.

For final failures or persistent waiting work, inspect worker logs through your normal authorized operational workflow and verify Google integration configuration. Do not share raw provider errors or tokens. For capacity issues, review the relevant provider console before changing limits. This page has no job controls and sends no alerts when closed.

Known static links (authentication and provider permissions still apply):

- API hosting and logs: <https://dashboard.render.com/>
- Hosted database and recovery settings: <https://console.neon.tech/>
- Cloudflare/R2 storage and billing: <https://dash.cloudflare.com/>
- Google integration configuration and quotas: <https://console.cloud.google.com/>
- Worker workflow runs: <https://github.com/danarrigo/prosepect/actions>

No historical metrics pipeline, billing integration, backup verification or custom control plane is included. Aggregate scans may need revisiting if retained job volume grows substantially; this first slice intentionally adds no schema/index migration.

### Validation / generated contract

Backend tests cover allowlist parsing, session authorization, spoofed development-header rejection, empty deny-all, privacy, cross-tenant counts, empty data, and database-down fail-closed/degraded behavior. Run them in the normal remote CI PostgreSQL environment. Do not infer backend validation from frontend mocks.

The new OpenAPI paths/schemas are declared in Rust source. `apps/web/src/api/operations.ts` is a temporary narrow, source-matched contract and credentialed GET adapter pending remote OpenAPI generation. Generated `openapi/openapi.json` and `apps/web/src/api/schema.d.ts` were deliberately not edited manually. Before publication, regenerate them remotely and replace the temporary contract/adapter with generated types and the shared typed client.

## Worker behavior

The worker:

1. enqueues selected Google calendars that have not synchronized recently and writable-calendar watches expiring within 24 hours;
2. claims one job with `FOR UPDATE SKIP LOCKED`;
3. leases it for two minutes;
4. refreshes credentials when required;
5. applies the configured conflict policy;
6. mirrors scheduled tasks through linked Google events while keeping tasks and events distinct;
7. records user-visible activity in PostgreSQL;
8. retries transient failures with bounded exponential backoff.

The API uses the same durable queue immediately after local calendar or scheduled-task mutations. Completing a task retains its historical time block; unscheduling or deleting it removes the Google event. Authenticated Google webhook notifications enqueue the affected calendar without trusting provider payload data.

Run one claim for diagnostics:

```bash
cargo run -p prosepect-api --bin worker -- --once
```

Run the long-lived worker without `--once` for Docker Compose or a future server. Jobs are idempotent per tenant, and a failed worker can restart safely after its lease expires.

## Backups and migration to a server

Back up both persistent storage classes together:

1. PostgreSQL, which owns product data, jobs, conflicts, and activity.
2. S3-compatible objects referenced by PostgreSQL file metadata.

Example local backup commands:

```bash
docker compose exec -T postgres pg_dump -U prosepect -Fc prosepect > prosepect-postgres.dump
docker compose run --rm --entrypoint /bin/sh -v "$PWD/backups:/backup" minio-init -c \
  'mc alias set local http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" && mc mirror local/prosepect /backup/objects'
```

For the hosted beta, use `pg_dump` against Neon and copy R2 objects to an independent encrypted disk or storage account. The database provider's short point-in-time recovery window and R2 itself are not independent backups. Example direct commands are:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=prosepect-postgres.dump
aws s3 sync "s3://$S3_BUCKET" prosepect-r2-backup \
  --endpoint-url "$S3_ENDPOINT" \
  --region auto
```

Keep the dump, object copy, and the credentials needed to decrypt them outside the production providers. To migrate to a server, disable the GitHub synchronization workflow, restore the PostgreSQL dump, copy R2 objects into MinIO, configure the same environment contract, deploy Compose, and then switch DNS.

Test restores in an isolated environment. Restore PostgreSQL first and objects second, then start the synchronization worker.

## Google integration recovery

- A `410 Gone` sync-token response triggers one bounded full pull and stores the replacement token only after successful processing.
- `429` and provider `5xx` responses retry and honor `Retry-After`.
- Unresolved `ask` conflicts remain visible in Settings and block silent overwrite for that mapping.
- Webhook channels use random verification tokens stored only as hashes and are renewed before expiration.
- Disconnecting Google queues provider revocation, which stops known webhook channels before deleting encrypted credentials and Google-backed canonical calendars.

If credentials become invalid, reconnect Google Calendar from Settings. Never inspect or copy encrypted token columns into logs.

## Upgrades

Before deployment:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
npm run format:check:web
npm run typecheck:web
npm run lint:web
npm run test:web
npm run build:web
docker compose config --quiet
```

Take a backup, deploy the reviewed release, and monitor API and worker logs. The API and worker apply forward-only SQLx migrations during startup. Never edit an already deployed migration or `CHANGELOG.md`.
