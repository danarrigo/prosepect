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

CREATE FUNCTION enqueue_google_tasks_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    owner UUID;
    task UUID;
    revision INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        owner := OLD.user_id; task := OLD.id; revision := OLD.version;
    ELSE
        owner := NEW.user_id; task := NEW.id; revision := NEW.version;
    END IF;
    IF EXISTS (SELECT 1 FROM google_task_connections WHERE user_id=owner AND enabled) THEN
        INSERT INTO sync_jobs(id,user_id,kind,idempotency_key)
        VALUES(gen_random_uuid(),owner,'tasks_sync',
            'tasks-change:' || task::TEXT || ':' || revision::TEXT || ':' || TG_OP)
        ON CONFLICT(user_id,idempotency_key) DO NOTHING;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER enqueue_google_tasks_change AFTER INSERT OR UPDATE OR DELETE ON tasks
    FOR EACH ROW EXECUTE FUNCTION enqueue_google_tasks_change();
