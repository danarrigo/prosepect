-- Logical content budgets complement object-storage quotas and HTTP limits.
-- Counters are transactional, cover every writer (including imports/provider
-- sync), and are maintained in O(1) per row. Existing content is not deleted.
CREATE TABLE workspace_content_limits (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    user_bytes BIGINT NOT NULL DEFAULT 16777216 CHECK (user_bytes > 0),
    total_bytes BIGINT NOT NULL DEFAULT 268435456 CHECK (total_bytes > 0),
    user_records BIGINT NOT NULL DEFAULT 20000 CHECK (user_records > 0),
    total_records BIGINT NOT NULL DEFAULT 100000 CHECK (total_records > 0)
);
INSERT INTO workspace_content_limits (singleton) VALUES (TRUE);

CREATE TABLE workspace_content_usage (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bytes BIGINT NOT NULL CHECK (bytes >= 0),
    records BIGINT NOT NULL CHECK (records >= 0)
);
CREATE TABLE workspace_content_total (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    bytes BIGINT NOT NULL CHECK (bytes >= 0),
    records BIGINT NOT NULL CHECK (records >= 0)
);

-- Future migrations changing tracked row shapes must recount these derived
-- counters in the same migration. They measure serialized rows, not disk bytes.
DO $$
DECLARE
    relation TEXT;
BEGIN
    FOREACH relation IN ARRAY ARRAY['projects', 'tasks', 'calendars', 'calendar_events', 'notes', 'files', 'labels', 'saved_task_views'] LOOP
        EXECUTE format(
            'INSERT INTO workspace_content_usage (user_id, bytes, records)
             SELECT user_id, SUM(octet_length(to_jsonb(row_data)::text)), COUNT(*) FROM %I row_data GROUP BY user_id
             ON CONFLICT (user_id) DO UPDATE SET bytes = workspace_content_usage.bytes + EXCLUDED.bytes,
                                                records = workspace_content_usage.records + EXCLUDED.records',
            relation
        );
    END LOOP;
END $$;
INSERT INTO workspace_content_total (singleton, bytes, records)
SELECT TRUE, COALESCE(SUM(bytes), 0), COALESCE(SUM(records), 0) FROM workspace_content_usage;

CREATE FUNCTION maintain_workspace_content_usage() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    owner_id UUID;
    byte_delta BIGINT;
    record_delta BIGINT;
    user_bytes BIGINT;
    user_records BIGINT;
    total_bytes BIGINT;
    total_records BIGINT;
    limits workspace_content_limits%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        owner_id := NEW.user_id;
        byte_delta := octet_length(to_jsonb(NEW)::text);
        record_delta := 1;
    ELSIF TG_OP = 'DELETE' THEN
        owner_id := OLD.user_id;
        byte_delta := -octet_length(to_jsonb(OLD)::text);
        record_delta := -1;
    ELSE
        IF NEW.user_id <> OLD.user_id THEN
            RAISE EXCEPTION 'content ownership cannot change' USING ERRCODE = '23514';
        END IF;
        owner_id := NEW.user_id;
        byte_delta := octet_length(to_jsonb(NEW)::text) - octet_length(to_jsonb(OLD)::text);
        record_delta := 0;
    END IF;

    -- Always take the global counter before the owner counter. Both changes
    -- roll back with the content write on quota, version, or transaction errors.
    UPDATE workspace_content_total SET bytes = bytes + byte_delta, records = records + record_delta
    WHERE singleton RETURNING bytes, records INTO total_bytes, total_records;
    IF TG_OP <> 'DELETE' THEN
        INSERT INTO workspace_content_usage (user_id, bytes, records) VALUES (owner_id, 0, 0)
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
    UPDATE workspace_content_usage SET bytes = bytes + byte_delta, records = records + record_delta
    WHERE user_id = owner_id RETURNING bytes, records INTO user_bytes, user_records;

    SELECT * INTO limits FROM workspace_content_limits WHERE singleton;
    -- Deletion and shrinking remain possible even if an older installation
    -- already exceeds the new budgets. Never remove existing user content.
    IF (byte_delta > 0 AND (user_bytes > limits.user_bytes OR total_bytes > limits.total_bytes))
       OR (record_delta > 0 AND (user_records > limits.user_records OR total_records > limits.total_records)) THEN
        RAISE EXCEPTION 'workspace content limit reached' USING ERRCODE = '23514', CONSTRAINT = 'workspace_content_quota';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

DO $$
DECLARE
    relation TEXT;
BEGIN
    FOREACH relation IN ARRAY ARRAY['projects', 'tasks', 'calendars', 'calendar_events', 'notes', 'files', 'labels', 'saved_task_views'] LOOP
        EXECUTE format('CREATE TRIGGER workspace_content_usage AFTER INSERT OR UPDATE OR DELETE ON %I
                        FOR EACH ROW EXECUTE FUNCTION maintain_workspace_content_usage()', relation);
    END LOOP;
END $$;
