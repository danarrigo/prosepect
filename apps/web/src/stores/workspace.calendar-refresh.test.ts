import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import type { CalendarEvent, Task } from '../api/types'
import { useWorkspaceStore } from './workspace'

vi.mock('../api/client', () => ({
  listEvents: vi.fn(),
  listTasks: vi.fn(),
  listCalendars: vi.fn(),
}))

const event: CalendarEvent = {
  id: 'event',
  calendar_id: 'calendar',
  linked_task_id: null,
  title: 'Original',
  description: '',
  starts_at: '2026-09-13T09:00:00Z',
  ends_at: '2026-09-13T10:00:00Z',
  all_day: false,
  timezone: 'UTC',
  location: '',
  attendees: [],
  recurrence: 'none',
  recurrence_until: null,
  created_at: '',
  updated_at: '',
  version: 1,
}
const task: Task = {
  id: 'task',
  project_id: null,
  parent_task_id: null,
  title: 'Scheduled task',
  description: '',
  due_at: null,
  scheduled_start: event.starts_at,
  scheduled_end: event.ends_at,
  status: 'todo',
  priority: 'medium',
  recurrence: 'none',
  labels: [],
  remind_at: null,
  completed_at: null,
  position: 1024,
  created_at: '',
  updated_at: '',
  version: 1,
}
const calendar = {
  id: 'calendar',
  name: 'Google',
  color: '#64748b',
  source: 'google' as const,
  selected: true,
  is_default: false,
  version: 1,
  created_at: '',
  updated_at: '',
}
const start = new Date('2026-09-13T00:00:00Z')
const end = new Date('2026-09-14T00:00:00Z')
const account = (id: string) => ({
  id,
  email: `${id}@example.test`,
  display_name: id,
  timezone: 'UTC',
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function setup() {
  const store = useWorkspaceStore()
  store.user = account('one')
  store.calendars = [calendar]
  store.tasks = [{ ...task }]
  await store.loadCalendarRange(start, end)
  vi.mocked(api.listEvents).mockResolvedValue([{ ...event, title: 'Google update', version: 2 }])
  return store
}
beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  vi.mocked(api.listEvents).mockResolvedValue([{ ...event }])
  vi.mocked(api.listTasks).mockResolvedValue({ items: [task], next_cursor: null })
  vi.mocked(api.listCalendars).mockResolvedValue([calendar])
})

describe('calendar background snapshots', () => {
  it('refreshes the active range, calendars and every task page without touching drafts or settings', async () => {
    const store = await setup()
    const signal = new AbortController().signal
    vi.mocked(api.listTasks)
      .mockResolvedValueOnce({ items: [], next_cursor: 'next' })
      .mockResolvedValueOnce({
        items: [{ ...task, scheduled_start: '2026-09-13T11:00:00Z', version: 2 }],
        next_cursor: null,
      })
    vi.mocked(api.listCalendars).mockResolvedValue([{ ...calendar, name: 'Renamed in Google' }])
    expect(await store.refreshCalendarRange(signal, () => true)).toBe(true)
    expect(api.listEvents).toHaveBeenLastCalledWith(end.toISOString(), start.toISOString(), signal)
    expect(api.listTasks).toHaveBeenLastCalledWith(undefined, 'next', signal)
    expect(store.events[0]?.title).toBe('Google update')
    expect(store.tasks[0]?.scheduled_start).toBe('2026-09-13T11:00:00Z')
    expect(store.calendars[0]?.name).toBe('Renamed in Google')
    expect(store.settings).toBeNull()
    expect(store.dailyReview).toBeNull()
    expect(store.saving).toBe(false)
  })

  it('does not fetch without an account or while interaction is paused', async () => {
    const store = await setup()
    vi.mocked(api.listEvents).mockClear()
    expect(await store.refreshCalendarRange(new AbortController().signal, () => false)).toBe(false)
    store.saving = true
    expect(await store.refreshCalendarRange(new AbortController().signal, () => true)).toBe(false)
    store.saving = false
    store.user = null
    expect(await store.refreshCalendarRange(new AbortController().signal, () => true)).toBe(false)
    expect(api.listEvents).not.toHaveBeenCalled()
  })

  for (const change of [
    'abort',
    'editor',
    'account',
    'local write',
    'gesture',
    'new range',
  ] as const) {
    it(`discards an in-flight snapshot after ${change}`, async () => {
      const store = await setup()
      const delayed = deferred<CalendarEvent[]>()
      vi.mocked(api.listEvents).mockReturnValueOnce(delayed.promise)
      const controller = new AbortController()
      let canApply = true
      const refresh = store.refreshCalendarRange(controller.signal, () => canApply)
      if (change === 'abort') controller.abort()
      if (change === 'editor') canApply = false
      if (change === 'account') {
        store.user = null
        store.user = account('one')
      }
      if (change === 'local write') store.events[0] = { ...event, title: 'Local edit', version: 2 }
      if (change === 'gesture') {
        store.saving = true
        store.saving = false
      }
      if (change === 'new range') {
        vi.mocked(api.listEvents).mockResolvedValueOnce([])
        await store.loadCalendarRange(end, new Date('2026-09-15T00:00:00Z'))
      }
      const before = structuredClone(JSON.parse(JSON.stringify(store.events)))
      delayed.resolve([{ ...event, title: 'Stale snapshot' }])
      expect(await refresh).toBe(false)
      expect(store.events).toEqual(before)
    })
  }

  it('keeps only the latest overlapping read', async () => {
    const store = await setup()
    const delayed = deferred<CalendarEvent[]>()
    vi.mocked(api.listEvents).mockReturnValueOnce(delayed.promise)
    const old = store.refreshCalendarRange(new AbortController().signal, () => true)
    expect(await store.refreshCalendarRange(new AbortController().signal, () => true)).toBe(true)
    delayed.resolve([{ ...event, title: 'Older result' }])
    expect(await old).toBe(false)
    expect(store.events[0]?.title).toBe('Google update')
  })

  it('leaves all loaded data intact on partial failure, then allows a retry', async () => {
    const store = await setup()
    vi.mocked(api.listTasks).mockRejectedValueOnce(new Error('offline'))
    await expect(
      store.refreshCalendarRange(new AbortController().signal, () => true),
    ).rejects.toThrow('offline')
    expect(store.events[0]?.title).toBe('Original')
    expect(store.calendars[0]?.name).toBe('Google')
    expect(await store.refreshCalendarRange(new AbortController().signal, () => true)).toBe(true)
    expect(store.events[0]?.title).toBe('Google update')
  })
})
