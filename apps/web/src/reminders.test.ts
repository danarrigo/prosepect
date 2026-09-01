import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from './api/types'
import { dueInAppReminders, parseDismissedReminders, reminderKey } from './reminders'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: '019cf000-0000-7000-8000-000000000001',
    project_id: null,
    parent_task_id: null,
    title: 'Submit release',
    description: '',
    due_at: null,
    scheduled_start: null,
    scheduled_end: null,
    status: 'todo',
    priority: 'medium',
    recurrence: 'none',
    labels: [],
    remind_at: null,
    position: 1024,
    completed_at: null,
    created_at: '2026-08-31T09:00:00Z',
    updated_at: '2026-08-31T09:00:00Z',
    version: 1,
    ...overrides,
  }
}

afterEach(() => vi.useRealTimers())

describe('in-app reminders', () => {
  it('becomes due while the application clock remains open', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T09:00:00Z'))
    const reminder = task({ remind_at: '2026-08-31T09:00:30Z' })

    expect(dueInAppReminders([reminder], Date.now(), [])).toEqual([])
    vi.advanceTimersByTime(30_000)
    expect(dueInAppReminders([reminder], Date.now(), [])).toEqual([reminder])
  })

  it('excludes completed and dismissed reminders', () => {
    const remindAt = '2026-08-31T09:00:00Z'
    const open = task({ remind_at: remindAt })
    const completed = task({
      id: '019cf000-0000-7000-8000-000000000002',
      remind_at: remindAt,
      status: 'completed',
    })

    expect(
      dueInAppReminders([open, completed], new Date('2026-08-31T10:00:00Z').getTime(), [
        reminderKey(open.id, remindAt),
      ]),
    ).toEqual([])
  })

  it('loads only valid bounded dismissal keys', () => {
    expect(parseDismissedReminders('["one", 2, "three"]')).toEqual(['one', 'three'])
    expect(parseDismissedReminders('invalid')).toEqual([])
  })
})
