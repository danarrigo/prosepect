# Prosepect operations

This guide covers the supported Docker Compose deployment and the hosted Vercel/Google Cloud deployment. TLS must terminate at the hosting platform or a trusted reverse proxy.

## Production configuration

Production startup intentionally fails unless these invariants hold:

- `APP_ENV=production`
- `ALLOW_INSECURE_DEV_AUTH=false`
- all Google OAuth variables are present
- `TOKEN_ENCRYPTION_KEY` decodes to exactly 32 bytes
- all required S3 variables are present
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
- Google Cloud Run runs the Axum API at `https://api.prosepect.com`.
- A Cloud Run Job executes `prosepect-worker --once` every 15 minutes through Cloud Scheduler.
- Neon PostgreSQL stores all canonical and operational state.
- A private Cloudflare R2 bucket stores attachments through presigned URLs.

A Google Cloud billing account is required even when usage remains within free allowances. Configure a billing alert. Free usage is not a hard spending cap.

### Guided setup

Run the checked-in wizard from the repository root:

```bash
./scripts/deploy-cloud-run.sh
```

The wizard opens each required dashboard, captures secrets with hidden input, stores resumable values in ignored `.env.deploy`, uploads runtime secrets to Google Secret Manager, builds the container through Cloud Build, and deploys the service and job. Do not commit `.env.deploy`.

The deployment intentionally constrains the API to:

- zero minimum instances;
- one maximum instance;
- one vCPU and 512 MiB memory;
- request-based Cloud Run service billing;
- a single worker task every 15 minutes.

These limits are appropriate for a personal beta and reduce accidental spend. Cold starts and delayed synchronization remain acceptable beta tradeoffs.

### Hosted resources

The wizard creates or configures:

- Artifact Registry repository `prosepect`;
- service account `prosepect-runtime`;
- scheduler identity `prosepect-scheduler`;
- Cloud Run service `prosepect-api`;
- Cloud Run Job and Scheduler job `prosepect-worker`;
- five Secret Manager secrets for PostgreSQL, Google, encryption, and R2 credentials.

`deploy/gcp/cloudbuild.yaml` builds both API and worker binaries into one image. The API uses the image default command. The job overrides it with `prosepect-worker --once`.

### Domains and OAuth

Use these canonical values:

```text
Frontend                  https://prosepect.com
API                       https://api.prosepect.com
Google redirect           https://api.prosepect.com/api/v1/auth/google/callback
CORS allowed origin       https://prosepect.com
```

The Google OAuth client must use the redirect URI exactly. The Vercel production environment must set `VITE_API_URL=https://api.prosepect.com`. Cloud Run domain mappings can take time to provision a managed certificate.

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

For the hosted beta, use `pg_dump` against Neon and copy R2 objects to an independent backup. To migrate to a server, restore the PostgreSQL dump, copy R2 objects into MinIO, configure the same environment contract, deploy Compose, and then switch DNS. Stop the Cloud Scheduler job before the final database cutover.

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
