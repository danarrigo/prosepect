import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import type {
  CalendarEvent,
  DailyPlan,
  FileRecord,
  Note,
  Project,
  Task,
  TaskDeleteUndo,
  UserSettings,
} from '../api/types'
import { useWorkspaceStore } from './workspace'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof api>()),
  deleteTaskWithUndo: vi.fn(),
  consumeTaskDeleteUndo: vi.fn(),
  listTaskDeleteUndos: vi.fn(),
  deleteTask: vi.fn(),
  listTasks: vi.fn(),
  listProjects: vi.fn(),
  listNotes: vi.fn(),
  listFiles: vi.fn(),
  getDailyPlan: vi.fn(),
  listLabels: vi.fn(),
  listEvents: vi.fn(),
  listCalendars: vi.fn(),
  getSettings: vi.fn(),
  getSession: vi.fn(),
  getOperationsCapability: vi.fn(),
  listCalendarMoveUndos: vi.fn(),
  logout: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  getFileUsage: vi.fn(),
}))

const account = (id: string) => ({
  id,
  email: `${id}@test.invalid`,
  display_name: id,
  timezone: 'UTC',
})
const task = { id: 'task', title: 'Private task', version: 4, position: 0 } as Task
const receipt: TaskDeleteUndo = {
  id: 'receipt',
  task_id: task.id,
  task_title: task.title,
  expires_at: new Date(Date.now() + 60000).toISOString(),
}
const settings = { version: 1, automatic_daily_review: false, theme: 'dark' } as UserSettings
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function workspace() {
  const store = useWorkspaceStore()
  store.user = account('A')
  store.tasks = [task]
  store.settings = settings
  return store
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  vi.mocked(api.listTasks).mockResolvedValue({ items: [], next_cursor: null })
  vi.mocked(api.listProjects).mockResolvedValue({ items: [], next_cursor: null })
  vi.mocked(api.listNotes).mockResolvedValue([])
  vi.mocked(api.listFiles).mockResolvedValue([])
  vi.mocked(api.getDailyPlan).mockResolvedValue({
    focus_task_ids: [],
    focus_tasks: [],
  } as unknown as DailyPlan)
  vi.mocked(api.listLabels).mockResolvedValue({ items: [] })
  vi.mocked(api.listEvents).mockResolvedValue([])
  vi.mocked(api.listCalendars).mockResolvedValue([])
  vi.mocked(api.getSettings).mockResolvedValue(settings)
  vi.mocked(api.getSession).mockResolvedValue({ user: account('A'), csrf_token: 'token' })
  vi.mocked(api.getOperationsCapability).mockResolvedValue(false)
  vi.mocked(api.listCalendarMoveUndos).mockResolvedValue([])
  vi.mocked(api.listTaskDeleteUndos).mockResolvedValue([])
  vi.mocked(api.deleteTaskWithUndo).mockResolvedValue(receipt)
  vi.mocked(api.consumeTaskDeleteUndo).mockResolvedValue(undefined)
  vi.mocked(api.getFileUsage).mockResolvedValue({
    used_bytes: 0,
    max_user_storage_bytes: 1000000,
    max_file_size_bytes: 1000000,
  })
})

