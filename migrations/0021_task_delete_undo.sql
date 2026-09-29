CREATE TABLE task_delete_undos (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    task_title TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (octet_length(snapshot::text) <= 1048576)
);
CREATE INDEX task_delete_undos_expiry_idx ON task_delete_undos(expires_at);
CREATE INDEX task_delete_undos_owner_idx ON task_delete_undos(user_id, expires_at);

-- Independent of receipt retention: a tombstone cannot become an ordinary import.
ALTER TABLE external_event_mappings
    ADD COLUMN deletion_hold_until TIMESTAMPTZ,
    ADD COLUMN reversible_tombstone BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN delete_resolution_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE task_delete_guard_revisions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, scope)
);

-- Preference writers include discovery, settings, disconnect and direct calendar edits.
-- Do not invalidate on sync-token/last_synced_at updates.
CREATE FUNCTION task_delete_calendar_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id UUID;
BEGIN
    IF TG_OP = 'UPDATE' AND
       ROW(NEW.source,NEW.external_id,NEW.selected,NEW.is_default,NEW.provider_primary,NEW.access_role)
       IS NOT DISTINCT FROM
       ROW(OLD.source,OLD.external_id,OLD.selected,OLD.is_default,OLD.provider_primary,OLD.access_role) THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN owner_id := OLD.user_id; ELSE owner_id := NEW.user_id; END IF;
    INSERT INTO task_delete_guard_revisions(user_id,scope,revision)
        SELECT owner_id,'calendars',1 WHERE EXISTS (SELECT 1 FROM users WHERE id=owner_id)
        ON CONFLICT (user_id,scope) DO UPDATE SET revision=task_delete_guard_revisions.revision+1;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER task_delete_calendar_revision BEFORE INSERT OR UPDATE OR DELETE ON calendars
    FOR EACH ROW EXECUTE FUNCTION task_delete_calendar_revision();

-- Cascades and review edits also invalidate affected dates. Explicit replacement
-- writers additionally bump the revision even when the old/new list is empty.
CREATE FUNCTION task_delete_focus_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id UUID; day DATE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        owner_id := OLD.user_id;
        IF TG_TABLE_NAME = 'daily_focus_tasks' THEN day := OLD.focus_date; ELSE day := OLD.review_date; END IF;
    ELSE
        owner_id := NEW.user_id;
        IF TG_TABLE_NAME = 'daily_focus_tasks' THEN day := NEW.focus_date; ELSE day := NEW.review_date; END IF;
    END IF;
    -- Review store writers take this lock before selecting unfinished tasks.
    -- The trigger also guards direct review changes/deletion, not just focus rows.
    IF TG_TABLE_NAME = 'daily_reviews' THEN
        INSERT INTO task_delete_guard_revisions(user_id,scope,revision)
            SELECT owner_id,'review-selection',1 WHERE EXISTS (SELECT 1 FROM users WHERE id=owner_id)
            ON CONFLICT (user_id,scope) DO UPDATE SET revision=task_delete_guard_revisions.revision+1;
    END IF;
    INSERT INTO task_delete_guard_revisions(user_id,scope,revision)
        SELECT owner_id,'focus:' || day::text,1 WHERE EXISTS (SELECT 1 FROM users WHERE id=owner_id)
        ON CONFLICT (user_id,scope) DO UPDATE SET revision=task_delete_guard_revisions.revision+1;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER task_delete_focus_revision BEFORE INSERT OR UPDATE OR DELETE ON daily_focus_tasks
    FOR EACH ROW EXECUTE FUNCTION task_delete_focus_revision();
-- Only actual review writes invalidate Undo; an idempotent start uses INSERT
-- ON CONFLICT DO NOTHING. Store writers still lock before selecting task sets.
CREATE TRIGGER task_delete_review_revision AFTER INSERT OR UPDATE OR DELETE ON daily_reviews
    FOR EACH ROW EXECUTE FUNCTION task_delete_focus_revision();
