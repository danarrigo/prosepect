import { expect, test, type Page } from '@playwright/test'
import type { Task } from '../src/api/types'

async function fixture(page: Page, failFirst = false, archived = false) {
  const source: Task = {
    id: 'source',
    project_id: 'work',
    parent_task_id: null,
    title: 'Plan tomorrow at 3pm #work p1',
    description: 'Source details',
    due_at: '2030-01-01T12:00:00Z',
    scheduled_start: '2030-01-01T09:00:00Z',
    scheduled_end: '2030-01-01T10:00:00Z',
    status: 'todo',
    priority: 'low',
    recurrence: 'daily',
    labels: ['reference'],
    remind_at: '2030-01-01T08:00:00Z',
    position: 0,
    completed_at: null,
    version: 1,
    created_at: '',
    updated_at: '',
  }
  const tasks = [source]
  let attempts = 0
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
    else if (path === '/projects')
      body = {
        items: [
          {
            id: 'work',
            name: 'Work',
            status: archived ? 'archived' : 'active',
            version: 1,
            total_tasks: tasks.length,
            completed_tasks: 0,
          },
        ],
      }
    else if (path === '/saved-task-views') body = []
    else if (path === '/tasks' && route.request().method() === 'POST') {
      attempts++
      if (failFirst && attempts === 1)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'unavailable', message: 'Try again shortly.' } },
        })
      const copy = { ...source, ...route.request().postDataJSON(), id: `copy-${tasks.length}` }
      tasks.push(copy)
      return route.fulfill({ status: 201, json: copy })
    } else if (path === '/tasks') body = { items: tasks }
    await route.fulfill({ json: body })
  })
  return { source, tasks }
}

test('duplicate previews safe fields, keeps titles literal, and restores the original draft and focus', async ({
  page,
}) => {
  const { source, tasks } = await fixture(page, true)
  const original = structuredClone(source)
  await page.goto('/projects')
  await page.getByRole('button', { name: `Edit ${source.title}`, exact: true }).click()
  const editor = page.getByRole('form', { name: `Edit ${source.title}`, exact: true })
  await editor
    .getByRole('textbox', { name: 'Task title', exact: true })
    .fill('Unsaved original draft')
  const duplicate = editor.getByRole('button', { name: 'Duplicate saved task', exact: true })
  await duplicate.click()
  const dialog = page.getByRole('dialog', { name: 'Duplicate task', exact: true })
  const title = dialog.getByRole('textbox', { name: 'Task title', exact: true })
  await expect(title).toBeFocused()
  await expect(title).toHaveValue(source.title)
  await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    source.description,
  )
  await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toHaveValue('work')
  await expect(dialog.getByLabel('Deadline', { exact: true })).toHaveValue('')
  await expect(dialog.getByRole('combobox', { name: 'Repeat', exact: true })).toHaveValue('none')
  await title.fill('Copy tomorrow at 3pm #work p1')
  await page.setViewportSize({ width: 320, height: 900 })
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({
    path: test.info().outputPath('duplicate-320.png'),
    animations: 'disabled',
  })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({
    path: test.info().outputPath('duplicate-320-dark.png'),
    animations: 'disabled',
  })
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click()
  await expect(
    dialog.getByText('Could not create task. Your draft is kept. Try again.', { exact: true }),
  ).toBeVisible()
  await expect(title).toHaveValue('Copy tomorrow at 3pm #work p1')
  await title.focus()
  await page.keyboard.press('Control+Enter')
  await expect(dialog).toHaveCount(0)
  await expect(duplicate).toBeFocused()
  await expect(editor.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'Unsaved original draft',
  )
  expect(tasks).toHaveLength(2)
  expect(tasks[1]).toMatchObject({
    title: 'Copy tomorrow at 3pm #work p1',
    description: source.description,
    project_id: 'work',
    priority: 'low',
    labels: ['reference'],
    parent_task_id: null,
    status: 'todo',
    due_at: null,
    scheduled_start: null,
    scheduled_end: null,
    recurrence: 'none',
    remind_at: null,
  })
  expect(source).toEqual(original)
})

test('canceling duplication creates nothing and reopening starts with the saved source', async ({
  page,
}) => {
  const { source, tasks } = await fixture(page)
  await page.goto('/projects')
  await page.getByRole('button', { name: `Edit ${source.title}`, exact: true }).click()
  const duplicate = page.getByRole('button', { name: 'Duplicate saved task', exact: true })
  await duplicate.click()
  const dialog = page.getByRole('dialog', { name: 'Duplicate task', exact: true })
  await dialog.getByRole('textbox', { name: 'Task title', exact: true }).fill('Abandoned copy')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(duplicate).toBeFocused()
  expect(tasks).toHaveLength(1)
  await duplicate.click()
  await expect(dialog.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    source.title,
  )
})

test('an archived source project is not silently assigned to the new task', async ({ page }) => {
  const { source, tasks } = await fixture(page, false, true)
  await page.goto('/projects')
  await page.getByRole('button', { name: `Edit ${source.title}`, exact: true }).click()
  await page.getByRole('button', { name: 'Duplicate saved task', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Duplicate task', exact: true })
  await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toHaveValue('')
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(tasks[1]?.project_id).toBeNull()
  expect(source.project_id).toBe('work')
})
