-- A one-occurrence edit preserves the source values for the next occurrence.
-- The project is a real owner-bound reference, not an opaque JSON identifier.
ALTER TABLE tasks
    ADD COLUMN recurrence_defaults JSONB,
    ADD COLUMN recurrence_project_id UUID,
    ADD CONSTRAINT tasks_recurrence_defaults_object CHECK (
        recurrence_defaults IS NULL OR jsonb_typeof(recurrence_defaults) = 'object'
    ),
    ADD CONSTRAINT tasks_recurrence_defaults_project CHECK (
        recurrence_defaults IS NOT NULL OR recurrence_project_id IS NULL
    ),
    ADD CONSTRAINT tasks_recurrence_project_owner_fk
        FOREIGN KEY (recurrence_project_id, user_id) REFERENCES projects(id, user_id)
        ON DELETE SET NULL (recurrence_project_id);

CREATE INDEX tasks_recurrence_project_idx ON tasks(recurrence_project_id, user_id)
    WHERE recurrence_project_id IS NOT NULL;

-- Deleting a future project unassigns the template and invalidates stale editors,
-- even if this occurrence was moved to another project.
CREATE FUNCTION bump_recurrence_project_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.recurrence_project_id IS DISTINCT FROM NEW.recurrence_project_id
       AND OLD.version = NEW.version THEN
        NEW.version := OLD.version + 1;
        NEW.updated_at := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tasks_recurrence_project_version
    BEFORE UPDATE OF recurrence_project_id ON tasks
    FOR EACH ROW EXECUTE FUNCTION bump_recurrence_project_version();
