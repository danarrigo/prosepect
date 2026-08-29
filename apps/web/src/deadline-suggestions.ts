import { localDateKey } from './calendar'

export interface DeadlineSuggestion {
  dueDate: string
  label: string
  matchStart: number
  matchEnd: number
}

const PREFIX = String.raw`(?:due\s+|by\s+|on\s+)?`
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

export function detectDeadlineSuggestion(
  input: string,
  referenceDate = new Date(),
): DeadlineSuggestion | null {
  const reference = startOfLocalDay(referenceDate)

  const relative = new RegExp(String.raw`\b${PREFIX}(today|tomorrow)\b`, 'i').exec(input)
  if (relative?.index !== undefined) {
    const date = addDays(reference, relative[1]?.toLowerCase() === 'tomorrow' ? 1 : 0)
    return suggestion(
      relative,
      date,
      relative[1]?.toLowerCase() === 'tomorrow' ? 'Tomorrow' : 'Today',
    )
  }

  const daysFromNow = new RegExp(String.raw`\b${PREFIX}in\s+(\d{1,3})\s+days?\b`, 'i').exec(input)
  if (daysFromNow?.index !== undefined) {
    const days = Number(daysFromNow[1])
    if (days >= 1 && days <= 365) {
      const date = addDays(reference, days)
      return suggestion(daysFromNow, date, formatDate(date))
    }
  }

  const explicitDate = new RegExp(String.raw`\b${PREFIX}(\d{4}-\d{2}-\d{2})\b`, 'i').exec(input)
  if (explicitDate?.index !== undefined && explicitDate[1]) {
    const date = parseLocalDate(explicitDate[1])
    if (date) return suggestion(explicitDate, date, formatDate(date))
  }

  const weekday = new RegExp(String.raw`\b${PREFIX}(${WEEKDAYS.join('|')})\b`, 'i').exec(input)
  if (weekday?.index !== undefined && weekday[1]) {
    const weekdayIndex = WEEKDAYS.indexOf(weekday[1].toLowerCase() as (typeof WEEKDAYS)[number])
    let daysAhead = (weekdayIndex - reference.getDay() + 7) % 7
    if (daysAhead === 0) daysAhead = 7
    const date = addDays(reference, daysAhead)
    return suggestion(weekday, date, formatDate(date))
  }

  return null
}

export function applyDeadlineSuggestion(input: string, suggestion: DeadlineSuggestion) {
  const before = input.slice(0, suggestion.matchStart).trimEnd()
  const after = input.slice(suggestion.matchEnd).trimStart()
  return [before, after]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/[,:;-]\s*$/, '')
    .trim()
}

function suggestion(match: RegExpExecArray, date: Date, label: string): DeadlineSuggestion {
  return {
    dueDate: localDateKey(date),
    label,
    matchStart: match.index,
    matchEnd: match.index + match[0].length,
  }
}

function startOfLocalDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(value: Date, days: number) {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return null
  const date = new Date(year, month - 1, day)
  return localDateKey(date) === value ? date : null
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(value)
}
