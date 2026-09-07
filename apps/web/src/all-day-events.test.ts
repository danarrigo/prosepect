import { describe, expect, it } from 'vitest'
import { allDayDateRange, allDayEventTimes, moveAllDayEvent } from './all-day-events'
import { eventOccursOnDate } from './calendar'
import type { CalendarEvent } from './api/types'

function event(starts_at: string, ends_at: string): CalendarEvent {
  return {
    id: 'event-1',
    calendar_id: 'calendar-1',
    title: 'Away',
    description: '',
    starts_at,
    ends_at,
    all_day: true,
    timezone: 'UTC',
    location: '',
    attendees: [],
    recurrence: 'none',
    recurrence_until: null,
    linked_task_id: null,
    version: 1,
    created_at: starts_at,
    updated_at: starts_at,
  }
}

describe('all-day date-only event contract', () => {
  it('round trips a single inclusive day as UTC midnight with exclusive end', () => {
    const times = allDayEventTimes('2026-09-01', '2026-09-01')
    expect(times).toEqual({
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: '2026-09-02T00:00:00.000Z',
    })
    expect(allDayDateRange({ ...times, all_day: true })).toEqual({
      start: '2026-09-01',
      lastDay: '2026-09-01',
    })
  })

  it('renders imported Google dates without local-offset drift or an extra end day', () => {
    const item = event('2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z')
    expect(eventOccursOnDate(item, new Date(2026, 7, 31))).toBe(false)
    expect(eventOccursOnDate(item, new Date(2026, 8, 1))).toBe(true)
    expect(eventOccursOnDate(item, new Date(2026, 8, 2))).toBe(true)
    expect(eventOccursOnDate(item, new Date(2026, 8, 3))).toBe(false)
  })

  it.each([
    ['2026-03-07', '2026-03-09'],
    ['2026-10-31', '2026-11-02'],
  ])('preserves day counts across DST for %s', (start, lastDay) => {
    const times = allDayEventTimes(start, lastDay)
    const item = event(times.starts_at, times.ends_at)
    expect(new Date(times.ends_at).getTime() - new Date(times.starts_at).getTime()).toBe(
      3 * 86_400_000,
    )
    expect(allDayDateRange(item)).toEqual({ start, lastDay })
    const moved = moveAllDayEvent(item, '2026-12-01')!
    expect(allDayDateRange({ ...moved, all_day: true })).toEqual({
      start: '2026-12-01',
      lastDay: '2026-12-03',
    })
  })

  it('does not classify or normalize non-midnight legacy ranges', () => {
    const item = event(
      new Date(2026, 8, 1, 9).toISOString(),
      new Date(2026, 8, 1, 10).toISOString(),
    )
    expect(allDayDateRange(item)).toBeNull()
    expect(moveAllDayEvent(item, '2026-09-02')).toBeNull()
    expect(eventOccursOnDate(item, new Date(2026, 8, 1))).toBe(true)
    expect(eventOccursOnDate(item, new Date(2026, 8, 2))).toBe(false)
    expect(allDayDateRange(event('2026-09-01T00:00:00Z', '2026-09-01T01:00:00Z'))).toBeNull()
    expect(allDayDateRange(event('2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'))).toBeNull()
  })
})
