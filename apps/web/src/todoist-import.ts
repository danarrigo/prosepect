import Papa from 'papaparse'
import { localDateKey } from './calendar'
import { detectTemporalSuggestion } from './deadline-suggestions'
import { parseQuickCapture, type CapturedPriority } from './quick-capture'

export type ImportedRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface TodoistImportTaskPayload {
  title: string
  description: string
  due_at: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  priority: CapturedPriority
  recurrence: ImportedRecurrence
  labels: string[]
  parent_index: number | null
}

export interface TodoistImportRequestPayload {
  project_name: string
  project_description: string
  tasks: TodoistImportTaskPayload[]
}

export interface TodoistImportReport {
  importedTasks: number
  importedComments: number
  importedSections: number
  skippedRows: number
  warnings: string[]
}

export interface ParsedTodoistImport {
  request: TodoistImportRequestPayload
  report: TodoistImportReport
}

type TodoistRow = Record<string, string | undefined>

const PRIORITIES: Record<string, CapturedPriority> = {
  '1': 'urgent',
  '2': 'high',
  '3': 'medium',
  '4': 'low',
}
const WEEKDAY = String.raw`(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`

export function parseTodoistCsv(
  csv: string,
  projectName: string,
  referenceDate = new Date(),
): ParsedTodoistImport {
  const parsed = Papa.parse<TodoistRow>(stripByteOrderMark(csv), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().toUpperCase(),
  })
  if (parsed.errors.length) {
    throw new Error(`Could not read Todoist CSV: ${parsed.errors[0]?.message ?? 'invalid CSV'}`)
  }
  const fields = new Set(parsed.meta.fields ?? [])
  if (!fields.has('TYPE') || !fields.has('CONTENT')) {
    throw new Error('Todoist CSV must include TYPE and CONTENT columns')
  }

  const report: TodoistImportReport = {
    importedTasks: 0,
    importedComments: 0,
    importedSections: 0,
    skippedRows: 0,
    warnings: [],
  }
  const tasks: TodoistImportTaskPayload[] = []
  const parentsByIndent: Array<number | undefined> = []
  let currentSection = ''
  let lastTaskIndex: number | null = null

  for (const [rowIndex, row] of parsed.data.entries()) {
    const sourceRow = rowIndex + 2
    const type = field(row, 'TYPE').toLowerCase()
    const content = field(row, 'CONTENT').trim()

    if (type === 'section') {
      currentSection = content
      report.importedSections += 1
      continue
    }
    if (type === 'note') {
      if (lastTaskIndex === null || !content) {
        report.skippedRows += 1
        addWarning(report, `Row ${sourceRow}: comment had no preceding task and was skipped.`)
        continue
      }
      tasks[lastTaskIndex]!.description = appendDescription(
        tasks[lastTaskIndex]!.description,
        `Imported Todoist comments:\n- ${content}`,
      )
      report.importedComments += 1
      continue
    }
    if (type !== 'task') {
      report.skippedRows += 1
      addWarning(report, `Row ${sourceRow}: unsupported Todoist row type "${type || 'empty'}".`)
      continue
    }
    if (!content) {
      report.skippedRows += 1
      addWarning(report, `Row ${sourceRow}: empty task was skipped.`)
      continue
    }

    const captured = parseQuickCapture(content, referenceDate, [], false)
    const indent = parseIndent(field(row, 'INDENT'))
    const parentIndex = indent > 1 ? (parentsByIndent[indent - 1] ?? null) : null
    if (indent > 1 && parentIndex === null) {
      addWarning(
        report,
        `Row ${sourceRow}: missing parent indentation; task was imported at top level.`,
      )
    }

    const dateText = field(row, 'DATE').trim()
    const deadlineText = field(row, 'DEADLINE').trim()
    const timeZone = field(row, 'TIMEZONE').trim()
    const language = field(row, 'DATE_LANG').trim()
    if (language && language.toLowerCase() !== 'en') {
      addWarning(
        report,
        `Row ${sourceRow}: date language "${language}" is not yet supported; English parsing was attempted.`,
      )
    }

    let recurrence = parseRecurrence(dateText)
    if (recurrence.unsupported) {
      addWarning(
        report,
        `Row ${sourceRow}: recurrence "${dateText}" could not be represented and was preserved in the description.`,
      )
    }
    if (parentIndex !== null && recurrence.value !== 'none') {
      addWarning(
        report,
        `Row ${sourceRow}: recurring subtasks are not supported; recurrence was preserved as text.`,
      )
      recurrence = { value: 'none', unsupported: true }
    }

    const date = parseImportedDate(dateText, timeZone, referenceDate, report, sourceRow)
    const deadline = parseImportedDate(deadlineText, timeZone, referenceDate, report, sourceRow)
    let description = field(row, 'DESCRIPTION').trim()
    if (currentSection) {
      description = appendDescription(description, `Imported Todoist section: ${currentSection}`)
    }
    if (recurrence.unsupported && dateText) {
      description = appendDescription(description, `Todoist recurrence: ${dateText}`)
    } else if (dateText && !date.dueAt && !date.scheduledStart) {
      description = appendDescription(description, `Todoist date: ${dateText}`)
    }
    const duration = parseDuration(row, report, sourceRow)
    const scheduledEnd = date.scheduledStart
      ? addMinutes(date.scheduledStart, duration ?? 60)
      : null

    if (field(row, 'RESPONSIBLE').trim()) {
      addWarning(report, `Row ${sourceRow}: task assignments are not supported and were omitted.`)
    }

    const task: TodoistImportTaskPayload = {
      title: truncate(captured.title || content, 240),
      description: truncate(description, 10_000),
      due_at: deadline.dueAt ?? date.dueAt,
      scheduled_start: date.scheduledStart,
      scheduled_end: scheduledEnd,
      priority: PRIORITIES[field(row, 'PRIORITY').trim()] ?? 'medium',
      recurrence: recurrence.value,
      labels: captured.labels,
      parent_index: parentIndex,
    }
    tasks.push(task)
    lastTaskIndex = tasks.length - 1
    parentsByIndent[indent] = lastTaskIndex
    parentsByIndent.length = indent + 1
    report.importedTasks += 1
  }

  if (report.importedSections) {
    addWarning(
      report,
      `${report.importedSections} Todoist section${report.importedSections === 1 ? '' : 's'} were preserved in task descriptions.`,
    )
  }

  return {
    request: {
      project_name: truncate(projectName.trim() || 'Todoist import', 120),
      project_description: 'Imported from a Todoist project CSV.',
      tasks,
    },
    report,
  }
}

