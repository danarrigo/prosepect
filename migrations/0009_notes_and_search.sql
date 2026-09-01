CREATE TABLE notes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID,
    task_id UUID,
    event_id UUID,
    title TEXT NOT NULL CHECK (LENGTH(TRIM(title)) BETWEEN 1 AND 240),
    markdown TEXT NOT NULL DEFAULT '' CHECK (LENGTH(markdown) <= 100000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (id, user_id),
    FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (task_id, user_id) REFERENCES tasks(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (event_id, user_id) REFERENCES calendar_events(id, user_id) ON DELETE CASCADE,
    CHECK (NUM_NONNULLS(project_id, task_id, event_id) <= 1)
);

CREATE INDEX notes_user_updated_idx ON notes (user_id, updated_at DESC, id DESC);
CREATE INDEX notes_project_idx ON notes (user_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX notes_task_idx ON notes (user_id, task_id) WHERE task_id IS NOT NULL;
CREATE INDEX notes_event_idx ON notes (user_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX notes_search_idx ON notes USING GIN (
    TO_TSVECTOR('simple', title || ' ' || markdown)
);
CREATE INDEX projects_search_idx ON projects USING GIN (
    TO_TSVECTOR('simple', name || ' ' || outcome)
);
CREATE INDEX tasks_search_idx ON tasks USING GIN (
    TO_TSVECTOR('simple', title || ' ' || description)
);
CREATE INDEX calendar_events_search_idx ON calendar_events USING GIN (
    TO_TSVECTOR('simple', title || ' ' || description || ' ' || location)
);
