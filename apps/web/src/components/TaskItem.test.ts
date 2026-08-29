import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import TaskItem from './TaskItem.vue'
import type { Task } from '../api/types'

const task: Task = {
  id: '019cf000-0000-7000-8000-000000000001',
  project_id: '019cf000-0000-7000-8000-000000000002',
  parent_task_id: null,
  title: 'Write PRD',
  description: '',
  due_at: null,
  scheduled_start: null,
  scheduled_end: null,
  status: 'todo',
  priority: 'high',
  recurrence: 'none',
  labels: [],
  remind_at: null,
  position: 1024,
  completed_at: null,
  created_at: '2026-03-02T10:00:00Z',
  updated_at: '2026-03-02T10:00:00Z',
  version: 1,
}

describe('TaskItem', () => {
  it('requests completion without mutating the task', async () => {
    const wrapper = mount(TaskItem, { props: { task } })

    await wrapper.get('button[aria-label="Complete Write PRD"]').trigger('click')

    expect(wrapper.emitted('status')).toEqual([[task, 'completed']])
    expect(task.status).toBe('todo')
  })

  it('renders priority and title', () => {
    const wrapper = mount(TaskItem, { props: { task } })

    expect(wrapper.text()).toContain('Write PRD')
    expect(wrapper.text()).toContain('high')
  })

  it('offers keyboard-accessible manual ordering controls', async () => {
    const wrapper = mount(TaskItem, { props: { task, canMoveUp: true } })

    await wrapper.get('button[aria-label="Edit Write PRD"]').trigger('click')
    await wrapper.get('button[aria-label="Move Write PRD up"]').trigger('click')

    expect(wrapper.emitted('move')).toEqual([[task, 'up']])
  })

  it('automatically applies a deadline suggestion when saving', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 29, 12))
    try {
      const wrapper = mount(TaskItem, { props: { task } })

      await wrapper.get('button[aria-label="Edit Write PRD"]').trigger('click')
      const editor = wrapper.get('form[aria-label="Edit Write PRD"]')
      await editor.get('input[autofocus]').setValue('Write tests tomorrow')
      expect(editor.text()).toContain('Deadline detected: Tomorrow')
      expect((editor.get('input[type="date"]').element as HTMLInputElement).value).toBe(
        '2026-08-30',
      )
      await editor.get('select[aria-label="Edit priority"]').setValue('urgent')
      await editor.get('select[aria-label="Edit status"]').setValue('in_progress')
      await editor.trigger('submit')

      const fields = wrapper.emitted('edit')?.[0]?.[1]
      expect(fields).toMatchObject({
        project_id: task.project_id,
        title: 'Write tests',
        priority: 'urgent',
        status: 'in_progress',
      })
      expect(new Date((fields as { due_at: string }).due_at).toDateString()).toBe(
        new Date(2026, 7, 30).toDateString(),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
