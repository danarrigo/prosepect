ALTER TABLE calendars
    ADD COLUMN sync_token TEXT,
    ADD COLUMN last_synced_at TIMESTAMPTZ,
    ADD COLUMN last_sync_error TEXT;

CREATE TABLE external_event_mappings (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    calendar_id UUID NOT NULL REFERENCES calendars (id) ON DELETE CASCADE,
    canonical_event_id UUID REFERENCES calendar_events (id) ON DELETE SET NULL,
    provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
    external_calendar_id TEXT NOT NULL,
    external_event_id TEXT NOT NULL,
    external_etag TEXT,
    base_fingerprint TEXT,
    local_dirty BOOLEAN NOT NULL DEFAULT FALSE,
    local_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    conflict_state TEXT NOT NULL DEFAULT 'none' CHECK (conflict_state IN ('none', 'unresolved')),
    pending_resolution TEXT CHECK (pending_resolution IN ('google', 'prosepect', 'latest')),
    last_synced_at TIMESTAMPTZ,
    UNIQUE (user_id, provider, external_calendar_id, external_event_id),
    UNIQUE (canonical_event_id)
);

CREATE INDEX external_event_mappings_dirty_idx
    ON external_event_mappings (user_id, calendar_id)
    WHERE local_dirty OR local_deleted;

CREATE TABLE sync_jobs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    calendar_id UUID REFERENCES calendars (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('calendar_sync', 'calendar_discovery', 'credential_revoke')),
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    leased_until TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, idempotency_key)
);

CREATE INDEX sync_jobs_claim_idx ON sync_jobs (available_at, created_at)
    WHERE status IN ('pending', 'failed');

CREATE TABLE sync_conflicts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    mapping_id UUID NOT NULL REFERENCES external_event_mappings (id) ON DELETE CASCADE,
    canonical_event_id UUID REFERENCES calendar_events (id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unresolved' CHECK (status IN ('unresolved', 'resolved')),
    resolution TEXT CHECK (resolution IN ('google', 'prosepect', 'latest')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX sync_conflicts_mapping_unresolved_idx
    ON sync_conflicts (mapping_id) WHERE status = 'unresolved';
CREATE INDEX sync_conflicts_user_idx ON sync_conflicts (user_id, created_at DESC);
