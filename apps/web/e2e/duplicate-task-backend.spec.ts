import { expect, test } from '@playwright/test'
import type { Task } from '../src/api/types'

// Isolated CI backend with real session cookies/CSRF and no intercepted API.
test('real backend: duplication creates a fresh task and leaves the completed source unchanged', async ({
  page,
}) => {
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  const session = await (await page.request.get('/api/v1/session')).json()
  const headers = { 'x-csrf-token': session.csrf_token as string }
  const suffix = `${test.info().project.name}-${Date.now()}`
  const originalTitle = `Source ${suffix} tomorrow at 3pm #work p1`
  const copiedTitle = `Copy ${suffix} tomorrow at 3pm #work p1`
  const response = await page.request.post('/api/v1/tasks', {
    headers,
    data: {
      title: originalTitle,
      description: 'Saved source details',
      status: 'completed',
      priority: 'low',
      labels: ['reference'],
      due_at: '2030-01-01T12:00:00Z',
      scheduled_start: '2030-01-01T09:00:00Z',
      scheduled_end: '2030-01-01T10:00:00Z',
      remind_at: '2030-01-01T08:00:00Z',
    },
  })
  expect(response.status()).toBe(201)
  const original: Task = await response.json()
  let copyId: string | undefined
  try {
    await page.reload()
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('all')
    await page.getByRole('button', { name: `Edit ${originalTitle}`, exact: true }).click()
    await page.getByRole('button', { name: 'Duplicate saved task', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Duplicate task', exact: true })
    await expect(dialog.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
      originalTitle,
    )
    await dialog.getByRole('textbox', { name: 'Task title', exact: true }).fill(copiedTitle)
    const creation = page.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === '/api/v1/tasks' && result.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: 'Create task', exact: true }).click()
    const created = await creation
    expect(created.status()).toBe(201)
    const copy: Task = await created.json()
    copyId = copy.id
    expect(copy.id).not.toBe(original.id)
    expect(copy).toMatchObject({
      title: copiedTitle,
      description: original.description,
      priority: 'low',
      labels: ['reference'],
      status: 'todo',
      completed_at: null,
      project_id: null,
      parent_task_id: null,
      due_at: null,
      scheduled_start: null,
      scheduled_end: null,
      recurrence: 'none',
      remind_at: null,
    })
    await expect(dialog).toHaveCount(0)
    await page.reload()
    const persisted: { items: Task[] } = await (
      await page.request.get('/api/v1/tasks?limit=100')
    ).json()
    expect(persisted.items.find((task) => task.id === original.id)).toEqual(original)
    expect(persisted.items.find((task) => task.id === copyId)).toEqual(copy)
  } finally {
    const persisted: { items: Task[] } = await (
      await page.request.get('/api/v1/tasks?limit=100')
    ).json()
    for (const task of persisted.items.filter(
      (task) => task.id === original.id || task.id === copyId,
    )) {
      const deleted = await page.request.delete(`/api/v1/tasks/${task.id}`, {
        headers,
        params: { expected_version: task.version },
      })
      expect(deleted.status(), await deleted.text()).toBe(204)
    }
  }
})
