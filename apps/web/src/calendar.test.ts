import { describe, expect, it } from 'vitest'
import type { CalendarEvent, Task } from './api/types'
import {
  clampTimelineDuration,
  clampTimelineStart,
  clampTimelineStartResize,
  eventOccursOnDate,
  localDateKey,
  parseLocalDateKey,
  taskOccursOnDate,
  tasksForDate,
  timelineMinuteFromOffset,
} from './calendar'

function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: '019cf000-0000-7000-8000-000000000010',
    calendar_id: '019cf000-0000-7000-8000-000000000011',
    linked_task_id: null,
    title: 'Recurring event',
    description: '',
    starts_at: new Date(2026, 0, 1, 9).toISOString(),
    ends_at: new Date(2026, 0, 1, 10).toISOString(),
    all_day: false,
    timezone: 'UTC',
    location: '',
    attendees: [],
    recurrence: 'none',
    recurrence_until: null,
    created_at: '2026-01-01T09:00:00Z',
    updated_at: '2026-01-01T09:00:00Z',
    version: 1,
    ...overrides,
  }
}

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

  it('expands daily and weekly events through their recurrence limit', () => {
    const daily = calendarEvent({
      recurrence: 'daily',
      recurrence_until: new Date(2026, 0, 3, 23, 59).toISOString(),
    })
    const weekly = calendarEvent({ recurrence: 'weekly' })

    expect(eventOccursOnDate(daily, new Date(2026, 0, 3))).toBe(true)
    expect(eventOccursOnDate(daily, new Date(2026, 0, 4))).toBe(false)
    expect(eventOccursOnDate(weekly, new Date(2026, 0, 8))).toBe(true)
    expect(eventOccursOnDate(weekly, new Date(2026, 0, 9))).toBe(false)
  })

  it('snaps timeline movement and resizing to valid day boundaries', () => {
    expect(timelineMinuteFromOffset(100, 48)).toBe(120)
    expect(timelineMinuteFromOffset(10, 48)).toBe(15)
    expect(clampTimelineStart(23 * 60 + 45, 60)).toBe(23 * 60)
    expect(clampTimelineStart(-30, 60)).toBe(0)
    expect(clampTimelineDuration(23 * 60 + 30, 120)).toBe(30)
    expect(clampTimelineDuration(9 * 60, 5)).toBe(15)
    expect(clampTimelineStartResize(10 * 60, 10 * 60 + 30)).toBe(10 * 60)
    expect(clampTimelineStartResize(11 * 60, 10 * 60 + 30)).toBe(10 * 60 + 15)
    expect(clampTimelineStartResize(-30, 60)).toBe(0)
  })

  it('expands monthly and yearly events only on their anchored calendar date', () => {
    const monthly = calendarEvent({
      starts_at: new Date(2026, 0, 31, 9).toISOString(),
      ends_at: new Date(2026, 0, 31, 10).toISOString(),
      recurrence: 'monthly',
    })
    const yearly = calendarEvent({
      starts_at: new Date(2024, 1, 29, 9).toISOString(),
      ends_at: new Date(2024, 1, 29, 10).toISOString(),
      recurrence: 'yearly',
    })

    expect(eventOccursOnDate(monthly, new Date(2026, 1, 28))).toBe(false)
    expect(eventOccursOnDate(monthly, new Date(2026, 2, 31))).toBe(true)
    expect(eventOccursOnDate(yearly, new Date(2026, 1, 28))).toBe(false)
    expect(eventOccursOnDate(yearly, new Date(2028, 1, 29))).toBe(true)
  })
})
