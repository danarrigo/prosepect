ALTER TABLE tasks
ADD COLUMN recurrence_source_id UUID REFERENCES tasks (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX tasks_recurrence_source_idx
ON tasks (recurrence_source_id)
WHERE recurrence_source_id IS NOT NULL;
