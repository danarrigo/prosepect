import { expect, test, type Page } from '@playwright/test'
import type { Task } from '../src/api/types'

async function fixture(page: Page, rejectFirst = false, count = 3) {
  const tasks: Task[] = Array.from({ length: count }, (_, index) => ({
    id: `task-${index}`,
    title: `Task ${index + 1}`,
    description: 'Keep details',
    project_id: null,
    parent_task_id: null,
    due_at: '2030-01-01T12:34:56Z',
    scheduled_start: null,
    scheduled_end: null,
    remind_at: null,
    status: 'todo',
    priority: 'low',
    recurrence: index === 0 ? 'daily' : 'none',
    labels: ['original'],
    position: index * 1024,
    version: 3,
    completed_at: null,
    created_at: '',
    updated_at: '',
  }))
  const writes: Array<{ id: string; fields: Record<string, unknown> }> = []
  const deletions: string[] = []
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    const method = route.request().method()
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
    else if (path.startsWith('/daily-plans/')) body = { date: '2030-01-01', focus_tasks: [] }
    else if (path === '/files/usage')
      body = { used_bytes: 0, max_user_storage_bytes: 104857600, max_file_size_bytes: 10485760 }
    else if (path === '/projects')
      body = {
        items: [
          {
            id: 'work',
            name: 'Work',
            status: 'active',
            version: 1,
            total_tasks: tasks.length,
            completed_tasks: 0,
          },
        ],
      }
    else if (path === '/saved-task-views') body = []
    else if (path.startsWith('/tasks/') && method === 'PUT') {
      const id = path.split('/')[2]!
      const fields = route.request().postDataJSON()
      writes.push({ id, fields })
      if (rejectFirst && id === 'task-0')
        return route.fulfill({
          status: 409,
          json: { error: { code: 'conflict', message: 'Task changed. Reload before editing.' } },
        })
      const index = tasks.findIndex((task) => task.id === id)
      const current = tasks[index]!
      if (fields.expected_version !== current.version)
        return route.fulfill({
          status: 409,
          json: { error: { code: 'conflict', message: 'Version conflict' } },
        })
      tasks[index] = { ...current, ...fields, version: current.version + 1 }
      body = tasks[index]
    } else if (path.endsWith('/delete-with-undo') && method === 'POST') {
      const id = path.split('/')[2]!
      deletions.push(id)
      tasks.splice(
        tasks.findIndex((task) => task.id === id),
        1,
      )
      body = {
        id: `undo-${id}`,
        task_id: id,
        task_title: id,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      }
    } else if (path === '/tasks') body = { items: tasks }
    else if (
      [
        '/notes',
        '/files',
        '/events',
        '/calendars',
        '/task-delete-undos',
        '/calendar-move-undos',
      ].includes(path)
    )
      body = { items: [] }
    await route.fulfill({ json: body })
  })
  return { tasks, writes, deletions }
}

async function select(page: Page, titles: string[]) {
  await page.getByRole('button', { name: 'Select tasks', exact: true }).click()
  for (const title of titles)
    await page.getByRole('checkbox', { name: `Select ${title}`, exact: true }).check()
}

