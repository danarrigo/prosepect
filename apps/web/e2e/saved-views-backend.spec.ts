import { expect, test } from '@playwright/test'
import type { SavedTaskView } from '../src/api/types'

// Cookie-authenticated isolated CI backend, without intercepted API responses.
test('real backend: saved task filters persist and deletion leaves the project intact', async ({
  page,
}) => {
  await page.goto('/projects')
  await expect(page.getByRole('button', { name: 'Save current view', exact: true })).toBeEnabled()
  const session = await (await page.request.get('/api/v1/session')).json()
  const headers = { 'x-csrf-token': session.csrf_token as string }
  const suffix = `${test.info().project.name}-${Date.now()}`
  const name = `Saved view ${suffix}`
  const projectResponse = await page.request.post('/api/v1/projects', {
    headers,
    data: { name: `View project ${suffix}` },
  })
  expect(projectResponse.status()).toBe(201)
  const project = await projectResponse.json()
  let viewId: string | undefined
  try {
    await page.goto(`/projects?project=${project.id}`)
    await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Search tasks' }).fill(suffix)
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('blocked')
    await page.getByRole('combobox', { name: 'Sort tasks', exact: true }).selectOption('title')
    await page.getByRole('button', { name: 'Save current view', exact: true }).click()
    await page.getByRole('textbox', { name: 'View name' }).fill(name)
    const creation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/saved-task-views' &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Save view', exact: true }).click()
    const created = await creation
    expect(created.status()).toBe(201)
    const view: SavedTaskView = await created.json()
    viewId = view.id
    expect(view).toMatchObject({
      name,
      search: suffix,
      status: 'blocked',
      sort: 'title',
      project_id: project.id,
    })
    // Existing session cookies alone must not authorize writes.
    expect((await page.request.delete(`/api/v1/saved-task-views/${viewId}`)).status()).toBe(403)
    await page.reload()
    await page.locator('summary').filter({ hasText: 'Saved views' }).click()
    await page.getByRole('button', { name: `${name} ${project.name}`, exact: true }).click()
    await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue(suffix)
    await expect(page.getByRole('combobox', { name: 'Filter by status' })).toHaveValue('blocked')
    await expect(page.getByRole('combobox', { name: 'Sort tasks', exact: true })).toHaveValue(
      'title',
    )
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: `Delete saved view ${name}`, exact: true }).click()
    await expect(
      page.getByRole('button', { name: `${name} ${project.name}`, exact: true }),
    ).toHaveCount(0)
    const persisted: SavedTaskView[] = await (
      await page.request.get('/api/v1/saved-task-views')
    ).json()
    expect(persisted.some((item) => item.id === viewId)).toBe(false)
    viewId = undefined
    const projects = await (await page.request.get('/api/v1/projects?limit=100')).json()
    expect(projects.items.some((item: { id: string }) => item.id === project.id)).toBe(true)
  } finally {
    if (viewId)
      expect(
        (await page.request.delete(`/api/v1/saved-task-views/${viewId}`, { headers })).status(),
      ).toBe(204)
    const removed = await page.request.delete(`/api/v1/projects/${project.id}`, {
      headers,
      params: { expected_version: project.version },
    })
    expect(removed.status(), await removed.text()).toBe(204)
  }
})
