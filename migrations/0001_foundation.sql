CREATE TABLE users (
    id UUID PRIMARY KEY,
    google_subject TEXT UNIQUE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE projects (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 120),
    outcome TEXT NOT NULL DEFAULT '' CHECK (LENGTH(outcome) <= 2000),
    target_date DATE,
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'active', 'paused', 'completed', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (id, user_id)
);

CREATE INDEX projects_user_status_idx ON projects (user_id, status);
CREATE INDEX projects_user_created_idx ON projects (user_id, created_at DESC, id DESC);

CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    parent_task_id UUID,
    title TEXT NOT NULL CHECK (LENGTH(TRIM(title)) BETWEEN 1 AND 240),
    description TEXT NOT NULL DEFAULT '' CHECK (LENGTH(description) <= 10000),
    due_at TIMESTAMPTZ,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'blocked', 'completed')),
    priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (id, user_id),
    UNIQUE (id, project_id, user_id),
    FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_task_id, project_id, user_id)
        REFERENCES tasks(id, project_id, user_id) ON DELETE RESTRICT,
    CHECK (parent_task_id IS NULL OR parent_task_id <> id),
    CHECK (
        (scheduled_start IS NULL AND scheduled_end IS NULL)
        OR
        (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end > scheduled_start)
    ),
    CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR
        (status <> 'completed' AND completed_at IS NULL)
    )
);

CREATE INDEX tasks_user_project_idx ON tasks (user_id, project_id);
CREATE INDEX tasks_user_status_idx ON tasks (user_id, status);
CREATE INDEX tasks_user_due_idx ON tasks (user_id, due_at) WHERE due_at IS NOT NULL;
CREATE INDEX tasks_parent_idx ON tasks (user_id, parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX tasks_user_created_idx ON tasks (user_id, created_at DESC, id DESC);
