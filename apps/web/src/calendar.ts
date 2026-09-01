import type { CalendarEvent, Task } from './api/types'

export function startOfLocalDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function localDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseLocalDateKey(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return null

  const date = new Date(year, month - 1, day)
  return localDateKey(date) === value ? date : null
}

export function taskOccursOnDate(task: Task, date: Date) {
  const day = startOfLocalDay(date).getTime()
  const dueOnDay = task.due_at ? localDateKey(new Date(task.due_at)) === localDateKey(date) : false
  if (!task.scheduled_start) return dueOnDay

  const scheduledStart = startOfLocalDay(new Date(task.scheduled_start)).getTime()
  const scheduledEnd = task.scheduled_end
    ? startOfLocalDay(new Date(task.scheduled_end)).getTime()
    : scheduledStart
  return dueOnDay || (day >= scheduledStart && day <= scheduledEnd)
}

export function eventOccursOnDate(event: CalendarEvent, date: Date) {
  const target = startOfLocalDay(date)
  const start = startOfLocalDay(new Date(event.starts_at))
  const end = startOfLocalDay(new Date(event.ends_at))
  if (target >= start && target <= end) return true
  if (event.recurrence === 'none' || target < start) return false
  if (event.recurrence_until && target > new Date(event.recurrence_until)) return false

  const days = Math.round((target.getTime() - start.getTime()) / 86_400_000)
  if (event.recurrence === 'daily') return true
  if (event.recurrence === 'weekly') return days % 7 === 0
  if (event.recurrence === 'monthly') return target.getDate() === start.getDate()
  return target.getMonth() === start.getMonth() && target.getDate() === start.getDate()
}

export function timelineMinuteFromOffset(offset: number, hourHeight: number, increment = 15) {
  if (!Number.isFinite(offset) || !Number.isFinite(hourHeight) || hourHeight <= 0) return 0
  const minutes = (Math.max(0, offset) / hourHeight) * 60
  return Math.round(minutes / increment) * increment
}

export function clampTimelineStart(startMinute: number, durationMinutes: number) {
  const duration = Math.max(15, Math.min(24 * 60, durationMinutes))
  return Math.max(0, Math.min(24 * 60 - duration, startMinute))
}

export function clampTimelineDuration(startMinute: number, durationMinutes: number) {
  return Math.max(15, Math.min(24 * 60 - startMinute, durationMinutes))
}

export function clampTimelineStartResize(requestedStartMinute: number, endMinute: number) {
  const boundedEnd = Math.max(15, Math.min(24 * 60, endMinute))
  return Math.max(0, Math.min(boundedEnd - 15, requestedStartMinute))
}

export function tasksForDate(tasks: Task[], date: Date) {
  return tasks
    .filter((task) => taskOccursOnDate(task, date))
    .sort((first, second) => {
      const firstTime = new Date(first.scheduled_start ?? first.due_at ?? 0).getTime()
      const secondTime = new Date(second.scheduled_start ?? second.due_at ?? 0).getTime()
      return firstTime - secondTime
    })
}
