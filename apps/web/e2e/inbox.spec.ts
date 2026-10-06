import { expect, test, type Page } from '@playwright/test'
import type { Task } from '../src/api/types'

async function fixture(page: Page) {
  const project = {
    id: 'project',
    name: 'Work',
    description: '',
    status: 'active',
    color: '#64748b',
    version: 1,
    created_at: '',
    updated_at: '',
  }
  const tasks: Task[] = [
    ['unassigned', 'Capture me', null, 'todo'],
    ['assigned', 'Project task', 'project', 'todo'],
    ['done', 'Finished task', null, 'completed'],
    ['dated', 'Unassigned deadline', null, 'todo'],
  ].map(([id, title, project_id, status]) => ({
    id: id!,
    title: title!,
    project_id,
    status: status as Task['status'],
    description: '',
    parent_task_id: null,
    due_at: id === 'dated' ? '2030-01-01T10:00:00Z' : null,
    scheduled_start: null,
    scheduled_end: null,
    priority: 'medium',
    recurrence: 'none',
    labels: [],
    remind_at: null,
    completed_at: status === 'completed' ? '2026-10-01T00:00:00Z' : null,
    position: 0,
    version: 1,
    created_at: '',
    updated_at: '',
  }))
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    const method = route.request().method()
    let body: unknown = path === '/saved-task-views' ? [] : { items: [] }
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
    else if (path === '/projects') body = { items: [project] }
    else if (path === '/tasks' && method === 'POST') {
      const input = route.request().postDataJSON()
      const created = { ...tasks[0]!, ...input, id: `created-${tasks.length}`, version: 1 }
      tasks.push(created)
      body = created
    } else if (path === '/tasks') body = { items: tasks }
    else if (path.startsWith('/tasks/') && method === 'PUT') {
      const input = route.request().postDataJSON()
      const item = tasks.find((task) => task.id === path.split('/')[2])!
      expect(input.expected_version).toBe(item.version)
      Object.assign(item, input, { version: item.version + 1 })
      body = item
    }
    await route.fulfill({ json: body })
  })
  return tasks
}

test('Inbox captures independently of project context and organizes existing tasks', async ({
  page,
}) => {
  const tasks = await fixture(page)
  await page.goto('/projects?project=project')
  await expect(page.getByRole('heading', { name: 'Work', exact: true })).toBeVisible()
  await page.keyboard.press('g')
  await page.keyboard.press('i')
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  const inbox = page.getByRole('region', { name: 'Inbox tasks' })
  await expect(inbox.getByText('Capture me', { exact: true })).toBeVisible()
  await expect(inbox.getByText('Unassigned deadline', { exact: true })).toBeVisible()
  await expect(inbox.getByText('Project task', { exact: true })).toHaveCount(0)
  await expect(inbox.getByText('Finished task', { exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Task title', exact: true }).fill('Inbox quick capture')
  await page.getByRole('button', { name: 'Create task', exact: true }).click()
  await expect(inbox.getByText('Inbox quick capture', { exact: true })).toBeVisible()
  expect(tasks.find((task) => task.title === 'Inbox quick capture')?.project_id).toBeNull()
  await page.getByRole('heading', { name: 'Inbox', exact: true }).click()
  await page.keyboard.press('n')
  const dialog = page.getByRole('dialog', { name: 'New task' })
  await dialog.getByRole('textbox', { name: 'Task title', exact: true }).fill('Keyboard capture')
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click()
  await expect(inbox.getByText('Keyboard capture', { exact: true })).toBeVisible()
  expect(tasks.find((task) => task.title === 'Keyboard capture')?.project_id).toBeNull()
  await inbox.getByRole('button', { name: 'Edit Capture me', exact: true }).click()
  await inbox.getByRole('combobox', { name: 'Edit project' }).selectOption('project')
  await inbox.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(inbox.getByText('Capture me', { exact: true })).toHaveCount(0)
  expect(tasks.find((task) => task.id === 'unassigned')?.project_id).toBe('project')
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toBeFocused()
  await inbox.getByRole('button', { name: 'Complete Keyboard capture', exact: true }).click()
  await expect(inbox.getByText('Keyboard capture', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toBeFocused()
  await page.setViewportSize({ width: 320, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('inbox-320.png'), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: test.info().outputPath('inbox-320-dark.png'), fullPage: true })
  await page.reload()
  await expect(inbox.getByText('Inbox quick capture', { exact: true })).toBeVisible()
  await expect(inbox.getByText('Capture me', { exact: true })).toHaveCount(0)
  await inbox.getByRole('button', { name: 'Complete Inbox quick capture', exact: true }).click()
  await inbox.getByRole('button', { name: 'Complete Unassigned deadline', exact: true }).click()
  await expect(inbox.getByText('Your inbox is clear.', { exact: true })).toBeVisible()
})

test('Inbox preserves a failed assignment draft and the task', async ({ page }) => {
  const tasks = await fixture(page)
  await page.route('**/api/v1/tasks/unassigned', (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: 'conflict', message: 'Task changed. Refresh before saving.' } },
    }),
  )
  await page.goto('/inbox')
  const inbox = page.getByRole('region', { name: 'Inbox tasks' })
  await inbox.getByRole('button', { name: 'Edit Capture me', exact: true }).click()
  await inbox.getByRole('combobox', { name: 'Edit project' }).selectOption('project')
  await inbox.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByText('Task changed. Refresh before saving.', { exact: true }),
  ).toBeVisible()
  await expect(inbox.getByRole('combobox', { name: 'Edit project' })).toHaveValue('project')
  expect(tasks.find((task) => task.id === 'unassigned')?.project_id).toBeNull()
})