describe('workspace task deletion Undo', () => {
  it.each(['create', 'edit', 'delete'] as const)(
    'preserves a successful note %s during an older Undo refresh',
    async (operation) => {
      const store = workspace()
      const note = { id: 'note', title: 'Before', markdown: '', version: 1 } as Note
      const updated = { ...note, title: 'Saved', version: 2 }
      store.notes = [note]
      store.taskDeleteUndos = [receipt]
      const pending = deferred<FileRecord[]>()
      vi.mocked(api.listFiles).mockReturnValueOnce(pending.promise)
      vi.mocked(api.listNotes).mockResolvedValue([note])
      vi.mocked(api.createNote).mockResolvedValue(updated)
      vi.mocked(api.updateNote).mockResolvedValue(updated)
      vi.mocked(api.deleteNote).mockResolvedValue(undefined)
      const undo = store.undoTaskDeletion(receipt)
      await vi.waitFor(() => expect(api.listFiles).toHaveBeenCalled())
      if (operation === 'create') await store.addNote({ title: updated.title, markdown: '' })
      else if (operation === 'edit') await store.editNote(note, updated.title, '')
      else await store.removeNote(note)
      const saved = [...store.notes]
      pending.resolve([])
      await undo
      expect(store.notes).toEqual(saved)
      expect(store.taskDeleteError).toContain('refresh failed')
      expect(store.taskDeleteUndos).toEqual([])
    },
  )

  it.each(['upload', 'delete'] as const)(
    'preserves a successful attachment %s during an older Undo refresh',
    async (operation) => {
      const store = workspace()
      const file = { id: 'file', filename: 'saved.txt' } as FileRecord
      store.files = operation === 'delete' ? [file] : []
      store.taskDeleteUndos = [receipt]
      const pending = deferred<Note[]>()
      vi.mocked(api.listNotes).mockReturnValueOnce(pending.promise)
      vi.mocked(api.listFiles).mockResolvedValue([...store.files])
      vi.mocked(api.uploadFile).mockResolvedValue(file)
      vi.mocked(api.deleteFile).mockResolvedValue(undefined)
      const undo = store.undoTaskDeletion(receipt)
      await vi.waitFor(() => expect(api.listNotes).toHaveBeenCalled())
      if (operation === 'upload') await store.addFile(new File(['test'], 'saved.txt'))
      else await store.removeFile(file)
      const saved = [...store.files]
      const restoredNote = { id: 'restored-note' } as Note
      pending.resolve([restoredNote])
      await undo
      expect(store.files).toEqual(saved)
      expect(store.notes).toEqual([restoredNote])
      expect(store.taskDeleteError).toContain('refresh failed')
    },
  )

  it('uses expected_version, retains distinct receipts and never calls legacy DELETE', async () => {
    const store = workspace()
    await store.removeTask(task)
    vi.mocked(api.deleteTaskWithUndo).mockResolvedValue({
      ...receipt,
      id: 'second',
      task_id: 'second',
    })
    await store.removeTask({ ...task, id: 'second' })
    expect(api.deleteTaskWithUndo).toHaveBeenNthCalledWith(1, task.id, 4)
    expect(api.deleteTask).not.toHaveBeenCalled()
    expect(store.taskDeleteUndos.map((item) => item.id)).toEqual(['second', 'receipt'])
    expect(api.getSettings).not.toHaveBeenCalled()
    expect(store.settings).toEqual(settings)
  })

  it('refuses without removing the task, earlier receipts, or using permanent deletion', async () => {
    const store = workspace()
    store.taskDeleteUndos = [receipt]
    vi.mocked(api.deleteTaskWithUndo).mockRejectedValue(
      new api.ApiError('Mapping is uncertain', 409, 'conflict'),
    )
    await expect(store.removeTask(task)).rejects.toThrow('Mapping is uncertain')
    expect(store.tasks).toEqual([task])
    expect(store.taskDeleteUndos).toEqual([receipt])
    expect(store.error).toContain('Mapping is uncertain')
    expect(api.deleteTask).not.toHaveBeenCalled()
  })

  it('keeps saved deletion usable on dependent refresh failure; retry is honest', async () => {
    const store = workspace()
    vi.mocked(api.listNotes).mockRejectedValue(new Error('Offline'))
    expect(await store.removeTask(task)).toBe(true)
    expect(store.taskDeleteMessage).toContain('Deleted')
    expect(store.taskDeleteError).toContain('Deletion saved, but refresh failed')
    expect(store.taskDeleteUndos).toEqual([receipt])
    expect(store.tasks).toEqual([])
    vi.mocked(api.listTaskDeleteUndos).mockResolvedValue([receipt])
    await store.retryTaskDeletionRefresh()
    expect(store.taskDeleteError).toContain('Refresh failed')
    vi.mocked(api.listNotes).mockResolvedValue([])
    await store.retryTaskDeletionRefresh()
    expect(store.taskDeleteError).toBe('')
  })

  it('refreshes restored identity, notes, file links, focus plan and project summaries without settings', async () => {
    const store = workspace()
    store.taskDeleteUndos = [receipt]
    const restored = { ...task, version: 5 }
    const note = { id: 'note', task_id: task.id, markdown: 'preserved' } as Note
    const file = { id: 'file', note_id: note.id } as FileRecord
    const project = { id: 'project', total_tasks: 1 } as Project
    const plan = { focus_tasks: [restored] } as DailyPlan
    vi.mocked(api.listTasks).mockResolvedValue({ items: [restored], next_cursor: null })
    vi.mocked(api.listNotes).mockResolvedValue([note])
    vi.mocked(api.listFiles).mockResolvedValue([file])
    vi.mocked(api.listProjects).mockResolvedValue({ items: [project], next_cursor: null })
    vi.mocked(api.getDailyPlan).mockResolvedValue(plan)
    await store.undoTaskDeletion(receipt)
    expect(api.consumeTaskDeleteUndo).toHaveBeenCalledExactlyOnceWith(receipt.id)
    expect(store.tasks).toEqual([restored])
    expect(store.notes).toEqual([note])
    expect(store.files).toEqual([file])
    expect(store.projects).toEqual([project])
    expect(store.dailyPlan).toEqual(plan)
    expect(store.taskDeleteUndos).toEqual([])
    expect(store.taskDeleteMessage).toBe('Restored “Private task”.')
    expect(api.getSettings).not.toHaveBeenCalled()
  })

  it('reports successful restore separately from refresh failure without reoffering consumed Undo', async () => {
    const store = workspace()
    store.taskDeleteUndos = [receipt]
    vi.mocked(api.listTasks).mockRejectedValue(new Error('Offline'))
    await store.undoTaskDeletion(receipt)
    expect(store.taskDeleteMessage).toContain('Restored')
    expect(store.taskDeleteError).toContain('Restoration saved, but refresh failed')
    expect(store.taskDeleteUndos).toEqual([])
  })

  it('re-fetches after authoritative refusal and keeps a retryable receipt until server removes it', async () => {
    const store = workspace()
    store.taskDeleteUndos = [receipt]
    vi.mocked(api.consumeTaskDeleteUndo).mockRejectedValue(
      new api.ApiError('Google validation unavailable', 503, 'unavailable'),
    )
    vi.mocked(api.listTaskDeleteUndos).mockResolvedValue([receipt])
    await store.undoTaskDeletion(receipt)
    expect(store.taskDeleteUndos).toEqual([receipt])
    expect(store.taskDeleteError).toContain('Google validation unavailable')
    expect(store.taskDeleteMessage).not.toContain('Restored')
    vi.mocked(api.listTaskDeleteUndos).mockResolvedValue([])
    await store.undoTaskDeletion(receipt)
    expect(store.taskDeleteUndos).toEqual([])
  })

  it('recovers receipts even if bootstrap notes fail', async () => {
    const store = useWorkspaceStore()
    vi.mocked(api.listNotes).mockRejectedValue(new Error('Offline'))
    vi.mocked(api.listTaskDeleteUndos).mockResolvedValue([receipt])
    await store.bootstrap()
    expect(store.taskDeleteUndos).toEqual([receipt])
    expect(store.error).toBe('Offline')
  })

  it('does not apply a stale bootstrap snapshot or its failure over a deletion', async () => {
    const store = workspace()
    const read = deferred<Note[]>()
    vi.mocked(api.listNotes).mockReturnValueOnce(read.promise)
    const boot = store.bootstrap()
    await vi.waitFor(() => expect(api.listNotes).toHaveBeenCalledOnce())
    await store.removeTask(task)
    read.reject(new Error('Old failure'))
    await boot
    expect(store.tasks).toEqual([])
    expect(store.error).toBeNull()
    expect(store.taskDeleteUndos).toEqual([receipt])
  })

  it('invalidates initial and background calendar reads at mutation start', async () => {
    const store = workspace()
    const initial = deferred<CalendarEvent[]>()
    vi.mocked(api.listEvents).mockReturnValueOnce(initial.promise)
    const load = store.loadCalendarRange(new Date('2026-01-01'), new Date('2026-01-02'))
    const deletion = deferred<TaskDeleteUndo>()
    vi.mocked(api.deleteTaskWithUndo).mockReturnValueOnce(deletion.promise)
    const saving = store.removeTask(task)
    initial.resolve([{ id: 'stale' } as CalendarEvent])
    await load
    expect(store.events).toEqual([])
    deletion.resolve(receipt)
    await saving
    const background = deferred<CalendarEvent[]>()
    vi.mocked(api.listEvents).mockReturnValueOnce(background.promise)
    const refresh = store.refreshCalendarRange(new AbortController().signal, () => true)
    await store.undoTaskDeletion(receipt)
    background.resolve([{ id: 'stale' } as CalendarEvent])
    expect(await refresh).toBe(false)
    expect(store.events).toEqual([])
  })

  it('does not overwrite a newer calendar range with deletion refresh', async () => {
    const store = workspace()
    const old = deferred<CalendarEvent[]>()
    vi.mocked(api.listEvents).mockReturnValueOnce(old.promise)
    const saving = store.removeTask(task)
    await vi.waitFor(() => expect(api.listEvents).toHaveBeenCalledOnce())
    vi.mocked(api.listEvents).mockResolvedValue([{ id: 'new-range' } as CalendarEvent])
    await store.loadCalendarRange(new Date('2026-03-01'), new Date('2026-03-02'))
    old.resolve([{ id: 'old-range' } as CalendarEvent])
    await saving
    expect(store.events.map((event) => event.id)).toEqual(['new-range'])
  })

  it('never resurrects a consumed receipt from an earlier recovery read', async () => {
    const store = workspace()
    store.taskDeleteUndos = [receipt]
    const old = deferred<TaskDeleteUndo[]>()
    vi.mocked(api.listTaskDeleteUndos).mockReturnValueOnce(old.promise)
    const recovery = store.recoverTaskDeleteUndos()
    await store.undoTaskDeletion(receipt)
    old.resolve([receipt])
    await recovery
    expect(store.taskDeleteUndos).toEqual([])
  })

  it('rejects a receipt read started during deletion but returned after saved receipt', async () => {
    const store = workspace()
    const deletion = deferred<TaskDeleteUndo>()
    vi.mocked(api.deleteTaskWithUndo).mockReturnValueOnce(deletion.promise)
    const saving = store.removeTask(task)
    const old = deferred<TaskDeleteUndo[]>()
    vi.mocked(api.listTaskDeleteUndos).mockReturnValueOnce(old.promise)
    const recovery = store.recoverTaskDeleteUndos()
    deletion.resolve(receipt)
    await saving
    old.resolve([])
    await recovery
    expect(store.taskDeleteUndos).toEqual([receipt])
  })

  it('rejects old A responses after A → B → A and clears all private workspace state', async () => {
    const store = workspace()
    store.notes = [{ id: 'private' } as Note]
    store.dailyPlan = { focus_tasks: [task] } as DailyPlan
    const old = deferred<TaskDeleteUndo>()
    vi.mocked(api.deleteTaskWithUndo).mockReturnValueOnce(old.promise)
    const saving = store.removeTask(task)
    store.user = account('B')
    store.user = account('A')
    old.resolve(receipt)
    expect(await saving).toBe(false)
    expect(store.taskDeleteUndos).toEqual([])
    expect(store.taskDeleteMessage).toBe('')
    expect(store.notes).toEqual([])
    expect(store.dailyPlan).toBeNull()
    expect(store.settings).toBeNull()
  })

  it('an old-account consume cannot announce success or unlock a newer pending deletion', async () => {
    const store = workspace()
    store.taskDeleteUndos = [receipt]
    const consume = deferred<void>()
    vi.mocked(api.consumeTaskDeleteUndo).mockReturnValueOnce(consume.promise)
    const undo = store.undoTaskDeletion(receipt)
    store.user = account('B')
    const deletion = deferred<TaskDeleteUndo>()
    vi.mocked(api.deleteTaskWithUndo).mockReturnValueOnce(deletion.promise)
    const saving = store.removeTask(task)
    consume.resolve()
    await undo
    expect(store.taskDeleteMessage).toBe('')
    expect(store.taskDeletePending).toBe(true)
    expect(store.saving).toBe(true)
    deletion.resolve({ ...receipt, id: 'account-B-receipt' })
    await saving
    expect(store.taskDeleteUndos.map((item) => item.id)).toEqual(['account-B-receipt'])
  })

  it('logout rejects late session bootstrap, recovery and mutation refresh', async () => {
    const store = workspace()
    const session = deferred<Awaited<ReturnType<typeof api.getSession>>>()
    vi.mocked(api.getSession).mockReturnValueOnce(session.promise)
    const boot = store.bootstrap()
    const recoveryRead = deferred<TaskDeleteUndo[]>()
    vi.mocked(api.listTaskDeleteUndos).mockReturnValueOnce(recoveryRead.promise)
    const recovery = store.recoverTaskDeleteUndos()
    const taskRead = deferred<Awaited<ReturnType<typeof api.listTasks>>>()
    vi.mocked(api.listTasks).mockReturnValueOnce(taskRead.promise)
    const saving = store.removeTask(task)
    await vi.waitFor(() => expect(api.listTasks).toHaveBeenCalledOnce())
    await store.logout()
    expect(vi.mocked(api.getSession).mock.calls[0]?.[0]?.aborted).toBe(true)
    taskRead.resolve({ items: [task], next_cursor: null })
    recoveryRead.resolve([receipt])
    session.resolve({ user: account('A'), csrf_token: 'token' })
    await Promise.all([boot, recovery, saving])
    expect(store.user).toBeNull()
    expect(store.tasks).toEqual([])
    expect(store.taskDeleteUndos).toEqual([])
    expect(store.taskDeleteMessage).toBe('')
    expect(store.authenticationRequired).toBe(true)
  })
})
