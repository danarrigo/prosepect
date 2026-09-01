import {
  applyDeadlineSuggestion,
  detectTemporalSuggestion,
  type TemporalSuggestion,
} from './deadline-suggestions'

export type CapturedPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface QuickCaptureProject {
  id: string
  name: string
}

export interface QuickCaptureResult {
  title: string
  dueDate: string | null
  scheduledStart: string | null
  scheduledEnd: string | null
  labels: string[]
  priority: CapturedPriority | null
  projectId: string | null
}

export interface QuickCaptureAnalysis {
  result: QuickCaptureResult
  temporalSuggestion: TemporalSuggestion | null
}

interface TextRange {
  start: number
  end: number
}

const LABEL_PATTERN = /(?<!\S)([@#])([\p{L}\p{N}_-]{1,32})\b/gu
const PRIORITY_PATTERN = /(?<!\S)p([1-4])(?=\s|$)/i
const PRIORITY_MAP: Record<string, CapturedPriority> = {
  '1': 'urgent',
  '2': 'high',
  '3': 'medium',
  '4': 'low',
}

export function parseQuickCapture(
  input: string,
  referenceDate = new Date(),
  projects: readonly QuickCaptureProject[] = [],
  recognizeDates = true,
): QuickCaptureResult {
  return analyzeQuickCapture(input, referenceDate, projects, recognizeDates).result
}

export function analyzeQuickCapture(
  input: string,
  referenceDate = new Date(),
  projects: readonly QuickCaptureProject[] = [],
  recognizeDates = true,
): QuickCaptureAnalysis {
  const temporalSuggestion = recognizeDates ? detectTemporalSuggestion(input, referenceDate) : null
  const project = detectProject(input, projects)
  const ranges: TextRange[] = []
  if (temporalSuggestion) ranges.push(toRange(temporalSuggestion))
  if (project) ranges.push(project.range)

  const labels = detectLabels(input, ranges)
  ranges.push(...labels.ranges)

  const priorityMatch = PRIORITY_PATTERN.exec(input)
  const priority = priorityMatch?.[1] ? (PRIORITY_MAP[priorityMatch[1]] ?? null) : null
  if (priorityMatch?.index !== undefined) {
    ranges.push({ start: priorityMatch.index, end: priorityMatch.index + priorityMatch[0].length })
  }

  return {
    result: {
      title: cleanTitle(removeRanges(input, ranges)),
      dueDate: temporalSuggestion?.dueDate ?? null,
      scheduledStart: temporalSuggestion?.scheduledStart ?? null,
      scheduledEnd: temporalSuggestion?.scheduledEnd ?? null,
      labels: labels.values,
      priority,
      projectId: project?.id ?? null,
    },
    temporalSuggestion,
  }
}

function detectProject(input: string, projects: readonly QuickCaptureProject[]) {
  const matches = projects
    .map((project) => {
      const pattern = new RegExp(String.raw`(?<!\S)#${escapeRegExp(project.name)}(?=\s|$)`, 'iu')
      const match = pattern.exec(input)
      return match?.index === undefined
        ? null
        : {
            id: project.id,
            range: { start: match.index, end: match.index + match[0].length },
          }
    })
    .filter(isDefined)
    .sort((left, right) => left.range.start - right.range.start || right.range.end - left.range.end)

  return matches[0] ?? null
}

function detectLabels(input: string, excludedRanges: readonly TextRange[]) {
  const values: string[] = []
  const ranges: TextRange[] = []

  for (const match of input.matchAll(LABEL_PATTERN)) {
    if (match.index === undefined || !match[2]) continue
    const range = { start: match.index, end: match.index + match[0].length }
    const isProjectToken = match[1] === '#' && excludedRanges.some((item) => overlaps(item, range))
    if (isProjectToken) continue
    const label = match[2].toLowerCase()
    if (!values.includes(label) && values.length < 10) values.push(label)
    ranges.push(range)
  }

  return { values, ranges }
}

function removeRanges(input: string, ranges: readonly TextRange[]) {
  if (ranges.length === 0) return input.trim()
  const merged = [...ranges]
    .sort((left, right) => left.start - right.start)
    .reduce<TextRange[]>((result, range) => {
      const previous = result.at(-1)
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end)
      } else {
        result.push({ ...range })
      }
      return result
    }, [])

  let title = ''
  let cursor = 0
  for (const range of merged) {
    title += `${input.slice(cursor, range.start)} `
    cursor = range.end
  }
  return title + input.slice(cursor)
}

function toRange(suggestion: TemporalSuggestion) {
  return { start: suggestion.matchStart, end: suggestion.matchEnd }
}

function overlaps(left: TextRange, right: TextRange) {
  return left.start < right.end && right.start < left.end
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cleanTitle(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/[,:;-]\s*$/, '')
    .trim()
}

function isDefined<T>(value: T | null): value is T {
  return value !== null
}

export { applyDeadlineSuggestion }
