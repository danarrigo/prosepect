import { describe, expect, it } from 'vitest'
import { parseTodoistCsv } from './todoist-import'

const reference = new Date(2026, 7, 29, 9)

describe('parseTodoistCsv', () => {
  it('maps Todoist tasks, subtasks, comments, scheduling, and metadata', () => {
    const csv = [
      'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG',
      'task,Ship launch @urgent,Original context,1,1,,,September 15 2026 at 4pm,en,UTC,90,minute,September 16 2026,en',
      'note,Remember the release notes,,,,,,,,,,,,',
      'task,Prepare screenshots,,3,2,,,,en,UTC,,,,',
      'section,Follow-up,,,,,,,,,,,,',
      'task,Review metrics,,2,1,,,every Monday,en,UTC,,,,',
    ].join('\n')

    const parsed = parseTodoistCsv(csv, 'Imported work', reference)

    expect(parsed.request.project_name).toBe('Imported work')
    expect(parsed.request.tasks).toHaveLength(3)
    expect(parsed.request.tasks[0]).toEqual({
      title: 'Ship launch',
      description: 'Original context\n\nImported Todoist comments:\n- Remember the release notes',
      due_at: '2026-09-16T23:59:00.000Z',
      scheduled_start: '2026-09-15T16:00:00.000Z',
      scheduled_end: '2026-09-15T17:30:00.000Z',
      priority: 'urgent',
      recurrence: 'none',
      labels: ['urgent'],
      parent_index: null,
    })
    expect(parsed.request.tasks[1]).toMatchObject({
      title: 'Prepare screenshots',
      priority: 'medium',
      parent_index: 0,
    })
    expect(parsed.request.tasks[2]).toMatchObject({
      title: 'Review metrics',
      description: 'Imported Todoist section: Follow-up',
      due_at: '2026-08-31T23:59:00.000Z',
      priority: 'high',
      recurrence: 'weekly',
      parent_index: null,
    })
    expect(parsed.report).toMatchObject({
      importedTasks: 3,
      importedComments: 1,
      importedSections: 1,
    })
  })

  it('rejects files that are not Todoist project exports', () => {
    expect(() => parseTodoistCsv('name,due\nTask,tomorrow', 'Broken', reference)).toThrow(
      'Todoist CSV must include TYPE and CONTENT columns',
    )
  })

  it('reports unsupported language and recurrence without silently changing them', () => {
    const csv = [
      'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,DATE,DATE_LANG,TIMEZONE',
      'task,Complex repeat,,4,1,every other Wednesday,de,Europe/Berlin',
    ].join('\n')

    const parsed = parseTodoistCsv(csv, 'Imported', reference)

    expect(parsed.request.tasks[0]).toMatchObject({ recurrence: 'none' })
    expect(parsed.report.warnings.join(' ')).toContain('language')
    expect(parsed.report.warnings.join(' ')).toContain('recurrence')
  })
})
