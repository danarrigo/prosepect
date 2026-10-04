import { expect, test } from '@playwright/test'
import type { Task } from '../src/api/types'

// Real isolated CI API and database. No intercepted responses or provider access.
test('real backend: Inbox capture, assignment and completion persist after reload', async ({
  page,
}) => {
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  const sessionResponse = await page.request.get('/api/v1/session')
  expect(sessionResponse.status()).toBe(200)
  const session = await sessionResponse.json()
  const headers = { 'x-csrf-token': session.csrf_token as string }
  const suffix = `${test.info().project.name}-${Date.now()}`
  const projectResponse = await page.request.post('/api/v1/projects', {
    headers,
    data: { name: `Inbox project ${suffix}` },
  })
  expect(projectResponse.status()).toBe(201)
  const project = await projectResponse.json()
  const createdIds: string[] = []
  try {
    await page.reload()
    const inbox = page.getByRole('region', { name: 'Inbox tasks' })
    for (const title of [`Assign ${suffix}`, `Finish ${suffix}`]) {
      await page.getByRole('textbox', { name: 'Task title', exact: true }).fill(title)
      const response = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/tasks' &&
          response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'Create task', exact: true }).click()
      const result = await response
      expect(result.status()).toBe(201)
      const task = await result.json()
      createdIds.push(task.id)
      expect(task.project_id).toBeNull()
      await expect(inbox.getByText(title, { exact: true })).toBeVisible()
    }
    await inbox.getByRole('button', { name: `Edit Assign ${suffix}`, exact: true }).click()
    await inbox.getByRole('combobox', { name: 'Edit project' }).selectOption(project.id)
    await inbox.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(inbox.getByText(`Assign ${suffix}`, { exact: true })).toHaveCount(0)
    await inbox.getByRole('button', { name: `Complete Finish ${suffix}`, exact: true }).click()
    await expect(inbox.getByText(`Finish ${suffix}`, { exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
    const response = await page.request.get('/api/v1/tasks')
    expect(response.status()).toBe(200)
    const { items } = await response.json()
    expect(items.find((task: { id: string }) => task.id === createdIds[0])).toMatchObject({
      project_id: project.id,
      status: 'todo',
    })
    expect(items.find((task: { id: string }) => task.id === createdIds[1])).toMatchObject({
      project_id: null,
      status: 'completed',
    })
    await expect(inbox.getByText(`Assign ${suffix}`, { exact: true })).toHaveCount(0)
    await expect(inbox.getByText(`Finish ${suffix}`, { exact: true })).toHaveCount(0)
  } finally {
    const remaining = await page.request.get('/api/v1/tasks?limit=100')
    expect(remaining.status()).toBe(200)
    const { items }: { items: Task[] } = await remaining.json()
    for (const id of createdIds) {
      const task = items.find((item) => item.id === id)
      if (!task) continue
      const deleted = await page.request.delete(`/api/v1/tasks/${id}`, {
        headers,
        params: { expected_version: task.version },
      })
      expect(deleted.status(), await deleted.text()).toBe(204)
    }
    const deletedProject = await page.request.delete(`/api/v1/projects/${project.id}`, {
      headers,
      params: { expected_version: project.version },
    })
    expect(deletedProject.status(), await deletedProject.text()).toBe(204)
  }
})
