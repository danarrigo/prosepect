CREATE TABLE activity_entries (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (CHAR_LENGTH(kind) BETWEEN 1 AND 100),
    message TEXT NOT NULL CHECK (CHAR_LENGTH(message) BETWEEN 1 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX activity_entries_user_created_idx
    ON activity_entries (user_id, created_at DESC);
