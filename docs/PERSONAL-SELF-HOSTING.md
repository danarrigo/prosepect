# One person, one private Linux server

This package is for **one owner**, not a public signup service. It leaves development Compose and Render/Vercel unchanged. You operate the server, DNS, Google OAuth client, and backups. Google login is required; there is no password, development-login fallback, or automatic admin grant.

## Before you start

Recommended path: one **already provisioned Linux VPS** (Ubuntu 24.04 LTS, x86-64 or ARM64 supported by the images), accessed over SSH from your WSL terminal/tmux. Allow several GB of RAM and free disk for Rust/Node image builds, database, images, uploads and at least two complete snapshots. A small VPS may need a larger temporary build allocation; no free-tier capacity promise is made. Install Docker Engine with the Compose v2 plugin from <https://docs.docker.com/engine/install/ubuntu/>, Python **3.11+**, Git, and `age`. Docker access is effectively root access: restrict server accounts and SSH keys.

You need:

- One DNS hostname you control, e.g. `plan.example.net`. Point its **A record** at the server. Add AAAA only if IPv6 actually reaches it. Use ordinary DNS, not an additional CDN/proxy.
- Public inbound **TCP 80 and 443**, and outbound HTTPS/DNS for Google and certificate issuance. Restrict SSH to your administrative source if possible. Docker-published ports can bypass some UFW rules: enforce the VPS/network firewall too. Only the web service publishes ports; do not expose PostgreSQL or the API directly.
- Ports 80/443 free on this server. Caddy automatically obtains/renews public certificates and persists its certificate state. UDP 443 is not required by this package.
- Your own Google account and web OAuth client. This is manual Google setup, not one-click approval.

Home hosting additionally needs a reachable public IP and router forwarding. CGNAT, blocked inbound ports, or private-only DNS are **not solved** by this package. Prefer the VPS path; no VPN, tunnel, domain purchase or provider signup is automated here.

## 1. Configure Google in your browser

Use your own Cloud project; do not reuse hosted Prosepect credentials. Keep secrets out of chat, screenshots, shell commands and terminal history.

1. Select/create a project at <https://console.cloud.google.com/projectcreate>.
2. Enable **Google Calendar API** at <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>.
3. Open **Google Auth Platform → Branding** at <https://console.cloud.google.com/auth/branding>. Supply the app name, your support/contact email, and your authorized domain. Where Google requires homepage/privacy/terms URLs, use `https://plan.example.net`, `/privacy`, `/terms`. Review those pages yourself: existing project legal text is not customized legal advice or an automatic statement of your own hosting policy.
4. Under **Audience**, <https://console.cloud.google.com/auth/audience>, use External unless your eligible Workspace organization supports Internal. Start in **Testing**, and add exactly your owner Google account as a test user. This Google test-user list is separate from the database invite below.
5. Under **Data Access**, <https://console.cloud.google.com/auth/data-access>, configure `openid`, email and profile. Calendar connection later requests `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.calendarlist.readonly` incrementally.
6. Under **Clients**, <https://console.cloud.google.com/auth/clients>, create an OAuth client of type **Web application**. Authorized JavaScript origin: `https://plan.example.net`. Authorized redirect URI, **exactly**: `https://plan.example.net/api/v1/auth/google/callback`. Do not use an IP, HTTP, or a trailing slash. Save the client ID and secret in your password manager. The webhook is `https://plan.example.net/webhooks/google/calendar`; it is not an OAuth redirect URI.

**Testing limitation:** External apps in Testing issue refresh tokens that generally expire after **7 days** when Calendar scopes are granted (basic identity-only scopes are an exception). Expect to reconnect Calendar; Testing is not durable unattended Calendar authorization. See <https://developers.google.com/identity/protocols/oauth2#expiration>.

Publishing to Production is a separate operator action, **not Google verification**. Personal-use apps may qualify for Google's verification exceptions but can still show an unverified-app warning and have user limits; Workspace policy may block them. A wider/public app using sensitive Calendar scopes generally needs domain ownership proof, consent/branding review, scope justification and a demonstration video before Google approval. Follow the actual console requirements and <https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance>. This guide neither promises an exception nor approval, and never disables invite-only access to get it.

## 2. Create private configuration

Work from a checkout of a reviewed **commit or release**, not a floating development branch. Keep the checkout available: image builds use its source. In its root:

```bash
python3 scripts/personal/configure.py
python3 scripts/personal/configure.py --check
```

