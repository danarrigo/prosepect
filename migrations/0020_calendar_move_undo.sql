-- Short-lived schedule inverses, not deleted-content snapshots or a trash/history store.
CREATE TABLE calendar_move_undos (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL,
    task_id UUID,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    task_starts_at TIMESTAMPTZ,
    task_ends_at TIMESTAMPTZ,
    event_version INTEGER NOT NULL CHECK (event_version > 0),
    task_version INTEGER,
    mapping_guard JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (event_id, user_id) REFERENCES calendar_events(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (task_id, user_id) REFERENCES tasks(id, user_id) ON DELETE CASCADE,
    CHECK (ends_at > starts_at)
);
CREATE INDEX calendar_move_undos_owner_expiry_idx ON calendar_move_undos(user_id, expires_at);

-- Expired receipts are logically unusable immediately. Cleanup is bounded per owner
-- on list/move/consume; physical schedule metadata may remain until that owner's
-- next operation or account deletion. No content or provider credentials are stored.
