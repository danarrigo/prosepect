import { expect, test } from '@playwright/test'
import type { Project, Task } from '../src/api/types'

test('real backend: bulk actions persist and deleted tasks retain individual Undo', async ({
  page,
}) => {
  await page.goto('/inbox')
  const session = await (await page.request.get('/api/v1/session')).json()
  const headers = { 'x-csrf-token': session.csrf_token as string }
  const suffix = `${test.info().project.name}-${Date.now()}`
  const projectResponse = await page.request.post('/api/v1/projects', {
    headers,
    data: { name: `Bulk ${suffix}`, outcome: '' },
  })
  expect(projectResponse.status()).toBe(201)
  const project: Project = await projectResponse.json()
  const created: Task[] = []
  try {
    for (let index = 0; index < 2; index++) {
      const response = await page.request.post('/api/v1/tasks', {
        headers,
        data: {
          title: `Bulk ${suffix} ${index}`,
          description: 'Keep exact details',
          priority: 'low',
          due_at: '2030-01-01T12:34:56Z',
          labels: ['reference'],
        },
      })
      expect(response.status()).toBe(201)
      created.push(await response.json())
    }
    await page.reload()
    await page.getByRole('button', { name: 'Select tasks', exact: true }).click()
    for (const task of created)
      await page.getByRole('checkbox', { name: `Select ${task.title}`, exact: true }).check()
    const panel = page.getByRole('region', { name: 'Bulk task actions' })
    await panel.getByRole('combobox', { name: 'Action', exact: true }).selectOption('priority')
    await panel.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high')
    await panel.getByRole('button', { name: 'Apply to selected' }).click()
    await expect(panel.getByText('2 saved. 0 not confirmed.')).toBeVisible()
    for (const task of created)
      await page.getByRole('checkbox', { name: `Select ${task.title}`, exact: true }).check()
    await panel.getByRole('combobox', { name: 'Action', exact: true }).selectOption('project')
    await panel
      .getByRole('combobox', { name: 'Destination project', exact: true })
      .selectOption(project.id)
    await panel.getByRole('button', { name: 'Apply to selected' }).click()
    for (const task of created)
      await expect(
        page.getByRole('checkbox', { name: `Select ${task.title}`, exact: true }),
      ).toHaveCount(0)
    await page.goto(`/projects?project=${project.id}`)
    await page.getByRole('button', { name: 'Select tasks', exact: true }).click()
    for (const task of created)
      await page.getByRole('checkbox', { name: `Select ${task.title}`, exact: true }).check()
    await panel.getByRole('combobox', { name: 'Action', exact: true }).selectOption('complete')
    await panel.getByRole('button', { name: 'Apply to selected' }).click()
    await expect(panel.getByText('2 saved. 0 not confirmed.')).toBeVisible()
    const persisted: { items: Task[] } = await (
      await page.request.get(`/api/v1/tasks?project_id=${project.id}`)
    ).json()
    expect(persisted.items).toHaveLength(2)
    for (const task of persisted.items)
      expect(task).toMatchObject({
        status: 'completed',
        priority: 'high',
        due_at: '2030-01-01T12:34:56Z',
        description: 'Keep exact details',
        labels: ['reference'],
      })
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('all')
    for (const task of created)
      await page.getByRole('checkbox', { name: `Select ${task.title}`, exact: true }).check()
    await panel.getByRole('combobox', { name: 'Action', exact: true }).selectOption('delete')
    page.once('dialog', (dialog) => dialog.accept())
    await panel.getByRole('button', { name: 'Apply to selected' }).click()
    await expect(panel.getByText('2 saved. 0 not confirmed.')).toBeVisible()
    const undo = page.getByRole('button', {
      name: `Undo deletion of ${created[0]!.title}`,
      exact: true,
    })
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect(
      page.getByRole('checkbox', { name: `Select ${created[0]!.title}`, exact: true }),
    ).toBeVisible()
    const restored: { items: Task[] } = await (
      await page.request.get(`/api/v1/tasks?project_id=${project.id}`)
    ).json()
    expect(restored.items).toHaveLength(1)
    expect(restored.items[0]).toMatchObject({
      id: created[0]!.id,
      priority: 'high',
      status: 'completed',
    })
  } finally {
    const tasks: { items: Task[] } = await (
      await page.request.get('/api/v1/tasks?limit=100')
    ).json()
    for (const task of tasks.items.filter((task) =>
      created.some((original) => task.id === original.id),
    )) {
      const deleted = await page.request.delete(`/api/v1/tasks/${task.id}`, {
        headers,
        params: { expected_version: task.version },
      })
      expect(deleted.status(), await deleted.text()).toBe(204)
    }
    const projects: { items: Project[] } = await (
      await page.request.get('/api/v1/projects?limit=100')
    ).json()
    const current = projects.items.find((candidate) => candidate.id === project.id)
    if (current) {
      const deleted = await page.request.delete(`/api/v1/projects/${project.id}`, {
        headers,
        params: { expected_version: current.version },
      })
      expect(deleted.status(), await deleted.text()).toBe(204)
    }
  }
})
