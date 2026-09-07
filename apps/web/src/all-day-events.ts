import type { CalendarEvent } from './api/types'

const dayMilliseconds = 86_400_000

function utcMidnight(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.getTime() % dayMilliseconds === 0
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Google date-only events use UTC-midnight boundaries with an exclusive end.
// Non-midnight legacy records must not be silently normalized on unrelated edits.
// Older midnight records are indistinguishable from date-only events and use this contract.
export function allDayDateRange(event: Pick<CalendarEvent, 'all_day' | 'starts_at' | 'ends_at'>) {
  if (
    !event.all_day ||
    !utcMidnight(event.starts_at) ||
    !utcMidnight(event.ends_at) ||
    new Date(event.ends_at) <= new Date(event.starts_at)
  )
    return null
  return {
    start: new Date(event.starts_at).toISOString().slice(0, 10),
    lastDay: shiftDate(new Date(event.ends_at).toISOString().slice(0, 10), -1),
  }
}

export function allDayEventTimes(start: string, lastDay: string) {
  return {
    starts_at: `${start}T00:00:00.000Z`,
    ends_at: `${shiftDate(lastDay, 1)}T00:00:00.000Z`,
  }
}

export function moveAllDayEvent(event: CalendarEvent, start: string) {
  const range = allDayDateRange(event)
  if (!range) return null
  const days =
    (new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime()) / dayMilliseconds
  return allDayEventTimes(start, shiftDate(start, days - 1))
}