test('bulk priority preserves exact saved fields, isolates partial results and restores focus', async ({
  page,
}) => {
  const { writes, tasks } = await fixture(page, true)
  await page.goto('/inbox')
  await select(page, ['Task 1', 'Task 2'])
  const panel = page.getByRole('region', { name: 'Bulk task actions' })
  await panel.getByRole('combobox', { name: 'Action', exact: true }).selectOption('priority')
  await panel.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high')
  await panel.getByRole('button', { name: 'Apply to selected' }).click()
  await expect(panel.getByText('1 saved. 1 not confirmed.')).toBeVisible()
  expect(writes).toHaveLength(2)
  expect(writes[0]!.fields).toMatchObject({
    expected_version: 3,
    due_at: '2030-01-01T12:34:56Z',
    priority: 'high',
    labels: ['original'],
  })
  expect(writes[0]!.fields).not.toHaveProperty('recurrence')
  expect(tasks[0]!.priority).toBe('low')
  expect(tasks[1]!.priority).toBe('high')
  expect(tasks[2]!.priority).toBe('low')
  await expect(page.getByRole('checkbox', { name: 'Select Task 1', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Select Task 2', exact: true })).not.toBeChecked()
  await panel.getByRole('button', { name: 'Done selecting' }).click()
  await expect(page.getByRole('button', { name: 'Select tasks', exact: true })).toBeFocused()
})

test('bulk label, move and complete only explicit visible selections at 320px', async ({
  page,
}) => {
  const { tasks } = await fixture(page)
  await page.goto('/inbox')
  await select(page, ['Task 1', 'Task 2'])
  const panel = page.getByRole('region', { name: 'Bulk task actions' })
  await panel.getByRole('combobox', { name: 'Action', exact: true }).selectOption('label')
  await panel.getByRole('textbox', { name: 'Label', exact: true }).fill('next')
  await page.setViewportSize({ width: 320, height: 900 })
  await expect(panel).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({
    path: test.info().outputPath('bulk-320-light.png'),
    animations: 'disabled',
  })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({
    path: test.info().outputPath('bulk-320-dark.png'),
    animations: 'disabled',
  })
  await panel.getByRole('button', { name: 'Apply to selected' }).click()
  await expect(panel.getByText('2 saved. 0 not confirmed.')).toBeVisible()
  expect(tasks[0]!.labels).toEqual(['original', 'next'])
  expect(tasks[2]!.labels).toEqual(['original'])
  await page.getByRole('checkbox', { name: 'Select Task 1', exact: true }).check()
  await panel.getByRole('combobox', { name: 'Action', exact: true }).selectOption('project')
  await panel
    .getByRole('combobox', { name: 'Destination project', exact: true })
    .selectOption('work')
  await panel.getByRole('button', { name: 'Apply to selected' }).click()
  await expect(page.getByRole('checkbox', { name: 'Select Task 1', exact: true })).toHaveCount(0)
  expect(tasks[0]!.project_id).toBe('work')
  await page.getByRole('checkbox', { name: 'Select Task 2', exact: true }).check()
  await panel.getByRole('combobox', { name: 'Action', exact: true }).selectOption('complete')
  await panel.getByRole('button', { name: 'Apply to selected' }).click()
  await expect(page.getByRole('checkbox', { name: 'Select Task 2', exact: true })).toHaveCount(0)
  expect(tasks[1]!.status).toBe('completed')
  expect(tasks[2]!.status).toBe('todo')
})

test('selection is capped, keyboard-operable and drops tasks hidden by filters', async ({
  page,
}) => {
  await fixture(page, false, 51)
  await page.goto('/projects')
  await select(page, ['Task 1'])
  await page.getByRole('button', { name: 'Select visible (up to 50)', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Select Task 51', exact: true })).toBeDisabled()
  const panel = page.getByRole('region', { name: 'Bulk task actions' })
  await expect(panel.getByText('50 selected', { exact: false })).toBeVisible()
  await page.getByPlaceholder('Search tasks').fill('Task 51')
  await expect(panel.getByText('0 selected', { exact: false })).toBeVisible()
  const checkbox = page.getByRole('checkbox', { name: 'Select Task 51', exact: true })
  await checkbox.focus()
  await page.keyboard.press('Space')
  await expect(checkbox).toBeChecked()
  await expect(panel.getByText('1 selected', { exact: false })).toBeVisible()
})

test('bulk delete confirms before any request and retains separate Undo receipts', async ({
  page,
}) => {
  const { deletions } = await fixture(page)
  await page.goto('/inbox')
  await select(page, ['Task 2', 'Task 3'])
  const panel = page.getByRole('region', { name: 'Bulk task actions' })
  await panel.getByRole('combobox', { name: 'Action', exact: true }).selectOption('delete')
  page.once('dialog', (dialog) => dialog.dismiss())
  await panel.getByRole('button', { name: 'Apply to selected' }).click()
  expect(deletions).toEqual([])
  page.once('dialog', (dialog) => dialog.accept())
  await panel.getByRole('button', { name: 'Apply to selected' }).click()
  await expect(panel.getByText('2 saved. 0 not confirmed.')).toBeVisible()
  expect(deletions).toEqual(['task-1', 'task-2'])
  await expect(page.getByRole('button', { name: /Undo deletion/ })).toHaveCount(2)
})
