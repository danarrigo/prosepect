#!/usr/bin/env bash
# DESTRUCTIVE ONLY TO THIS SCRIPT'S RANDOM, SYNTHETIC CI PROJECTS.
# Run on a disposable remote Docker runner, never an operator installation.
set -euo pipefail
[[ ${PROSEPECT_DISPOSABLE_CI:-} == yes ]] || { echo 'Requires PROSEPECT_DISPOSABLE_CI=yes on a disposable runner.' >&2; exit 1; }
cd "$(dirname "$0")/../.."
umask 077
work=$(mktemp -d)
project="prosepect-ci-$(openssl rand -hex 6)"
recovery="prosepect-rehearsal-$(openssl rand -hex 6)"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH="$PWD/scripts/personal"
python3 - "$work" <<'PY'
from pathlib import Path
import hashlib, secrets, sys
from configure import write_env
from test_personal import synthetic
p = Path(sys.argv[1])
write_env(p / 'installation.env', synthetic())
token, csrf = secrets.token_hex(32), secrets.token_hex(32)
(p / 'auth.curl').write_text(f'header = "Cookie: prosepect_session={token}"\nheader = "x-csrf-token: {csrf}"\n')
(p / 'fixture.sql').write_text(f"""
INSERT INTO users (id,email,display_name) VALUES
('00000000-0000-4000-8000-000000000001','owner@example.test','Synthetic recovery marker');
INSERT INTO sessions (token_hash,user_id,csrf_token,expires_at) VALUES
(decode('{hashlib.sha256(token.encode()).hexdigest()}','hex'),
'00000000-0000-4000-8000-000000000001','{csrf}',NOW()+INTERVAL '1 hour');
""")
(p / 'payload.bin').write_bytes(b'prosepect synthetic recovery bytes\x00\x01\xff\n')
PY
base=(docker compose --env-file "$work/installation.env" -p "$project" -f deploy/personal/compose.yaml)
stack=("${base[@]}" -f deploy/personal/tests/compose.yaml)
cleanup() {
  # No general-purpose cleanup helper: only randomly named test-owned projects.
  "${stack[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  if [[ -f "$work/restored/compose.yaml" ]]; then
    docker compose --env-file "$work/restored/installation.env" -p "$recovery" -f "$work/restored/compose.yaml" down --volumes >/dev/null 2>&1 || true
  fi
  for name in caddy-data caddy-config; do docker volume rm "${recovery}_${name}" >/dev/null 2>&1 || true; done
  rm -rf "$work"
}
trap cleanup EXIT
"${stack[@]}" config --quiet
"${stack[@]}" config --format json > "$work/config.json"
python3 - "$work/config.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
for name, service in c['services'].items():
    if name != 'web': assert not service.get('ports'), name
assert {int(p['published']) for p in c['services']['web']['ports']} == {80,443}
for name in ('api','worker'):
    e = c['services'][name]['environment']
    for key,value in {'APP_ENV':'production','ALLOW_INSECURE_DEV_AUTH':'false','INVITE_ONLY':'true','MAX_USER_ACCOUNTS':'1','S3_PUBLIC_ENDPOINT':'https://storage.prosepect.test'}.items():
        assert e[key] == value, (name,key)
    for key in ('GOOGLE_CLIENT_ID','TOKEN_ENCRYPTION_KEY','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY'):
        assert e[key], (name,key)
assert c['networks']['default']['internal'] is True
PY
"${stack[@]}" build
"${stack[@]}" up -d --wait --wait-timeout 180 api
python3 scripts/personal/invite.py --env "$work/installation.env" --project "$project"
python3 scripts/personal/invite.py --env "$work/installation.env" --project "$project"
sql() { "${stack[@]}" exec -T postgres psql -X -U prosepect -d prosepect -v ON_ERROR_STOP=1 -Atq; }
[[ $(printf "SELECT COUNT(*) FROM account_invites WHERE email='owner@example.test';" | sql) == 1 ]]
# No owner is created by the invite helper. Synthetic session ONLY in this CI DB.
[[ $(printf 'SELECT COUNT(*) FROM users;' | sql) == 0 ]]
sql < "$work/fixture.sql"
"${stack[@]}" up -d --wait --wait-timeout 180 web
for attempt in {1..60}; do
  if docker cp "$("${stack[@]}" ps -q web):/data/caddy/pki/authorities/local/root.crt" "$work/root.crt" 2>/dev/null; then break; fi
  sleep 1
