CREATE TABLE calendars (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 120),
    color TEXT NOT NULL DEFAULT '#64748b'
        CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    source TEXT NOT NULL DEFAULT 'native'
        CHECK (source IN ('native', 'google')),
    external_id TEXT,
    selected BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (id, user_id),
    UNIQUE (user_id, source, external_id)
);

CREATE UNIQUE INDEX calendars_one_default_per_user_idx
    ON calendars (user_id) WHERE is_default;
CREATE INDEX calendars_user_idx ON calendars (user_id, selected DESC, name);

CREATE TABLE calendar_events (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    calendar_id UUID NOT NULL,
    linked_task_id UUID,
    title TEXT NOT NULL CHECK (LENGTH(TRIM(title)) BETWEEN 1 AND 240),
    description TEXT NOT NULL DEFAULT '' CHECK (LENGTH(description) <= 10000),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    all_day BOOLEAN NOT NULL DEFAULT FALSE,
    timezone TEXT NOT NULL DEFAULT 'UTC' CHECK (LENGTH(timezone) BETWEEN 1 AND 64),
    location TEXT NOT NULL DEFAULT '' CHECK (LENGTH(location) <= 500),
    attendees TEXT[] NOT NULL DEFAULT '{}',
    recurrence TEXT NOT NULL DEFAULT 'none'
        CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
    recurrence_until TIMESTAMPTZ,
    external_etag TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (id, user_id),
    UNIQUE (linked_task_id),
    FOREIGN KEY (calendar_id, user_id) REFERENCES calendars(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (linked_task_id, user_id) REFERENCES tasks(id, user_id) ON DELETE CASCADE,
    CHECK (ends_at > starts_at),
    CHECK (recurrence <> 'none' OR recurrence_until IS NULL)
);

CREATE INDEX calendar_events_user_range_idx
    ON calendar_events (user_id, starts_at, ends_at);
CREATE INDEX calendar_events_calendar_range_idx
    ON calendar_events (calendar_id, starts_at, ends_at);
