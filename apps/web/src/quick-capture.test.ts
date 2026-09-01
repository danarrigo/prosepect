import { describe, expect, it } from 'vitest'
import { parseQuickCapture } from './quick-capture'

describe('parseQuickCapture', () => {
  it('extracts a relative date, time, and normalized labels', () => {
    const parsed = parseQuickCapture(
      'Submit report tomorrow at 3:30pm #Work #review',
      new Date(2026, 7, 29, 9),
    )

    expect(parsed).toEqual({
      title: 'Submit report',
      dueDate: '2026-08-30',
      scheduledStart: '2026-08-30T15:30',
      scheduledEnd: '2026-08-30T16:30',
      labels: ['work', 'review'],
      priority: null,
      projectId: null,
    })
  })

  it('deduplicates labels and accepts 24-hour time', () => {
    const parsed = parseQuickCapture(
      'Call supplier at 14:00 #Errands #errands',
      new Date(2026, 7, 29, 9),
    )

    expect(parsed.title).toBe('Call supplier')
    expect(parsed.dueDate).toBeNull()
    expect(parsed.scheduledStart).toBe('2026-08-29T14:00')
    expect(parsed.scheduledEnd).toBe('2026-08-29T15:00')
    expect(parsed.labels).toEqual(['errands'])
    expect(parsed.priority).toBeNull()
    expect(parsed.projectId).toBeNull()
  })

  it('understands Todoist-style dates, projects, labels, and priorities', () => {
    const parsed = parseQuickCapture(
      'Ship release next Friday #Work @urgent p1',
      new Date(2026, 7, 29, 9),
      [{ id: 'work-id', name: 'Work' }],
    )

    expect(parsed).toEqual({
      title: 'Ship release',
      dueDate: '2026-09-11',
      scheduledStart: null,
      scheduledEnd: null,
      labels: ['urgent'],
      priority: 'urgent',
      projectId: 'work-id',
    })
  })

  it('understands natural month names, word-based durations, and day periods', () => {
    const reference = new Date(2026, 7, 29, 9)

    expect(parseQuickCapture('Plan launch in two weeks', reference).dueDate).toBe('2026-09-12')
    expect(parseQuickCapture('Renew license September 15', reference).dueDate).toBe('2026-09-15')
    expect(parseQuickCapture('Call supplier tomorrow afternoon', reference)).toMatchObject({
      title: 'Call supplier',
      dueDate: '2026-08-30',
      scheduledStart: '2026-08-30T12:00',
      scheduledEnd: '2026-08-30T13:00',
    })
  })

  it('can keep a detected date as literal title text', () => {
    const parsed = parseQuickCapture(
      'Discuss next Friday #Work',
      new Date(2026, 7, 29, 9),
      [{ id: 'work-id', name: 'Work' }],
      false,
    )

    expect(parsed).toMatchObject({
      title: 'Discuss next Friday',
      dueDate: null,
      projectId: 'work-id',
    })
  })

  it('leaves ordinary title content unchanged', () => {
    expect(parseQuickCapture('Review C# proposal', new Date(2026, 7, 29, 9))).toEqual({
      title: 'Review C# proposal',
      dueDate: null,
      scheduledStart: null,
      scheduledEnd: null,
      labels: [],
      priority: null,
      projectId: null,
    })
  })
})
