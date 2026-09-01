import type { Task } from './api/types'

export function reminderKey(taskId: string, remindAt: string) {
  return `${taskId}:${remindAt}`
}

export function dueInAppReminders(tasks: Task[], now: number, dismissed: readonly string[]) {
  return tasks.filter((task) => {
    if (!task.remind_at || task.status === 'completed') return false
    return (
      new Date(task.remind_at).getTime() <= now &&
      !dismissed.includes(reminderKey(task.id, task.remind_at))
    )
  })
}

export function parseDismissedReminders(value: string | null): string[] {
  if (!value) return []
  try {
    const stored: unknown = JSON.parse(value)
    return Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === 'string').slice(-500)
      : []
  } catch {
    return []
  }
}
