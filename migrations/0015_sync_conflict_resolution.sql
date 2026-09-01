ALTER TABLE external_event_mappings
    ADD COLUMN IF NOT EXISTS pending_resolution TEXT
    CHECK (pending_resolution IN ('google', 'prosepect', 'latest'));
