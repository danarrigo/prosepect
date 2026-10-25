import type { EditableTaskFields, Task, TaskPriority } from './api/types'

export type BulkTaskAction =
  | { kind: 'complete' }
  | { kind: 'priority'; priority: TaskPriority }
  | { kind: 'project'; projectId: string | null }
  | { kind: 'label'; label: string }
  | { kind: 'delete' }

export type BulkTaskResult = {
  id: string
  title: string
  outcome: 'saved' | 'unconfirmed'
  message: string
}

export function bulkTaskFields(
  task: Task,
  action: Exclude<BulkTaskAction, { kind: 'delete' }>,
): EditableTaskFields {
  return {
    title: task.title,
    description: task.description,
    project_id: action.kind === 'project' ? action.projectId : task.project_id,
    parent_task_id: task.parent_task_id ?? null,
    due_at: task.due_at ?? null,
    scheduled_start: task.scheduled_start ?? null,
    scheduled_end: task.scheduled_end ?? null,
    remind_at: task.remind_at ?? null,
    status: action.kind === 'complete' ? 'completed' : task.status,
    priority: action.kind === 'priority' ? action.priority : task.priority,
    labels:
      action.kind === 'label'
        ? [...new Set([...task.labels, action.label.trim()])]
        : [...task.labels],
    // Omitting recurrence/scope preserves an existing occurrence's future defaults.
  }
}