The short prompts ask for one hostname, the one owner email and Google client credentials (secret input hidden). The helper generates a high-entropy PostgreSQL password and a separate 32-byte credential-encryption key. It exclusively creates ignored `.env.personal`, owned by you with mode **0600**, without printing secrets. Rerunning refuses to replace it or rotate keys. `--check` validates existing configuration and Compose without revealing it. Resolve invalid inputs in your private editor, maintaining 0600; do not `source`/`eval` this file or run verbose `docker compose config` (it prints secrets).

Keep `TOKEN_ENCRYPTION_KEY` for the lifetime of the encrypted Google credentials. Losing/replacing it makes existing tokens unreadable. Editing PostgreSQL's password in the file does not rotate an already initialized database's password. Never rerun initial setup as a credential-repair strategy.

Use this shell function for the remaining commands, **from the checkout root**. Clearing inherited exports prevents an old development env from overriding the private file; Docker uses the default local VPS daemon.

```bash
pc() {
  env -i PATH="$PATH" HOME="$HOME" docker compose \
    --env-file "$PWD/.env.personal" -p prosepect-personal \
    -f deploy/personal/compose.yaml "$@"
}
pc config --quiet
pc build
```

Fixed runtime defaults: production, insecure development auth off, invite-only, **one account**, 25 MiB per file and 1 GiB total/per-owner metadata-accounted file quota. Quotas are not whole-disk limits: reserve space for database growth, object metadata/orphans, logs and snapshots. PostgreSQL/Google and explicit local-storage settings are supplied to **both API and worker**. Operations access is empty by default.

## 3. Bootstrap the only invite before exposing login

```bash
# Migrates the database and mounts private file storage; no public web yet.
pc up -d --wait --wait-timeout 180 api
python3 scripts/personal/invite.py
# Only after bootstrap succeeds:
pc up -d --wait --wait-timeout 180
pc ps
```

The invite helper reads only the configured owner email, inserts it idempotently under the existing account-cap advisory lock, and refuses a running web service or another invited/registered email. It grants **no session or admin access**. The normal Google callback enforces the invite; existing registration code serializes the one-account cap transactionally. Do not manually invite additional people. Changing the owner is not a supported email-edit shortcut.

The project name is part of the storage identity: `prosepect-personal_postgres-data`, `_files-data`, `_caddy-data`, `_caddy-config`. Restart/rebuild uses those same named volumes. Never change `-p` casually or use `down -v` on your installation.

Caddy routes `/api/*` (including Google login/callback), `/webhooks/google/calendar`, `/api-doc/*`, `/docs*`, `/health` and `/ready` to the private API. It overwrites client-supplied forwarded addresses with the connection's IP, matching the backend's first-XFF semantics. Do not add another proxy without revisiting this trust boundary. Unpublished container networks are not a boundary against root/Docker administrators.

Attachments live in the **private `files-data` Docker volume**, mounted only in the non-root API at `/data/files`. A fresh volume inherits the image's API-owned 0700 directory. Caddy never mounts or serves that volume. Every download uses the existing HTTPS API route, requires a session and checks that the file belongs to that account before reading bytes; there are no public objects or bearer download links. The worker receives the same storage configuration but does not need access to attachment bytes. There is no separate storage hostname/service/account and no Caddy request access logging.

The package explicitly sets `FILE_STORAGE_BACKEND=local` and `FILE_STORAGE_PATH=/data/files`. Production still requires S3 by default when that selector is absent. Explicit local mode requires an absolute directory below root, without parent traversal, and rejects mixed S3 settings; unknown selectors fail startup. Persistence is an operator/mount responsibility: do not replace the volume with an ephemeral container directory. For compatibility, an absent selector keeps the old precedence: complete S3 credentials select S3 even if an unused `FILE_STORAGE_PATH` is present. The new explicit modes reject competing nonempty settings (blank placeholders are ignored); a path alone never enables production local storage. Hosted S3 and development defaults otherwise remain unchanged. This package does not convert an existing S3/MinIO installation or accept its old configuration/snapshot format; do not delete/rekey an existing installation to bypass validation.

## 4. Live acceptance gate (you must do this)

Synthetic CI is not proof of public DNS, a public certificate or Google authorization. Before relying on the instance, use your **phone on mobile data**, not home Wi-Fi:

- Open the app hostname; verify a valid public certificate and no browser warnings. Check `https://plan.example.net/ready`.
- Sign in as the invited Google account, accepting the existing consent/age checks. Confirm a non-invited account cannot register. Do not weaken invite/cap settings for troubleshooting.
- Create a task/note; upload an attachment and download it. Confirm the download uses the **same app HTTPS hostname** with a valid certificate, and the download URL in a signed-out/private browser cannot read the attachment.
- Connect Calendar in Settings, verify the real consent scopes and synchronize a disposable event in both directions. Check it after a worker restart. Testing's seven-day limit still applies.
- Complete an encrypted off-server backup and isolated restore rehearsal below. Record the commit, image digests, date and successful DB/file comparisons somewhere private.

