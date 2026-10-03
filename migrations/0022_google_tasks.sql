-- Google Tasks is an independently enabled integration. Existing Calendar grants
-- and mappings are not repurposed or revoked when Tasks is disabled.
ALTER TABLE oauth_login_attempts DROP CONSTRAINT oauth_login_attempts_purpose_check;
ALTER TABLE oauth_login_attempts ADD CONSTRAINT oauth_login_attempts_purpose_check
    CHECK (purpose IN ('login', 'calendar_connect', 'tasks_connect'));

ALTER TABLE sync_jobs DROP CONSTRAINT sync_jobs_kind_check;
ALTER TABLE sync_jobs ADD CONSTRAINT sync_jobs_kind_check CHECK (kind IN (
    'calendar_sync', 'calendar_discovery', 'calendar_watch', 'credential_revoke', 'tasks_sync'
));

CREATE TABLE google_task_connections (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    task_list_id TEXT,
    timezone TEXT,
    list_create_attempted BOOLEAN NOT NULL DEFAULT FALSE,
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    CHECK (NOT enabled OR (task_list_id IS NOT NULL AND timezone IS NOT NULL)),
    CHECK (task_list_id IS NULL OR length(task_list_id) BETWEEN 1 AND 2048)
);

CREATE TABLE google_task_links (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_list_id TEXT NOT NULL CHECK (length(task_list_id) BETWEEN 1 AND 2048),
    -- Deliberately not a task FK: retain the identity after deletion so a Google
    -- copy cannot be imported as a new task, and Undo can recover the same link.
    task_id UUID NOT NULL,
    external_task_id TEXT,
    external_etag TEXT,
    baseline JSONB,
    phase TEXT NOT NULL CHECK (phase IN ('prepared', 'creating', 'linked', 'detached')),
    create_reference TEXT,
    conflict JSONB,
    resolution TEXT CHECK (resolution IN ('google', 'prosepect')),
    CHECK (resolution IS NULL OR conflict IS NOT NULL),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (phase <> 'linked' OR (
        external_task_id IS NOT NULL AND external_etag IS NOT NULL AND baseline IS NOT NULL
    )),
    CHECK (phase NOT IN ('prepared', 'creating') OR create_reference IS NOT NULL),
    UNIQUE(user_id, task_list_id, task_id),
    UNIQUE(user_id, task_list_id, external_task_id)
);
CREATE INDEX google_task_links_user_idx ON google_task_links(user_id, task_list_id);

-- A pending job reads the whole current snapshot, so edits can share it.
-- Claiming changes status to running and frees the slot: later edits must queue
-- a follow-up, even while the earlier snapshot is still being processed.
CREATE UNIQUE INDEX google_tasks_pending_change_idx ON sync_jobs(user_id)
    WHERE kind='tasks_sync' AND status='pending' AND idempotency_key LIKE 'tasks-change:%';

CREATE FUNCTION enqueue_google_tasks_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    owner UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.title IS NOT DISTINCT FROM NEW.title
            AND OLD.due_at IS NOT DISTINCT FROM NEW.due_at
            AND (OLD.status='completed') IS NOT DISTINCT FROM (NEW.status='completed') THEN
            RETURN NULL;
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        owner := OLD.user_id;
    ELSE
        owner := NEW.user_id;
    END IF;
    IF EXISTS (SELECT 1 FROM google_task_connections WHERE user_id=owner AND enabled) THEN
        INSERT INTO sync_jobs(id,user_id,kind,idempotency_key)
        VALUES(gen_random_uuid(),owner,'tasks_sync',
            'tasks-change:' || gen_random_uuid()::TEXT)
        -- Lock the pending row until the task transaction commits. Otherwise
        -- a worker could claim it and read an older task snapshot while this
        -- uncommitted edit incorrectly assumes that job will cover its change.
        ON CONFLICT(user_id) WHERE kind='tasks_sync' AND status='pending'
            AND idempotency_key LIKE 'tasks-change:%'
        DO UPDATE SET updated_at=sync_jobs.updated_at;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER enqueue_google_tasks_change AFTER INSERT OR UPDATE OR DELETE ON tasks
    FOR EACH ROW EXECUTE FUNCTION enqueue_google_tasks_change();
