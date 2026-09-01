CREATE TABLE files (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects (id) ON DELETE SET NULL,
    task_id UUID REFERENCES tasks (id) ON DELETE SET NULL,
    note_id UUID REFERENCES notes (id) ON DELETE SET NULL,
    event_id UUID REFERENCES calendar_events (id) ON DELETE SET NULL,
    object_key TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
    content_type TEXT NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 255),
    byte_size BIGINT NOT NULL CHECK (byte_size >= 0 AND byte_size <= 26214400),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (num_nonnulls(project_id, task_id, note_id, event_id) <= 1)
);

CREATE INDEX files_user_created_idx ON files (user_id, created_at DESC, id DESC);
CREATE INDEX files_project_idx ON files (user_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX files_task_idx ON files (user_id, task_id) WHERE task_id IS NOT NULL;
CREATE INDEX files_note_idx ON files (user_id, note_id) WHERE note_id IS NOT NULL;
CREATE INDEX files_event_idx ON files (user_id, event_id) WHERE event_id IS NOT NULL;