done
[[ -s "$work/root.crt" ]]
https=(curl --silent --show-error --max-time 10 --noproxy '*' --cacert "$work/root.crt" --resolve app.prosepect.test:443:127.0.0.1 --resolve storage.prosepect.test:443:127.0.0.1)
status() {
  local expected=$1; shift
  local actual
  actual=$("${https[@]}" -o "$work/body" -w '%{http_code}' "$@")
  [[ "$actual" == "$expected" ]] || { echo "Expected HTTP $expected; got $actual" >&2; exit 1; }
}
status 200 https://app.prosepect.test/ready
status 200 https://app.prosepect.test/health
status 200 https://app.prosepect.test/api-doc/openapi.json
status 200 https://app.prosepect.test/settings
[[ $(curl --silent --max-time 10 --noproxy '*' --resolve app.prosepect.test:80:127.0.0.1 -o /dev/null -w '%{http_code}' http://app.prosepect.test/ready) == 308 ]]
status 401 https://app.prosepect.test/api/v1/session
status 401 https://app.prosepect.test/api/v1/operations
status 401 -X POST https://app.prosepect.test/api/v1/development/session
status 401 -H 'x-prosepect-user-id: 00000000-0000-4000-8000-000000000001' https://app.prosepect.test/api/v1/session
status 403 'https://app.prosepect.test/api/v1/auth/google/callback?error=access_denied'
status 403 -X POST https://app.prosepect.test/webhooks/google/calendar
# Invalid consent is rejected before OAuth discovery. Changing spoofed XFF must
# NOT evade the ten-attempt limiter: the eleventh request still returns 429.
for attempt in {1..11}; do
  expected=422; [[ $attempt == 11 ]] && expected=429
  status "$expected" -H "X-Forwarded-For: 203.0.113.$attempt" -H "X-Real-IP: 192.0.2.$attempt" \
    'https://app.prosepect.test/api/v1/auth/google/start?terms_version=invalid&privacy_version=invalid&age_confirmed=true'
done
status 201 --config "$work/auth.curl" -F "file=@$work/payload.bin" https://app.prosepect.test/api/v1/files
file_id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$work/body")
status 307 --config "$work/auth.curl" -D "$work/download.headers" "https://app.prosepect.test/api/v1/files/$file_id/download"
python3 - "$work" <<'PY'
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import sys
p = Path(sys.argv[1])
url = next(line.split(':',1)[1].strip() for line in (p/'download.headers').read_text().splitlines() if line.lower().startswith('location:'))
u = urlsplit(url)
assert u.scheme == 'https' and u.netloc == 'storage.prosepect.test'
assert u.path.startswith('/prosepect/') and 'X-Amz-Signature' in parse_qs(u.query)
assert 'host' in parse_qs(u.query)['X-Amz-SignedHeaders'][0]
assert '"' not in url and '\\' not in url
(p/'download.curl').write_text(f'url = "{url}"\n')
(p/'object-key').write_text(u.path.removeprefix('/prosepect/'))
PY
status 200 --config "$work/download.curl"
cmp "$work/payload.bin" "$work/body"
status 403 "https://storage.prosepect.test/prosepect/$(cat "$work/object-key")"
status 403 https://storage.prosepect.test/prosepect/
# Prove a long-lived production worker persists a deterministic LOCAL failure.
# With API stopped there is no dispatcher race; missing calendar fails before Google.
"${stack[@]}" stop api
printf "INSERT INTO sync_jobs (id,user_id,kind,idempotency_key) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','calendar_watch','synthetic-worker');" | sql
"${stack[@]}" up -d --no-deps worker
for attempt in {1..60}; do
  [[ $(printf "SELECT status FROM sync_jobs WHERE idempotency_key='synthetic-worker';" | sql) == failed ]] && break
  sleep 1
done
[[ $(printf "SELECT COUNT(*) FROM sync_jobs WHERE idempotency_key='synthetic-worker' AND status='failed' AND attempt_count>=1 AND last_error LIKE '%%requires a calendar%%';" | sql) == 1 ]]
printf "UPDATE sync_jobs SET available_at=NOW()+INTERVAL '1 day' WHERE idempotency_key='synthetic-worker';" | sql
"${stack[@]}" restart worker
[[ $(printf "SELECT status FROM sync_jobs WHERE idempotency_key='synthetic-worker';" | sql) == failed ]]
"${stack[@]}" start api
"${stack[@]}" up -d --wait --wait-timeout 180
# Explicitly prove production rejects insecure auth configuration at startup.
if "${stack[@]}" run --rm --no-deps -e ALLOW_INSECURE_DEV_AUTH=true api > "$work/rejected.log" 2>&1; then
  echo 'Production incorrectly accepted insecure authentication' >&2; exit 1
fi
grep -q 'ALLOW_INSECURE_DEV_AUTH cannot be enabled in production' "$work/rejected.log"
python3 scripts/personal/snapshot.py backup "$work/snapshot" --env "$work/installation.env" --project "$project"
python3 scripts/personal/snapshot.py restore "$work/snapshot" "$work/restored" --project "$recovery"
restored=(docker compose --env-file "$work/restored/installation.env" -p "$recovery" -f "$work/restored/compose.yaml")
[[ $(printf "SELECT display_name FROM users WHERE id='00000000-0000-4000-8000-000000000001';" | "${restored[@]}" exec -T postgres psql -X -Atq -U prosepect -d prosepect) == 'Synthetic recovery marker' ]]
[[ $(printf "SELECT status FROM sync_jobs WHERE idempotency_key='synthetic-worker';" | "${restored[@]}" exec -T postgres psql -X -Atq -U prosepect -d prosepect) == failed ]]
# Read the actual restored bytes through MinIO's authenticated S3 interface.
[[ $(docker network inspect "${recovery}_default" --format '{{.Internal}}') == true ]]
docker compose --env-file "$work/installation.env" -p "$recovery" -f deploy/personal/compose.yaml \
  run --rm --no-deps -T --entrypoint /bin/sh minio-init -ec \
  'export MC_HOST_local="http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@minio:9000"; read -r key; mc cat "local/prosepect/$key"' \
  <<< "$(cat "$work/object-key")" > "$work/restored.bin"
cmp "$work/payload.bin" "$work/restored.bin"
[[ $(docker network inspect "${recovery}_default" --format '{{.Internal}}') == true ]]
# Existing resource/config reuse must fail closed, without modifying the restore.
if python3 scripts/personal/snapshot.py restore "$work/snapshot" "$work/second-restore" --project "$recovery" 2>/dev/null; then
  echo 'Restore wrongly reused an existing project' >&2; exit 1
fi
echo 'PASS: production HTTPS routes/auth/storage, spoof-resistant XFF, owner invite, worker persistence, matched DB+file restore.'
echo 'Google sign-in, public DNS/ACME and physical phone access remain MANUAL live gates.'
