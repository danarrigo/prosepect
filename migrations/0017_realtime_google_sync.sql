ALTER TABLE calendars
    ADD COLUMN provider_primary BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN access_role TEXT NOT NULL DEFAULT 'reader'
        CHECK (access_role IN ('freeBusyReader', 'reader', 'writer', 'owner'));

UPDATE calendars
SET provider_primary = TRUE, access_role = 'owner'
FROM users
WHERE calendars.user_id = users.id
  AND calendars.source = 'google'
  AND LOWER(calendars.external_id) = LOWER(users.email);

ALTER TABLE sync_jobs DROP CONSTRAINT sync_jobs_kind_check;
ALTER TABLE sync_jobs ADD CONSTRAINT sync_jobs_kind_check
    CHECK (kind IN (
        'calendar_sync',
        'calendar_discovery',
        'calendar_watch',
        'credential_revoke'
    ));

INSERT INTO sync_jobs (id, user_id, kind, idempotency_key)
SELECT gen_random_uuid(), user_id, 'calendar_discovery',
       'realtime-calendar-discovery:' || user_id::TEXT
FROM google_accounts
ON CONFLICT (user_id, idempotency_key) DO NOTHING;

CREATE TABLE google_watch_channels (
    channel_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    calendar_id UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL CHECK (LENGTH(resource_id) BETWEEN 1 AND 2048),
    token_hash BYTEA NOT NULL CHECK (OCTET_LENGTH(token_hash) = 32),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (calendar_id)
);

CREATE INDEX google_watch_channels_calendar_idx
    ON google_watch_channels (user_id, calendar_id, expires_at DESC);
CREATE INDEX google_watch_channels_expiry_idx
    ON google_watch_channels (expires_at);

WITH preferred_calendars AS (
    SELECT DISTINCT ON (user_id) user_id, id
    FROM calendars
    WHERE source = 'google' AND selected AND provider_primary
      AND access_role IN ('writer', 'owner')
    ORDER BY user_id, id
), moved_events AS (
    UPDATE calendar_events events
    SET calendar_id = preferred.id, updated_at = NOW(), version = events.version + 1
    FROM preferred_calendars preferred, calendars current
    WHERE events.user_id = preferred.user_id
      AND events.calendar_id = current.id
      AND current.source = 'native'
      AND events.linked_task_id IS NOT NULL
    RETURNING events.user_id, events.calendar_id
)
INSERT INTO sync_jobs (id, user_id, calendar_id, kind, idempotency_key)
SELECT gen_random_uuid(), user_id, calendar_id, 'calendar_sync',
       'realtime-task-migration:' || calendar_id::TEXT
FROM moved_events
GROUP BY user_id, calendar_id
ON CONFLICT (user_id, idempotency_key) DO NOTHING;
