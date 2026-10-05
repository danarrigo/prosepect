-- Saved filters are private account metadata, never copies of task content.
CREATE TABLE saved_task_views (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID,
    FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80 AND name=btrim(name)),
    search TEXT NOT NULL DEFAULT '' CHECK (char_length(search)<=500),
    status TEXT NOT NULL CHECK (status IN ('open','all','todo','in_progress','blocked','completed')),
    priority TEXT CHECK (priority IN ('low','medium','high','urgent')),
    label TEXT CHECK (char_length(label) BETWEEN 1 AND 60),
    sort TEXT NOT NULL CHECK (sort IN ('manual','due','priority','title')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX saved_task_views_owner_name_idx ON saved_task_views(user_id,lower(name));
