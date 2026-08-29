import { describe, expect, it } from 'vitest'
import type { Task } from './api/types'
import { localDateKey, parseLocalDateKey, taskOccursOnDate, tasksForDate } from './calendar'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: '019cf000-0000-7000-8000-000000000001',
    project_id: '019cf000-0000-7000-8000-000000000002',
    parent_task_id: null,
    title: 'Calendar task',
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
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    version: 1,
    ...overrides,
  }
}

describe('calendar dates', () => {
  it('matches due dates and every local day in a schedule', () => {
    const scheduled = task({
      scheduled_start: new Date(2026, 7, 10, 9).toISOString(),
      scheduled_end: new Date(2026, 7, 12, 17).toISOString(),
    })
    const due = task({
      id: '019cf000-0000-7000-8000-000000000003',
      due_at: new Date(2026, 7, 15, 23, 59).toISOString(),
    })

    expect(taskOccursOnDate(scheduled, new Date(2026, 7, 11))).toBe(true)
    expect(taskOccursOnDate(scheduled, new Date(2026, 7, 13))).toBe(false)
    expect(taskOccursOnDate(due, new Date(2026, 7, 15))).toBe(true)
  })

  it('sorts scheduled tasks before later deadlines', () => {
    const early = task({
      id: '019cf000-0000-7000-8000-000000000003',
      scheduled_start: new Date(2026, 7, 15, 9).toISOString(),
    })
    const late = task({ due_at: new Date(2026, 7, 15, 18).toISOString() })

    expect(tasksForDate([late, early], new Date(2026, 7, 15)).map((item) => item.id)).toEqual([
      early.id,
      late.id,
    ])
  })

  it('parses only real local calendar dates', () => {
    expect(localDateKey(parseLocalDateKey('2026-08-28')!)).toBe('2026-08-28')
    expect(parseLocalDateKey('2026-02-30')).toBeNull()
    expect(parseLocalDateKey('not-a-date')).toBeNull()
  })
})
