ALTER TABLE tasks
ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'
    CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
ADD COLUMN labels TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN remind_at TIMESTAMPTZ,
ADD COLUMN position BIGINT NOT NULL DEFAULT 0;

WITH ranked_tasks AS (
    SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) * 1024 AS position
    FROM tasks
)
UPDATE tasks
SET position = ranked_tasks.position
FROM ranked_tasks
WHERE tasks.id = ranked_tasks.id;

CREATE INDEX tasks_user_position_idx ON tasks (user_id, position, id);
CREATE INDEX tasks_user_reminder_idx ON tasks (user_id, remind_at)
WHERE remind_at IS NOT NULL AND status <> 'completed';
CREATE INDEX tasks_labels_idx ON tasks USING GIN (labels);
