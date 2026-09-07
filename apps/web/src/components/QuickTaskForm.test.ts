import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QuickTaskForm from './QuickTaskForm.vue'
import { useWorkspaceStore } from '../stores/workspace'

function setup() {
  const pinia = createPinia()
  const store = useWorkspaceStore(pinia)
  const addTask = vi.spyOn(store, 'addTask').mockResolvedValue(undefined as never)
  const wrapper = mount(QuickTaskForm, { global: { plugins: [pinia] } })
  return { wrapper, store, addTask }
}

afterEach(() => vi.useRealTimers())

describe('QuickTaskForm creation', () => {
  it('creates with only a title and no optional values', async () => {
    const { wrapper, addTask } = setup()
    expect(wrapper.text()).toContain('Enter a task title')
    await wrapper.get('input[type=text]').setValue('Write report')
    await wrapper.get('form').trigger('submit')
    expect(addTask).toHaveBeenCalledWith({
      project_id: null,
      parent_task_id: null,
      title: 'Write report',
      description: '',
      due_at: null,
      scheduled_start: null,
      scheduled_end: null,
      status: 'todo',
      priority: 'medium',
      recurrence: 'none',
      labels: [],
      remind_at: null,
    })
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it('keeps repeat validation and state visible when optional details are collapsed', async () => {
    const { wrapper, addTask } = setup()
    await wrapper.get('input[type=text]').setValue('Water plants')
    await wrapper.get('button[aria-expanded]').trigger('click')
    await wrapper.get('select.field-input').setValue('weekly')
    await wrapper.get('button[aria-expanded]').trigger('click')
    expect(wrapper.get('p[id]').text()).toContain('Choose a deadline for repeating tasks.')
    expect(wrapper.get('p[id]').text()).toContain('Repeats weekly')
    await wrapper.get('form').trigger('submit')
    expect(addTask).not.toHaveBeenCalled()
    await wrapper.get('input[type=date]').setValue('2026-09-02')
    await wrapper.get('textarea').setValue('Balcony')
    await wrapper.get('input[type=datetime-local]').setValue('2026-09-02T08:00')
    await wrapper.get('input[list]').setValue('home, plants')
    await wrapper.get('form').trigger('submit')
    expect(addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Balcony',
        recurrence: 'weekly',
        labels: ['home', 'plants'],
        due_at: new Date('2026-09-02T23:59:00').toISOString(),
        remind_at: new Date('2026-09-02T08:00').toISOString(),
        scheduled_start: null,
        scheduled_end: null,
      }),
    )
  })

  it.each(['due', 'by'])(
    'saves an explicit %s timed deadline without scheduling',
    async (prefix) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 7, 29, 9))
      const { wrapper, addTask } = setup()
      await wrapper.get('input[type=text]').setValue(`Write report ${prefix} tomorrow at 3pm`)
      expect(wrapper.text()).toContain('Deadline detected: 2026-08-30 at 15:00')
      expect(wrapper.text()).not.toContain('Work time detected')
      expect((wrapper.get('input[type=time]').element as HTMLInputElement).value).toBe('15:00')
      await wrapper.get('form').trigger('submit')
      expect(addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Write report',
          due_at: new Date('2026-08-30T15:00:00').toISOString(),
          scheduled_start: null,
          scheduled_end: null,
        }),
      )
    },
  )

  it('previews time-only work blocks and lets users keep the phrase as text', async () => {
    const { wrapper, addTask } = setup()
    await wrapper.get('input[type=text]').setValue('Write report at 3pm')
    expect(wrapper.text()).toContain('Work time detected:')
    expect(wrapper.text()).toContain('(1-hour block)')
    await wrapper.get('button[aria-label^="Keep"]').trigger('click')
    expect(wrapper.text()).not.toContain('Work time detected')
    await wrapper.get('form').trigger('submit')
    expect(addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Write report at 3pm',
        due_at: null,
        scheduled_start: null,
        scheduled_end: null,
      }),
    )
  })

  it('allows manual deadline overrides and clearing without restoring detected values', async () => {
    const { wrapper, addTask } = setup()
    await wrapper.get('input[type=text]').setValue('Write report due tomorrow at 3pm')
    await wrapper.get('input[type=time]').setValue('16:30')
    expect((wrapper.get('input[type=time]').element as HTMLInputElement).value).toBe('16:30')
    await wrapper.get('input[type=date]').setValue('2026-10-02')
    await wrapper.get('form').trigger('submit')
    expect(addTask).toHaveBeenLastCalledWith(
      expect.objectContaining({ due_at: new Date('2026-10-02T16:30:00').toISOString() }),
    )
    await wrapper.get('input[type=text]').setValue('Write report due tomorrow at 3pm')
    await wrapper.get('input[type=date]').setValue('')
    await wrapper.get('form').trigger('submit')
    expect(addTask).toHaveBeenLastCalledWith(
      expect.objectContaining({ due_at: null, scheduled_start: null }),
    )
  })

  it('preserves the draft on a failed create', async () => {
    const { wrapper, addTask } = setup()
    addTask.mockRejectedValueOnce(new Error('offline'))
    await wrapper.get('input[type=text]').setValue('Write report')
    await wrapper.get('form').trigger('submit')
    expect((wrapper.get('input[type=text]').element as HTMLInputElement).value).toBe('Write report')
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.get('[role=alert]').text()).toBe(
      'Could not create task. Your draft is kept. Try again.',
    )
    await wrapper.get('form').trigger('submit')
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(wrapper.emitted('created')).toHaveLength(1)
  })
})
