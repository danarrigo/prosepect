CREATE TABLE labels (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (LENGTH(name) BETWEEN 1 AND 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, name)
);

INSERT INTO labels (user_id, name)
SELECT DISTINCT tasks.user_id, label
FROM tasks
CROSS JOIN LATERAL UNNEST(tasks.labels) AS label
ON CONFLICT DO NOTHING;

CREATE TABLE user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'system'
        CHECK (theme IN ('system', 'light', 'dark')),
    automatic_daily_review BOOLEAN NOT NULL DEFAULT TRUE,
    sync_conflict_policy TEXT NOT NULL DEFAULT 'ask'
        CHECK (sync_conflict_policy IN ('ask', 'latest', 'google', 'prosepect')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE daily_reviews (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'completed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (user_id, review_date),
    UNIQUE (id, user_id),
    CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status = 'open' AND completed_at IS NULL)
    )
);

CREATE TABLE daily_focus_tasks (
    user_id UUID NOT NULL,
    focus_date DATE NOT NULL,
    task_id UUID NOT NULL,
    position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, focus_date, task_id),
    UNIQUE (user_id, focus_date, position),
    FOREIGN KEY (task_id, user_id) REFERENCES tasks(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX daily_focus_user_date_idx ON daily_focus_tasks (user_id, focus_date DESC);
