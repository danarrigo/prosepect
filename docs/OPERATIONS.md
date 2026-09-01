# Prosepect operations

This guide covers the supported Docker Compose deployment and the hosted Vercel/Render deployment. TLS must terminate at the hosting platform or a trusted reverse proxy.

## Production configuration

Production startup intentionally fails unless these invariants hold:

- `APP_ENV=production`
- `ALLOW_INSECURE_DEV_AUTH=false`
- all Google OAuth variables are present
- `TOKEN_ENCRYPTION_KEY` decodes to exactly 32 bytes
- all required S3 variables are present
- `MAX_TOTAL_FILE_STORAGE_BYTES` is set below the provider's free storage allowance
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

## Hosted free-tier deployment

The supported hosted-beta topology is:

- Vercel serves the Vue application at `https://prosepect.com`.
- Render Free runs the Axum API at `https://api.prosepect.com`.
- GitHub Actions calls an authenticated API synchronization endpoint every 15 minutes.
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
BIND_ADDRESS                    0.0.0.0:10000
MAX_TOTAL_FILE_STORAGE_BYTES    5368709120
```

Generate `WORKER_TRIGGER_TOKEN` with `openssl rand -hex 32`, store the same value in Render and the GitHub secret `PROSEPECT_WORKER_TRIGGER_TOKEN`, and never put it in source control.

Attach `api.prosepect.com` as a Render custom domain and add the DNS record Render displays. Managed TLS provisioning can take time.

### Scheduled worker

`.github/workflows/worker.yml` calls `POST /internal/synchronization/run` at minutes 7, 22, 37, and 52 of each hour to avoid the busiest start-of-hour scheduling window. The API verifies a bearer token, enqueues due calendar work, and processes at most one claim. Overlapping runs are serialized. Scheduled runs use `curl` only: they do not compile Rust and do not start a worker container. The job remains skipped until `PROSEPECT_WORKER_ENABLED=true` and `PROSEPECT_WORKER_TRIGGER_TOKEN` is configured.

The same request also acts as an API availability check because network, authentication, or worker failures fail the workflow. The repository is public, so standard GitHub-hosted runners are free. Treat GitHub scheduling as best-effort, enable Actions failure notifications, and manually run the workflow after changing synchronization configuration.

### Domains and OAuth

Use these canonical values:

```text
Frontend                  https://prosepect.com
API                       https://api.prosepect.com
Google redirect           https://api.prosepect.com/api/v1/auth/google/callback
CORS allowed origin       https://prosepect.com
```

The Google OAuth client must use the redirect URI exactly. The Vercel production environment must set `VITE_API_URL=https://api.prosepect.com`.

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

## Worker behavior

The worker:

1. enqueues selected Google calendars that have not synchronized recently;
2. claims one job with `FOR UPDATE SKIP LOCKED`;
3. leases it for two minutes;
4. refreshes credentials when required;
5. applies the configured conflict policy;
6. records user-visible activity in PostgreSQL;
7. retries transient failures with bounded exponential backoff.

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
- Disconnecting Google queues provider revocation, then deletes encrypted credentials and Google-backed canonical calendars.

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
