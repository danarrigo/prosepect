import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import type { GoogleTasksStatus } from '../api/types'
import GoogleTasksPanel from './GoogleTasksPanel.vue'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof api>()),
  getGoogleTasksStatus: vi.fn(),
  getGoogleTaskConflicts: vi.fn(),
  getGoogleTaskRecoveries: vi.fn(),
  leaveGoogleTaskUnlinked: vi.fn(),
  resolveGoogleTaskConflict: vi.fn(),
  listGoogleTaskLists: vi.fn(),
  configureGoogleTasks: vi.fn(),
  createGoogleTaskList: vi.fn(),
  syncGoogleTasks: vi.fn(),
}))
const initial: GoogleTasksStatus = {
  authorized: true,
  enabled: false,
  task_list_id: null,
  timezone: null,
  list_create_attempted: false,
  last_synced_at: null,
  last_error: null,
  version: 0,
}
const wrappers: VueWrapper[] = []
function panel() {
  const wrapper = mount(GoogleTasksPanel)
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`Missing button ${text}`)
  return found
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.getGoogleTasksStatus).mockResolvedValue(initial)
  vi.mocked(api.getGoogleTaskConflicts).mockResolvedValue([])
  vi.mocked(api.getGoogleTaskRecoveries).mockResolvedValue([])
  vi.mocked(api.listGoogleTaskLists).mockResolvedValue([{ id: 'list', title: 'prosepect' }])
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

describe('Google Tasks settings', () => {
  it('requires separate consent and does not enable copying at sign-in', async () => {
    vi.mocked(api.getGoogleTasksStatus).mockResolvedValue({ ...initial, authorized: false })
    const wrapper = panel()
    await flushPromises()
    expect(wrapper.get('a').attributes('href')).toBe('/api/v1/auth/google/tasks/start')
    expect(wrapper.text()).toContain('Connect Google Tasks')
    expect(api.listGoogleTaskLists).not.toHaveBeenCalled()
    expect(api.configureGoogleTasks).not.toHaveBeenCalled()
  })

  it('requires explicit list selection and submits the current settings version', async () => {
    const wrapper = panel()
    await flushPromises()
    expect(button(wrapper, 'Enable Tasks sync').attributes('disabled')).toBeDefined()
    await wrapper.get('select').setValue('list')
    vi.mocked(api.configureGoogleTasks).mockResolvedValue({
      ...initial,
      enabled: true,
      task_list_id: 'list',
      timezone: 'UTC',
      version: 1,
    })
    await button(wrapper, 'Enable Tasks sync').trigger('click')
    await flushPromises()
    expect(api.configureGoogleTasks).toHaveBeenCalledWith({
      enabled: true,
      task_list_id: 'list',
      timezone: expect.any(String),
      expected_version: 0,
    })
    expect(wrapper.text()).toContain('Initial synchronization is queued')
    expect(wrapper.get('select').attributes('disabled')).toBeDefined()
    expect(api.syncGoogleTasks).not.toHaveBeenCalled()
  })

  it('does not retry an ambiguous list creation', async () => {
    vi.mocked(api.listGoogleTaskLists).mockResolvedValue([])
    const wrapper = panel()
    await flushPromises()
    vi.mocked(api.createGoogleTaskList).mockRejectedValue(
      new Error('Google may have created the list'),
    )
    vi.mocked(api.getGoogleTasksStatus).mockResolvedValue({
      ...initial,
      list_create_attempted: true,
      version: 1,
    })
    await button(wrapper, 'Create prosepect list').trigger('click')
    await flushPromises()
    expect(api.createGoogleTaskList).toHaveBeenCalledTimes(1)
    expect(button(wrapper, 'Create prosepect list').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('may have created')
    expect(wrapper.text()).toContain('choose the existing list')
  })

  it('can disable independently even after permission was revoked', async () => {
    vi.mocked(api.getGoogleTasksStatus).mockResolvedValue({
      ...initial,
      authorized: false,
      enabled: true,
      version: 3,
    })
    vi.mocked(api.configureGoogleTasks).mockResolvedValue({
      ...initial,
      authorized: false,
      version: 4,
    })
    const wrapper = panel()
    await flushPromises()
    await button(wrapper, 'Disable Tasks sync').trigger('click')
    await flushPromises()
    expect(api.configureGoogleTasks).toHaveBeenCalledWith({
      enabled: false,
      task_list_id: undefined,
      timezone: undefined,
      expected_version: 3,
    })
    expect(wrapper.text()).toContain('Calendar sync is unchanged')
  })

  it('queues the displayed conflict identity without claiming it is resolved', async () => {
    vi.mocked(api.getGoogleTasksStatus).mockResolvedValue({ ...initial, enabled: true })
    vi.mocked(api.getGoogleTaskConflicts).mockResolvedValue([
      {
        id: 'snapshot',
        link_id: 'link',
        task_id: 'task',
        task_version: 3,
        remote_etag: 'etag',
        local: { title: 'Local rename', date: null, completed: false },
        google: { title: 'Google rename', date: '2026-10-03', completed: false },
      },
    ])
    vi.mocked(api.resolveGoogleTaskConflict).mockResolvedValue(undefined)
    const wrapper = panel()
    await flushPromises()
    expect(wrapper.text()).toContain('Google rename')
    await button(wrapper, 'Keep prosepect edits').trigger('click')
    await flushPromises()
    expect(api.resolveGoogleTaskConflict).toHaveBeenCalledWith('link', {
      conflict_id: 'snapshot',
      choice: 'prosepect',
    })
    expect(button(wrapper, 'Keep Google edits').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="status"]').text()).toContain('checked again')
  })

  it('can leave uncertain creation unlinked while Google is unavailable, with confirmation', async () => {
    vi.mocked(api.getGoogleTaskRecoveries).mockResolvedValue([
      { link_id: 'uncertain', task_id: 'task', title: 'Unconfirmed task' },
    ])
    vi.mocked(api.listGoogleTaskLists).mockRejectedValue(new Error('Google is unavailable'))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(api.leaveGoogleTaskUnlinked).mockResolvedValue(undefined)
    const wrapper = panel()
    await flushPromises()
    expect(wrapper.text()).toContain('Unconfirmed task')
    await button(wrapper, 'Leave unlinked').trigger('click')
    expect(api.leaveGoogleTaskUnlinked).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await button(wrapper, 'Leave unlinked').trigger('click')
    await flushPromises()
    expect(api.leaveGoogleTaskUnlinked).toHaveBeenCalledWith('uncertain')
    expect(wrapper.get('[role="status"]').text()).toContain('no replacement')
    expect(api.createGoogleTaskList).not.toHaveBeenCalled()
    expect(api.syncGoogleTasks).not.toHaveBeenCalled()
  })

  it('aborts pending private reads when the panel unmounts', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(api.getGoogleTasksStatus).mockImplementation((current) => {
      signal = current
      return new Promise(() => {})
    })
    const wrapper = panel()
    expect(signal?.aborted).toBe(false)
    wrapper.unmount()
    expect(signal?.aborted).toBe(true)
  })
})
