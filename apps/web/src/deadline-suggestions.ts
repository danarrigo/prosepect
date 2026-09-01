import * as chrono from 'chrono-node'
import { localDateKey } from './calendar'

export interface TemporalSuggestion {
  dueDate: string | null
  scheduledStart: string | null
  scheduledEnd: string | null
  label: string
  matchedText: string
  matchStart: number
  matchEnd: number
}

export interface DeadlineSuggestion extends TemporalSuggestion {
  dueDate: string
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

const NEXT_WEEKDAY_PATTERN = new RegExp(
  String.raw`\b(?:due\s+|by\s+|on\s+)?next\s+(${WEEKDAYS.join('|')})\b`,
  'i',
)
const TOMORROW_PERIOD_PATTERN =
  /\b(?:due\s+|by\s+|on\s+)?(?:tomorrow\s*|tom\s*)(morning|afternoon|evening|night)\b/i
const DAY_PERIOD_HOURS: Record<string, number> = {
  morning: 9,
  afternoon: 12,
  evening: 19,
  night: 22,
}

export function detectTemporalSuggestion(
  input: string,
  referenceDate = new Date(),
): TemporalSuggestion | null {
  const reference = startOfLocalDay(referenceDate)
  const todoistSpecific = detectTodoistSpecific(input, reference)
  if (todoistSpecific) return todoistSpecific

  const result = chrono.casual.parse(input, referenceDate, { forwardDate: true })[0]
  if (!result) return null

  const hasDate = ['day', 'month', 'year', 'weekday'].some((component) =>
    result.start.isCertain(component as 'day'),
  )
  const hasTime = result.start.isCertain('hour')
  if (!hasDate && !hasTime) return null

  const date = result.start.date()
  const match = expandPrefix(input, result.index, result.index + result.text.length)
  return temporalSuggestion(match, date, hasDate, hasTime, referenceDate)
}

export function detectDeadlineSuggestion(
  input: string,
  referenceDate = new Date(),
): DeadlineSuggestion | null {
  const suggestion = detectTemporalSuggestion(input, referenceDate)
  return suggestion?.dueDate ? (suggestion as DeadlineSuggestion) : null
}

export function applyDeadlineSuggestion(input: string, suggestion: TemporalSuggestion) {
  const before = input.slice(0, suggestion.matchStart).trimEnd()
  const after = input.slice(suggestion.matchEnd).trimStart()
  return [before, after]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/[,:;-]\s*$/, '')
    .trim()
}

function detectTodoistSpecific(input: string, reference: Date): TemporalSuggestion | null {
  const nextWeekday = NEXT_WEEKDAY_PATTERN.exec(input)
  if (nextWeekday?.index !== undefined && nextWeekday[1]) {
    const weekday = WEEKDAYS.indexOf(nextWeekday[1].toLowerCase() as (typeof WEEKDAYS)[number])
    let daysAhead = (weekday - reference.getDay() + 7) % 7
    if (daysAhead === 0) daysAhead = 7
    const date = addDays(reference, daysAhead + 7)
    return temporalSuggestion(
      {
        start: nextWeekday.index,
        end: nextWeekday.index + nextWeekday[0].length,
        text: nextWeekday[0],
      },
      date,
      true,
      false,
      reference,
    )
  }

  const tomorrowPeriod = TOMORROW_PERIOD_PATTERN.exec(input)
  if (tomorrowPeriod?.index !== undefined && tomorrowPeriod[1]) {
    const date = addDays(reference, 1)
    date.setHours(DAY_PERIOD_HOURS[tomorrowPeriod[1].toLowerCase()] ?? 9)
    return temporalSuggestion(
      {
        start: tomorrowPeriod.index,
        end: tomorrowPeriod.index + tomorrowPeriod[0].length,
        text: tomorrowPeriod[0],
      },
      date,
      true,
      true,
      reference,
    )
  }

  return null
}

function temporalSuggestion(
  match: { start: number; end: number; text: string },
  date: Date,
  hasDate: boolean,
  hasTime: boolean,
  referenceDate: Date,
): TemporalSuggestion {
  const scheduledStart = hasTime ? localDateTimeKey(date) : null
  const end = new Date(date)
  end.setHours(end.getHours() + 1)
  const dueDate = hasDate ? localDateKey(date) : null

  return {
    dueDate,
    scheduledStart,
    scheduledEnd: hasTime ? localDateTimeKey(end) : null,
    label: dueDate ? formatDateLabel(date, referenceDate) : formatTimeLabel(date),
    matchedText: match.text,
    matchStart: match.start,
    matchEnd: match.end,
  }
}

function expandPrefix(input: string, start: number, end: number) {
  const prefix = input.slice(0, start).match(/\b(?:due|by)\s+$/i)
  const expandedStart = prefix?.index ?? start
  return {
    start: expandedStart,
    end,
    text: input.slice(expandedStart, end),
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

function localDateTimeKey(value: Date) {
  return `${localDateKey(value)}T${String(value.getHours()).padStart(2, '0')}:${String(
    value.getMinutes(),
  ).padStart(2, '0')}`
}

function formatDateLabel(value: Date, referenceDate: Date) {
  const today = startOfLocalDay(referenceDate)
  const target = startOfLocalDay(value)
  const difference = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (difference === 0) return 'Today'
  if (difference === 1) return 'Tomorrow'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(value)
}

function formatTimeLabel(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value)
}