For startup failures inspect `pc ps` and privately inspect `pc logs --tail=100 api worker web`. Do not post raw provider errors, env files, tokens, private attachments or database dumps. A healthy worker container is only process liveness, not proof of successful Google synchronization.

Optional **separate operator action**: after successful login, obtain your own immutable `user.id` UUID from authenticated `/api/v1/session`, verify it, and privately set `ADMIN_USER_IDS=<that UUID>` in `.env.personal`. Then `python3 scripts/personal/configure.py --check` and `pc up -d api`. This is never inferred from your email or first registration. See [Operations authorization](OPERATIONS.md#owner-operations-dashboard).

## Backup: matched database, blobs, settings and encryption key

Schedule this yourself when convenient; no cron/control plane is installed. Use an encrypted local filesystem if possible. Allow downtime and free space for the SQL dump, **entire private files volume**, certificate state, plus encrypted archive. Large archives need proportional disk/time. Stop any independent scripts that write directly to SQL or the files volume; the helper quiesces this Compose stack only. Do not change settings while it runs.

```bash
mkdir -p "$HOME/prosepect-backups"
# Choose a NEW directory each time, outside the checkout; never reuse a name.
python3 scripts/personal/snapshot.py backup "$HOME/prosepect-backups/2026-09-05-before-upgrade"
```

The helper stops public ingress, API and worker (up to 60s graceful stop), runs custom-format `pg_dump` while PostgreSQL stays up, and archives the quiescent private files volume plus cold Caddy state. It saves `.env.personal`, source commit, image IDs/repository digests, PostgreSQL version and SHA-256 checksums; the completion manifest is written **last**. Previously running services are restarted on success. File archives preserve numeric ownership and permissions; the manifest records the file directory's UID:GID plus API/worker image metadata. Restore and promotion must retain the API user's access to this directory (normally 0700), never solve permission failures with world-writable files. PostgreSQL is a logical dump, restored without source ownership/ACLs to the fresh `prosepect` role/database, not a raw filesystem/CPU-dependent copy. Use a clean reviewed checkout so the recorded commit describes your source.

**On any failure:** partial files remain private, no volumes are deleted, writers may remain stopped. Do not use an incomplete snapshot. Resolve disk space/tool errors, check `pc ps`, and deliberately `pc start api worker web` to resume the old installation if safe. Rerun into a new directory. If restart alone failed after the manifest was completed, the snapshot can be verified independently. No failed procedure is reported as a completed protected backup.

### Encrypt, verify and copy off-server

The staging directory is 0700 and files 0600, but is **plaintext sensitive data**, not an offsite/protected backup. Anyone with server root can read your data, Google encryption key and database password. Checksums detect accidental corruption, **not authenticity**.

With `age` installed, run in a private terminal (no tracing). Pick a new output filename; `noclobber` prevents silently replacing an earlier archive. `age -p` prompts securely; never put the passphrase in argv/environment. Store the strong passphrase separately in your password manager/offline recovery record.

```bash
umask 077
set -o pipefail
set -o noclobber
backup="$HOME/prosepect-backups/2026-09-05-before-upgrade"
tar -C "$backup" -cf - . | age -p > "$backup.tar.age"
# Verify authentication/decryption and archive readability, prompted again:
age -d "$backup.tar.age" | tar -tf - > /dev/null
# Copy to YOUR existing independent destination, e.g. your other machine:
scp "$backup.tar.age" your-user@your-other-machine:/your/private/backup-directory/
```

Verify the copied ciphertext SHA-256 against the local file, and periodically decrypt/rehearse **from the off-server copy**. No new storage account is required. A disk on the same VPS is not off-server recovery. Retain multiple known-good generations; don't discard the previous verified generation after one untested backup. Plaintext removal is your explicit action only after encryption/off-server verification. `rm` does not securely erase SSD/COW/provider snapshots; encrypted disks and controlled retention are needed. Protect the decryption passphrase separately from the backup, and retain the source commit/repository for rebuilding.

## Restore FIRST into an isolated fresh project

Use the same reviewed package revision initially. The helper restores into **new** project-scoped volumes and a new private settings directory, refusing existing project/container/network/volume names and config paths. It checks exact artifact names, checksums, env permissions, and all volume archive paths/types (no links, traversal or devices) **before extraction**. Only restore trusted archives whose origin you know; checksums are not a signature. To recover an encrypted copy, authenticate/decrypt it to a private new directory on an encrypted filesystem; don't blindly extract an untrusted outer tarball.

For an encrypted off-server copy, first decrypt **fully** into a new private file (an authentication failure must stop here). From the checkout root, the following extracts only the exact expected regular files, never archive-supplied links or paths. Keep `noclobber` enabled and choose new names:

```bash
umask 077
set -o noclobber
age -d /path/to/off-server-copy.tar.age > "$HOME/prosepect-recovery.tar"
# Run ONLY after age succeeds. The destination must not exist.
python3 - "$HOME/prosepect-recovery.tar" "$HOME/prosepect-recovered-snapshot" <<'PY'
from pathlib import Path, PurePosixPath
import shutil, sys, tarfile
sys.path.insert(0, 'scripts/personal')
from snapshot import ARTIFACTS, verify
with tarfile.open(sys.argv[1], 'r:') as archive:
    entries = [m for m in archive.getmembers() if not (m.name in ('.', './') and m.isdir())]
    names = [str(PurePosixPath(m.name)) for m in entries]
    assert len(names) == len(set(names)) and set(names) == {*ARTIFACTS, 'manifest.json'}
    assert all(m.isfile() and m.sparse is None for m in entries)
    destination = Path(sys.argv[2])
    destination.mkdir(mode=0o700)
    for name, member in zip(names, entries):
        with archive.extractfile(member) as source, (destination / name).open('xb') as output:
            shutil.copyfileobj(source, output)
    verify(destination)
PY
# Run ONLY after extraction and verification succeed:
backup="$HOME/prosepect-recovered-snapshot"
```

Keep `backup` set to that verified directory for every command below, including attachment verification and promotion. For a rehearsal from local plaintext staging instead, explicitly set `backup` to that staging directory first. Do not reuse a value from an earlier session.

```bash
python3 scripts/personal/snapshot.py restore \
  "$backup" \
  "$HOME/prosepect-rehearsal-config"
# Helper prints the fresh project name; project.txt also records it.
rehearsal=$(cat "$HOME/prosepect-rehearsal-config/project.txt")
rc() {
  env -i PATH="$PATH" HOME="$HOME" docker compose \
    --env-file "$HOME/prosepect-rehearsal-config/installation.env" \
    -p "$rehearsal" -f "$HOME/prosepect-rehearsal-config/compose.yaml" "$@"
}
rc ps
rc exec -T postgres psql -X -U prosepect -d prosepect <<'SQL'
SELECT COUNT(*) AS accounts FROM users;
SELECT COUNT(*) AS files FROM files;
SELECT COUNT(*) AS completed_migrations FROM _sqlx_migrations WHERE success;
SQL
```

The recovery network is **internal-only**, with no published ports, API, worker, Google dispatchers, notifications or webhooks. Pulling the recorded images is done by Docker before startup, outside that isolated runtime network. Do **not** start the application just to inspect production data: restored tokens can modify your real calendars. Caddy volumes are restored but Caddy is not started. Restore failure keeps partial resources for diagnosis; retry uses a fresh project/settings directory, not an in-place overwrite.

A successful `pg_restore` is insufficient. Privately check a known task/note, account UUID and file metadata; compare one or more known attachment contents/size/SHA-256 with the original. For a file, obtain its private `object_key` with `rc exec -T postgres psql -X -U prosepect -d prosepect` and a SELECT from `files` (don't share output). Read the corresponding private file through an isolated read-only volume helper, using the recorded API owner and the already downloaded PostgreSQL image. This starts no production service and has no network access:

```bash
# Read object key from your private terminal; output is sensitive plaintext.
read -r -p 'Known object key: ' object_key
restore_image=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["images"]["postgres"]["restore"])' "$backup/manifest.json")
file_owner=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["file_owner"])' "$backup/manifest.json")
# Inspect first: a typo must not silently create an empty Docker volume.
docker volume inspect "${rehearsal}_files-data" > /dev/null
docker run --rm -i --network none --user "$file_owner" --entrypoint /bin/sh \
  --mount "type=volume,src=${rehearsal}_files-data,dst=/files,readonly" "$restore_image" -ec \
  'read -r key; case "$key" in *[!0-9a-f-]*|"") exit 1;; esac; cat "/files/$key"' \
  <<< "$object_key" > "$HOME/restored-attachment.bin"
sha256sum "$HOME/restored-attachment.bin" /path/to/known-original-file
rc stop
```

Do not delete rehearsal volumes automatically. Document the comparison results; explicitly decide when private rehearsal data can be removed. Recovery validation in CI performs an actual SQL marker and **byte-for-byte restored attachment** comparison, but your own backup requires your own rehearsal.

### Deliberate disaster-recovery promotion (not the default restore)

Only after verification, schedule an outage and decide whether this is the replacement server. **Stop the old web/API/worker and any other dispatchers first**, so only one instance can use live Google tokens. Keep the last verified backup untouched.

1. Use a fresh checkout of the snapshot's recorded commit. Retain its Google settings, hostname and `TOKEN_ENCRYPTION_KEY`; do not run the configuration generator again. Copy `installation.env` from the snapshot into the new checkout using exclusive creation, e.g. `(umask 077; set -o noclobber; cat "$backup/installation.env" > .env.personal)`. Never replace another installation's env.
2. In the fresh checkout create a **new** `recovered-images.yaml` override with `services.postgres.image` set to the exact `images.postgres.restore` digest from the manifest. The digest is not a secret. Keep PostgreSQL 16 for this first recovery. Rebuild the API at the recorded source revision and verify its non-root UID:GID matches `file_owner` before promotion; restored archive permissions are not reinitialized by Docker. Do not opportunistically upgrade storage or change file ownership while restoring.
3. `rc down` **without `-v`** stops the scratch services and removes only their isolated network/containers, retaining all restored volumes. This is the explicit boundary before enabling egress. Never run `down -v`.
4. From the new checkout run production Compose with `--env-file .env.personal -p "$rehearsal" -f deploy/personal/compose.yaml -f recovered-images.yaml config --quiet`, then `build`, then `up -d --wait --wait-timeout 180`, using the same cleared shell environment as `pc`. The exact restored project name is essential. A new normal network now permits Google egress; migrations run automatically. Do not have the old stack running concurrently.
5. If moving servers, change DNS only after checking the intended destination. Recheck certificates, Google redirect/webhook values, phone login, attachment bytes and Calendar synchronization. From now on use this project's explicit name and image override in every operation (snapshot helpers accept `--project`; their start/stop commands do not recreate containers).

This is forward recovery, not a merge of two live databases. Reverting an irreversible migration requires a separate fresh restore and may lose writes since the snapshot; switching an old image back is **not** a database rollback.

## Upgrade

1. Record the current reviewed commit and `pc ps`. Complete the matched snapshot above, encrypt/copy it off-server and verify an isolated restore. Read release/migration notes and ensure spare disk space. Pin the intended release to its reviewed commit, not `latest`.
2. During planned downtime, `pc stop web api worker`. Fetch/checkout that exact reviewed commit (`git fetch --tags`, then `git checkout --detach <reviewed-commit>`). Do not change `.env.personal` or the project name. Keep the snapshot's source revision and image digests.
3. Run `python3 scripts/personal/configure.py --check`, `pc build`, then `pc up -d --wait --wait-timeout 180`. Both binaries call `Store::connect`, which runs embedded SQLx migrations; API readiness gates the worker/web startup. Migrations are forward-only. Do not edit applied SQL files.
4. Check `pc ps`, readiness, private logs and the phone/attachment/Calendar smoke above. Query `_sqlx_migrations` for success if diagnosing startup. If startup/migration fails, keep ingress/writers paused and diagnose; do not promise rollback by checking out the old source. Use a fresh isolated restore if needed.

## What validation does and does not prove

`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/personal -p 'test_*.py' -v` runs safe local file/parser/archive tests without Docker. CI's bounded **personal-self-hosting** job builds and starts production configuration with disposable synthetic secrets, internal-only networking and a locally trusted Caddy test CA. It imports the **same production routing snippets**; it checks HTTPS/HTTP redirect, API/Google callback/webhook routing, anonymous 401, rejected dev auth, forwarded-IP spoof resistance, invite idempotence, configured cap, actual tenant-authenticated upload/download bytes, anonymous download denial and other-tenant denial. It also checks non-root file-volume ownership and file persistence after API container recreation. The test is designed to verify that a deterministic no-provider worker job failure persists across restart, then snapshot/restore and compare SQL and file bytes. The existing backend `account_capacity_limits_new_users_without_locking_out_existing_users` test checks the real cap behavior; the CI lifecycle job depends on that backend gate.

Passing results must come from the remote CI run for the reviewed revision; local parser/format checks are not runtime or recovery proof. No real OAuth/Google or public ACME calls are intended in that test, and its runtime network blocks provider egress. A synthetic fixture session is inserted only into the disposable CI database; it is not an operator login procedure. **Public DNS/ACME, physical phone access, Google consent/login and real Calendar token lifetime remain unverified until you perform the live gate.** Never run `smoke.sh` against an operator instance; it is guarded for a disposable remote CI Docker runner and deletes only its own random synthetic projects.
