import type { Task } from './api/types'

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

export function tasksForDate(tasks: Task[], date: Date) {
  return tasks
    .filter((task) => taskOccursOnDate(task, date))
    .sort((first, second) => {
      const firstTime = new Date(first.scheduled_start ?? first.due_at ?? 0).getTime()
      const secondTime = new Date(second.scheduled_start ?? second.due_at ?? 0).getTime()
      return firstTime - secondTime
    })
}
