import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../stores/workspace'
import CalendarMoveFeedback from './CalendarMoveFeedback.vue'

afterEach(() => vi.useRealTimers())

describe('CalendarMoveFeedback', () => {
  it('disables the accessible Undo action at expiry without silently hiding the result', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T09:00:00Z'))
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.calendarMoveUndo = {
      id: 'receipt', event_id: 'event', task_id: null, expires_at: '2026-09-13T09:01:00Z',
    }
    store.calendarMoveMessage = 'Calendar move saved.'
    const wrapper = mount(CalendarMoveFeedback, { global: { plugins: [pinia] } })
    const undo = wrapper.findAll('button').find((button) => button.text() === 'Undo')!
    expect(undo.attributes('disabled')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(undo.attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="status"]').text()).toContain('Undo expired')
    await wrapper.get('[aria-label="Dismiss calendar move feedback"]').trigger('click')
    expect(wrapper.find('section').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps pending actions disabled and announces errors without stealing focus', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.calendarMoveUndo = {
      id: 'receipt', event_id: 'event', task_id: 'task', expires_at: new Date(Date.now()+60_000).toISOString(),
    }
    store.calendarMovePending = true
    store.calendarMoveUndoing = true
    const wrapper = mount(CalendarMoveFeedback, { global: { plugins: [pinia] } })
    expect(wrapper.text()).toContain('Undoing…')
    expect(wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    store.calendarMovePending = false
    store.calendarMoveUndoing = false
    store.calendarMoveError = 'Calendar item changed. Undo cannot overwrite a later change.'
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[role="alert"]').text()).toContain('cannot overwrite')
    wrapper.unmount()
  })
})
