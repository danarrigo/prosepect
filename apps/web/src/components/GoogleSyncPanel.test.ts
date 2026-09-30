import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '../api/client'
import type { SyncConflict } from '../api/types'
import GoogleSyncPanel from './GoogleSyncPanel.vue'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof api>()),
  __v_isRef: false,
  getGoogleIntegration: vi.fn(),
  listSyncConflicts: vi.fn(),
  listActivity: vi.fn(),
  resolveSyncConflict: vi.fn(),
}))
const special = {
  id: 'special',
  title: 'Deleted task',
  canonical_event_id: 'not-null',
  allowed_resolutions: ['google'],
} as SyncConflict
const ordinary = {
  id: 'ordinary',
  title: 'Ordinary conflict',
  canonical_event_id: null,
  allowed_resolutions: ['google', 'prosepect', 'latest'],
} as SyncConflict
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.getGoogleIntegration).mockResolvedValue({ connected: true } as Awaited<
    ReturnType<typeof api.getGoogleIntegration>
  >)
  vi.mocked(api.listSyncConflicts).mockResolvedValue([special, ordinary])
  vi.mocked(api.listActivity).mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

it('uses server capabilities, never null canonical identity, for special vs ordinary choices', async () => {
  const wrapper = mount(GoogleSyncPanel, {
    global: { plugins: [createPinia()], stubs: { RouterLink: true } },
  })
  await flushPromises()
  const specialRow = wrapper
    .findAll('div')
    .find((row) => row.element.textContent?.startsWith('Deleted task'))!
  expect(specialRow.text()).toContain('The task stays deleted')
  expect(specialRow.findAll('button').map((button) => button.text())).toEqual(['Keep Google'])
  const ordinaryRow = wrapper
    .findAll('div')
    .find((row) => row.element.textContent?.startsWith('Ordinary conflict'))!
  expect(ordinaryRow.findAll('button').map((button) => button.text())).toEqual([
    'Use Google',
    'Use Prosepect',
    'Use latest',
  ])
  wrapper.unmount()
})

it('surfaces authoritative actionable 409 and never announces failed settlement as saved', async () => {
  vi.mocked(api.resolveSyncConflict).mockRejectedValue(
    new api.ApiError('Conflict changed; refresh the current decision', 409, 'conflict'),
  )
  const wrapper = mount(GoogleSyncPanel, { global: { stubs: { RouterLink: true } } })
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'Keep Google')!
    .trigger('click')
  await flushPromises()
  expect(api.resolveSyncConflict).toHaveBeenCalledExactlyOnceWith('special', 'google')
  expect(wrapper.get('[role="alert"]').text()).toContain(
    'Conflict changed; refresh the current decision',
  )
  expect(wrapper.text()).not.toContain('Keep Google saved')
  wrapper.unmount()
})