function parseImportedDate(
  input: string,
  timeZone: string,
  referenceDate: Date,
  report: TodoistImportReport,
  row: number,
) {
  if (!input || /^(?:no date|no due date)$/i.test(input)) {
    return { dueAt: null, scheduledStart: null }
  }
  const temporal = detectTemporalSuggestion(input, referenceDate)
  if (!temporal) {
    return { dueAt: null, scheduledStart: null }
  }

  try {
    const dueAt = temporal.dueDate
      ? zonedLocalToIso(`${temporal.dueDate}T23:59`, timeZone)
      : temporal.scheduledStart
        ? zonedLocalToIso(temporal.scheduledStart, timeZone)
        : null
    const scheduledStart = temporal.scheduledStart
      ? zonedLocalToIso(temporal.scheduledStart, timeZone)
      : null
    return { dueAt, scheduledStart }
  } catch {
    addWarning(report, `Row ${row}: timezone "${timeZone}" was invalid; browser timezone was used.`)
    const dueAt = temporal.dueDate
      ? new Date(`${temporal.dueDate}T23:59:00`).toISOString()
      : temporal.scheduledStart
        ? new Date(temporal.scheduledStart).toISOString()
        : null
    const scheduledStart = temporal.scheduledStart
      ? new Date(temporal.scheduledStart).toISOString()
      : null
    return { dueAt, scheduledStart }
  }
}

function parseRecurrence(input: string): { value: ImportedRecurrence; unsupported: boolean } {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return { value: 'none', unsupported: false }
  const clock = String.raw`(?:\s+(?:at\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?`
  const rules: Array<[ImportedRecurrence, string]> = [
    ['daily', '(?:daily|every day)'],
    ['weekly', `(?:weekly|every week|every ${WEEKDAY})`],
    ['monthly', '(?:monthly|every month)'],
    ['yearly', '(?:yearly|annually|every year)'],
  ]
  for (const [value, rule] of rules) {
    if (new RegExp(`^${rule}${clock}$`).test(normalized)) return { value, unsupported: false }
  }
  return {
    value: 'none',
    unsupported: /\bevery!?\b|\b(?:daily|weekly|monthly|yearly)\b/.test(normalized),
  }
}

function parseDuration(row: TodoistRow, report: TodoistImportReport, sourceRow: number) {
  const value = Number(field(row, 'DURATION'))
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = field(row, 'DURATION_UNIT').trim().toLowerCase()
  if (!unit || unit === 'minute' || unit === 'minutes') return Math.round(value)
  addWarning(report, `Row ${sourceRow}: duration unit "${unit}" was not supported.`)
  return null
}

function zonedLocalToIso(localDateTime: string, timeZone: string) {
  if (!timeZone) return new Date(localDateTime).toISOString()
  const [datePart, timePart] = localDateTime.split('T')
  const [year, month, day] = (datePart ?? '').split('-').map(Number)
  const [hour, minute] = (timePart ?? '').split(':').map(Number)
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error('invalid date')
  const localAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!)
  let candidate = new Date(localAsUtc)
  let offset = timeZoneOffset(candidate, timeZone)
  candidate = new Date(localAsUtc - offset)
  const correctedOffset = timeZoneOffset(candidate, timeZone)
  if (correctedOffset !== offset) {
    offset = correctedOffset
    candidate = new Date(localAsUtc - offset)
  }
  return candidate.toISOString()
}

function timeZoneOffset(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const represented = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  return represented - date.getTime()
}

function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()
}

function parseIndent(value: string) {
  const indent = Number.parseInt(value, 10)
  return Number.isInteger(indent) && indent >= 1 && indent <= 4 ? indent : 1
}

function appendDescription(description: string, addition: string) {
  return [description.trim(), addition.trim()].filter(Boolean).join('\n\n')
}

function addWarning(report: TodoistImportReport, warning: string) {
  if (!report.warnings.includes(warning)) report.warnings.push(warning)
}

function field(row: TodoistRow, name: string) {
  return row[name] ?? ''
}

function truncate(value: string, maximum: number) {
  return [...value].slice(0, maximum).join('')
}

function stripByteOrderMark(value: string) {
  return value.replace(/^\uFEFF/, '')
}

export function todoistProjectName(filename: string) {
  return filename.replace(/\.csv$/i, '').trim() || 'Todoist import'
}

export function todayInLocalTime(referenceDate = new Date()) {
  return localDateKey(referenceDate)
}
