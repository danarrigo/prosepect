import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import type { CalendarEvent, CalendarMoveUndo, Task } from '../api/types'
import { useWorkspaceStore } from './workspace'

vi.mock('../api/client', () => ({
  moveCalendarEvent: vi.fn(),
  moveScheduledTask: vi.fn(),
  undoCalendarMove: vi.fn(),
  listTasks: vi.fn(),
  listEvents: vi.fn(),
  getSession: vi.fn(),
  getOperationsCapability: vi.fn(),
  listProjects: vi.fn(),
  listLabels: vi.fn(),
  getDailyPlan: vi.fn(),
  listCalendars: vi.fn(),
  listNotes: vi.fn(),
  listFiles: vi.fn(),
  getSettings: vi.fn(),
  listCalendarMoveUndos: vi.fn(),
}))

const event: CalendarEvent = {
  id: 'event',
  calendar_id: 'calendar',
  linked_task_id: null,
  title: 'Keep content',
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
const receipt: CalendarMoveUndo = {
  id: 'receipt',
  event_id: event.id,
  task_id: null,
  expires_at: '2026-09-13T09:01:00Z',
}
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

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  vi.mocked(api.listTasks).mockResolvedValue({ items: [], next_cursor: null })
  vi.mocked(api.listEvents).mockResolvedValue([])
  vi.mocked(api.moveCalendarEvent).mockResolvedValue(receipt)
  vi.mocked(api.moveScheduledTask).mockResolvedValue({ ...receipt, task_id: 'task' })
})

describe('workspace calendar move receipts', () => {
  it('sends only schedule and version, ignores no-ops and serializes pending gestures', async () => {
    const store = useWorkspaceStore()
    store.user = account('one')
    expect(await store.moveCalendarItem(event, event.starts_at, event.ends_at)).toBe(false)
    expect(api.moveCalendarEvent).not.toHaveBeenCalled()
    const pending = deferred<CalendarMoveUndo>()
    vi.mocked(api.moveCalendarEvent).mockReturnValue(pending.promise)
    const moving = store.moveCalendarItem(event, '2026-09-13T10:00:00Z', '2026-09-13T11:00:00Z')
    expect(
      await store.moveCalendarItem(event, '2026-09-13T11:00:00Z', '2026-09-13T12:00:00Z'),
    ).toBe(false)
    expect(api.moveCalendarEvent).toHaveBeenCalledExactlyOnceWith('event', {
      starts_at: '2026-09-13T10:00:00Z',
      ends_at: '2026-09-13T11:00:00Z',
      expected_version: 1,
    })
    expect(store.calendarMoveUndo).toBeNull()
    pending.resolve(receipt)
    expect(await moving).toBe(true)
    expect(store.calendarMoveUndo).toEqual(receipt)
  })

  it('routes scheduled-task resize through the receipt endpoint', async () => {
    const store = useWorkspaceStore()
    store.user = account('one')
    const task = {
      id: 'task',
      scheduled_start: event.starts_at,
      scheduled_end: event.ends_at,
      version: 4,
    } as Task
    await store.moveCalendarItem(task, event.starts_at, '2026-09-13T10:15:00Z')
    expect(api.moveScheduledTask).toHaveBeenCalledWith('task', {
      starts_at: event.starts_at,
      ends_at: '2026-09-13T10:15:00Z',
      expected_version: 4,
    })
    expect(api.moveCalendarEvent).not.toHaveBeenCalled()
  })

  it('does not announce a rejected move as saved or discard an earlier receipt', async () => {
    const store = useWorkspaceStore()
    store.user = account('one')
    store.calendarMoveUndo = receipt
    vi.mocked(api.moveCalendarEvent).mockRejectedValue(new Error('Sync busy'))
    expect(await store.moveCalendarItem(event, 'later', 'later still')).toBe(false)
    expect(store.calendarMoveUndo).toEqual(receipt)
    expect(store.calendarMoveMessage).toBe('')
    expect(store.calendarMoveError).toBe('Sync busy')
    expect(store.saving).toBe(false)
  })

  it('discards old-account responses and never unlocks a newer pending move', async () => {
    const store = useWorkspaceStore()
    store.user = account('one')
    const old = deferred<CalendarMoveUndo>()
    const current = deferred<CalendarMoveUndo>()
    vi.mocked(api.moveCalendarEvent)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise)
    const first = store.moveCalendarItem(event, 'a', 'b')
    store.user = account('two')
    const second = store.moveCalendarItem(event, 'c', 'd')
    old.resolve(receipt)
    expect(await first).toBe(false)
    expect(store.calendarMoveUndo).toBeNull()
    expect(store.calendarMovePending).toBe(true)
    current.resolve({ ...receipt, id: 'new-account' })
    await second
    expect(store.calendarMoveUndo?.id).toBe('new-account')
  })

  it('discards refresh results after switching away and back to the same account', async () => {
    const store = useWorkspaceStore()
    store.user = account('one')
    const reload = deferred<Awaited<ReturnType<typeof api.listTasks>>>()
    vi.mocked(api.listTasks).mockReturnValue(reload.promise)
    const moving = store.moveCalendarItem(event, 'a', 'b')
    await vi.waitFor(() => expect(api.listTasks).toHaveBeenCalled())
    store.user = null
    store.user = account('one')
    reload.resolve({ items: [{ id: 'old-account-task' } as Task], next_cursor: null })
    await moving
    expect(store.tasks).toEqual([])
    expect(store.calendarMoveUndo).toBeNull()
    expect(store.calendarMoveError).toBe('')
  })

  it('preserves the receipt after failed Undo and does not repeat successful consume', async () => {
    const store = useWorkspaceStore()
    store.user = account('one')
    store.calendarMoveUndo = receipt
    vi.mocked(api.undoCalendarMove)
      .mockRejectedValueOnce(new Error('Item changed'))
      .mockResolvedValueOnce()
    await store.undoCalendarMove()
    expect(store.calendarMoveError).toBe('Item changed')
    expect(store.calendarMoveUndo).toEqual(receipt)
    await store.undoCalendarMove()
    expect(store.calendarMoveUndo).toBeNull()
    expect(store.calendarMoveMessage).toBe('Move undone.')
    await store.undoCalendarMove()
    expect(api.undoCalendarMove).toHaveBeenCalledTimes(2)
  })

  it('keeps server-confirmed Undo available if calendar refresh fails', async () => {
    const store = useWorkspaceStore()
    store.user = account('one')
    vi.mocked(api.listTasks).mockRejectedValue(new Error('Offline'))
    expect(await store.moveCalendarItem(event, 'a', 'b')).toBe(true)
    expect(store.calendarMoveUndo).toEqual(receipt)
    expect(store.calendarMoveError).toContain('Move saved. Reload')
  })
})
