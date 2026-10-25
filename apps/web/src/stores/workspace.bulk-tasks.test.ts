import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import type { Task } from '../api/types'
import { bulkTaskFields } from '../bulk-tasks'
import { useWorkspaceStore } from './workspace'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof api>()),
  updateTask: vi.fn(),
  deleteTaskWithUndo: vi.fn(),
  listTasks: vi.fn(),
  listProjects: vi.fn(),
  listNotes: vi.fn(),
  listFiles: vi.fn(),
  getDailyPlan: vi.fn(),
  listLabels: vi.fn(),
  listEvents: vi.fn(),
  listCalendars: vi.fn(),
  updateDailyFocus: vi.fn(),
}))
const task: Task = {
  id: 'one',
  title: 'First',
  description: 'Details',
  project_id: null,
  parent_task_id: null,
  due_at: '2030-01-01T12:34:56Z',
  scheduled_start: '2030-01-01T09:01:02Z',
  scheduled_end: '2030-01-01T10:01:02Z',
  remind_at: '2030-01-01T08:00:00Z',
  status: 'todo',
  priority: 'low',
  recurrence: 'daily',
  labels: ['original'],
  position: 0,
  completed_at: null,
  version: 3,
  created_at: '',
  updated_at: '',
}
function workspace() {
  const store = useWorkspaceStore()
  store.user = { id: 'owner', email: 'test@example.test', display_name: 'Owner', timezone: 'UTC' }
  store.tasks = [structuredClone(task), { ...structuredClone(task), id: 'two', title: 'Second' }]
  return store
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  vi.mocked(api.listTasks).mockResolvedValue({ items: [], next_cursor: null })
  vi.mocked(api.listProjects).mockResolvedValue({ items: [], next_cursor: null })
  vi.mocked(api.listNotes).mockResolvedValue([])
  vi.mocked(api.listFiles).mockResolvedValue([])
  vi.mocked(api.getDailyPlan).mockResolvedValue({ date: '2030-01-01', focus_tasks: [] })
  vi.mocked(api.listLabels).mockResolvedValue({ items: [] })
  vi.mocked(api.listEvents).mockResolvedValue([])
  vi.mocked(api.listCalendars).mockResolvedValue([])
})

describe('bulk task writes', () => {
  it('preserves exact saved fields and omits recurrence defaults/scopes', () => {
    const fields = bulkTaskFields(task, { kind: 'label', label: ' original ' })
    expect(fields).toMatchObject({
      due_at: task.due_at,
      scheduled_start: task.scheduled_start,
      labels: ['original'],
      status: 'todo',
    })
    expect(fields).not.toHaveProperty('recurrence')
    expect(fields).not.toHaveProperty('recurrence_scope')
    expect(bulkTaskFields(task, { kind: 'project', projectId: 'new' })).toMatchObject({
      project_id: 'new',
      parent_task_id: null,
    })
  })

  it('uses selected versions and reports partial writes without replaying failures', async () => {
    const store = workspace()
    const selected = [...store.tasks]
    store.tasks[0] = { ...store.tasks[0]!, version: 4 }
    vi.mocked(api.updateTask)
      .mockRejectedValueOnce(new Error('Version conflict'))
      .mockResolvedValueOnce({ ...selected[1]!, priority: 'high', version: 4 })
    await store.applyBulkTaskAction(selected, { kind: 'priority', priority: 'high' })
    expect(api.updateTask).toHaveBeenCalledTimes(2)
    expect(api.updateTask).toHaveBeenNthCalledWith(
      1,
      'one',
      expect.objectContaining({ expected_version: 3, priority: 'high' }),
    )
    expect(store.bulkTaskResults.map((result) => result.outcome)).toEqual(['unconfirmed', 'saved'])
    expect(store.saving).toBe(false)
  })

  it('keeps all controls busy and rejects overlapping batches until refresh finishes', async () => {
    const store = workspace()
    let finish!: (value: Task) => void
    vi.mocked(api.updateTask).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = store.applyBulkTaskAction([task], { kind: 'complete' })
    expect(store.saving).toBe(true)
    await store.applyBulkTaskAction([task], { kind: 'complete' })
    expect(api.updateTask).toHaveBeenCalledTimes(1)
    finish({ ...task, status: 'completed', version: 4 })
    await pending
    expect(store.saving).toBe(false)
  })

  it('does not claim a saved write failed when the subsequent refresh fails', async () => {
    const store = workspace()
    vi.mocked(api.updateTask).mockResolvedValue({ ...task, priority: 'high', version: 4 })
    vi.mocked(api.listTasks).mockRejectedValue(new Error('Refresh unavailable'))
    await store.applyBulkTaskAction([task], { kind: 'priority', priority: 'high' })
    expect(store.bulkTaskResults[0]?.outcome).toBe('saved')
    expect(store.bulkTaskRefreshError).toContain('refresh failed')
  })

  it('retains independent deletion Undo receipts without a permanent-delete fallback', async () => {
    const store = workspace()
    vi.mocked(api.deleteTaskWithUndo).mockImplementation(async (id) => ({
      id: `receipt-${id}`,
      task_id: id,
      task_title: id,
      expires_at: '2030-01-01T00:00:00Z',
    }))
    await store.applyBulkTaskAction([...store.tasks], { kind: 'delete' })
    expect(api.deleteTaskWithUndo).toHaveBeenCalledTimes(2)
    expect(store.taskDeleteUndos).toHaveLength(2)
    expect(store.bulkTaskResults.every((result) => result.outcome === 'saved')).toBe(true)
  })

  it('stops on account changes and never inserts the old account response', async () => {
    const store = workspace()
    let finish!: (value: Task) => void
    vi.mocked(api.updateTask).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = store.applyBulkTaskAction([...store.tasks], { kind: 'complete' })
    store.user = null
    finish({ ...task, version: 4 })
    await pending
    expect(api.updateTask).toHaveBeenCalledTimes(1)
    expect(store.tasks).toEqual([])
    expect(store.bulkTaskResults).toEqual([])
  })

  it('rejects oversized or blank-label batches without requests', async () => {
    const store = workspace()
    await store.applyBulkTaskAction(
      Array.from({ length: 51 }, (_, index) => ({ ...task, id: `${index}` })),
      { kind: 'complete' },
    )
    await store.applyBulkTaskAction([task], { kind: 'label', label: ' ' })
    expect(api.updateTask).not.toHaveBeenCalled()
  })
})
