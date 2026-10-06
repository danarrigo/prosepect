import { expect, test, type Page } from '@playwright/test'
import type { Task, UpdateTaskRequest } from '../src/api/types'

async function fixture(page: Page, remoteChange = false) {
  const task: Task = {
    id: 'routine',
    project_id: null,
    parent_task_id: null,
    title: 'Routine',
    description: '',
    status: 'todo',
    priority: 'medium',
    recurrence: 'daily',
    due_at: '2030-01-01T12:00:00Z',
    scheduled_start: null,
    scheduled_end: null,
    remind_at: null,
    labels: [],
    position: 0,
    completed_at: null,
    created_at: '',
    updated_at: '',
    version: 1,
  }
  const other = { ...task, id: 'other', title: 'Other recurring task' }
  const updates: UpdateTaskRequest[] = []
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    let body: unknown = { items: [] }
    if (path === '/session')
      body = {
        csrf_token: 'mock',
        user: { id: 'owner', email: 'owner@example.test', display_name: 'Owner', timezone: 'UTC' },
      }
    else if (path === '/settings')
      body = {
        theme: 'system',
        sidebar_visible: true,
        automatic_daily_review: false,
        sync_conflict_policy: 'ask',
        version: 1,
      }
    else if (path.startsWith('/daily-plans/')) body = { focus_task_ids: [], focus_tasks: [] }
    else if (path === '/files/usage')
      body = { used_bytes: 0, max_user_storage_bytes: 104857600, max_file_size_bytes: 10485760 }
    else if (path === '/saved-task-views') body = []
    else if (path === '/tasks') body = { items: remoteChange ? [task, other] : [task] }
    else if (path === '/tasks/other' && route.request().method() === 'PUT') {
      Object.assign(other, route.request().postDataJSON(), { version: 2 })
      Object.assign(task, { title: 'Remote title', recurrence: 'weekly', version: 2 })
      body = other
    } else if (path === '/tasks/routine' && route.request().method() === 'PUT') {
      const input: UpdateTaskRequest = route.request().postDataJSON()
      updates.push(input)
      if (input.expected_version !== task.version || input.recurrence_scope === 'this_and_future')
        return route.fulfill({
          status: 409,
          json: { error: { code: 'conflict', message: 'Task changed. Refresh before saving.' } },
        })
      Object.assign(task, input, { version: task.version + 1 })
      body = task
    }
    await route.fulfill({ json: body })
  })
  return { updates }
}

test('recurring editor sends explicit scope and preserves a rejected forward draft', async ({
  page,
}) => {
  const { updates } = await fixture(page)
  await page.goto('/inbox')
  await page.getByRole('button', { name: 'Edit Routine', exact: true }).click()
  const editor = page.getByRole('form', { name: 'Edit Routine', exact: true })
  await expect(editor.getByRole('combobox', { name: 'Apply changes to', exact: true })).toHaveValue(
    'this_occurrence',
  )
  await expect(editor.getByRole('combobox', { name: 'Repeat', exact: true })).toBeDisabled()
  await editor.getByRole('textbox', { name: 'Task title', exact: true }).fill('Only today')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit Only today', exact: true })).toBeVisible()
  expect(updates[0]?.recurrence_scope).toBe('this_occurrence')
  await page.getByRole('button', { name: 'Edit Only today', exact: true }).click()
  const draft = page.getByRole('form', { name: 'Edit Only today', exact: true })
  await draft
    .getByRole('combobox', { name: 'Apply changes to', exact: true })
    .selectOption('this_and_future')
  await draft.getByRole('combobox', { name: 'Repeat', exact: true }).selectOption('weekly')
  await draft.getByRole('textbox', { name: 'Task title', exact: true }).fill('New routine')
  await draft.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Task changed.' })).toBeVisible()
  await expect(draft.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'New routine',
  )
  await expect(draft.getByRole('combobox', { name: 'Apply changes to', exact: true })).toHaveValue(
    'this_and_future',
  )
  await expect(draft.getByRole('combobox', { name: 'Repeat', exact: true })).toHaveValue('weekly')
  expect(updates[1]?.recurrence_scope).toBe('this_and_future')
  await page.setViewportSize({ width: 320, height: 900 })
  await page.evaluate(() => window.scrollTo(0, 0))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    path: test.info().outputPath('recurring-320.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({
    path: test.info().outputPath('recurring-320-dark.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await draft
    .getByRole('combobox', { name: 'Apply changes to', exact: true })
    .selectOption('this_occurrence')
  await expect(draft.getByRole('combobox', { name: 'Repeat', exact: true })).toHaveValue('daily')
  await expect(draft.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'New routine',
  )
})

test('an open recurring draft keeps its version when another action refreshes tasks', async ({
  page,
}) => {
  const { updates } = await fixture(page, true)
  await page.goto('/inbox')
  await page.getByRole('button', { name: 'Edit Routine', exact: true }).click()
  await page
    .getByRole('form', { name: 'Edit Routine', exact: true })
    .getByRole('textbox', { name: 'Task title', exact: true })
    .fill('My draft')
  await page.getByRole('button', { name: 'Complete Other recurring task', exact: true }).click()
  const editor = page.getByRole('form', { name: 'Edit Remote title', exact: true })
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => updates[0]?.expected_version).toBe(1)
  await expect(page.getByRole('alert').filter({ hasText: 'Task changed.' })).toBeVisible()
  await expect(editor.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'My draft',
  )
})
