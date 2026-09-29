import { expect, test, type Page } from '@playwright/test'
import type {
  CalendarEvent,
  DailyPlan,
  FileRecord,
  Note,
  Project,
  Task,
  TaskDeleteUndo,
} from '../src/api/types'

// REAL backend acceptance: no intercepted API responses or fake Google claim.
// Run in the parent-owned isolated CI stack, not against production.
test.use({ timezoneId: 'UTC' })

async function sessionHeaders(page: Page) {
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  const id = await page.evaluate(() => localStorage.getItem('prosepect.development-user-id'))
  expect(id).toBeTruthy()
  const response = await page.request.get('/api/v1/session', {
    headers: { 'x-prosepect-user-id': id! },
  })
  expect(response.ok()).toBe(true)
  const session = await response.json()
  return { 'x-prosepect-user-id': id!, 'x-csrf-token': session.csrf_token as string }
}

async function deleteThroughUI(page: Page, task: Task) {
  await page.getByRole('button', { name: `Edit ${task.title}`, exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/tasks/${task.id}/delete-with-undo` &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const result = await response
  expect(result.status()).toBe(200)
  expect(result.request().postDataJSON()).toEqual({ expected_version: task.version })
  return (await result.json()) as TaskDeleteUndo
}

test('real backend: native deletion recovers multiple receipts and restores dependencies and identity', async ({
  page,
}) => {
  const headers = await sessionHeaders(page)
  const suffix = `${test.info().project.name}-${Date.now()}`
  const created: Task[] = []
  const receipts: TaskDeleteUndo[] = []
  let project: Project | undefined
  let file: FileRecord | undefined
  const today = new Date().toISOString().slice(0, 10)
  const planPath = `/api/v1/daily-plans/${today}`
  const originalPlan = (await (await page.request.get(planPath, { headers })).json()) as DailyPlan
  try {
    const projectResponse = await page.request.post('/api/v1/projects', {
      headers,
      data: { name: `Undo acceptance ${suffix}` },
    })
    expect(projectResponse.status()).toBe(201)
    project = (await projectResponse.json()) as Project
    for (const title of ['Dependent task', 'Other deletion']) {
      const response = await page.request.post('/api/v1/tasks', {
        headers,
        data: {
          title: `${title} ${suffix}`,
          project_id: project.id,
          ...(created.length === 0
            ? { scheduled_start: `${today}T09:00:00Z`, scheduled_end: `${today}T10:00:00Z` }
            : {}),
        },
      })
      expect(response.status()).toBe(201)
      created.push((await response.json()) as Task)
    }
    const task = created[0]!
    const events = (await (await page.request.get('/api/v1/events', { headers })).json()) as {
      items: CalendarEvent[]
    }
    const event = events.items.find((event) => event.linked_task_id === task.id)!
    expect(event).toBeTruthy()
    const noteResponse = await page.request.post('/api/v1/notes', {
      headers,
      data: {
        task_id: task.id,
        title: `Linked note ${suffix}`,
        markdown: 'Preserve exact markdown',
      },
    })
    expect(noteResponse.status()).toBe(201)
    const note = (await noteResponse.json()) as Note
    const fileResponse = await page.request.post('/api/v1/files', {
      headers,
      multipart: {
        note_id: note.id,
        file: {
          name: 'undo-acceptance.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('preserve attachment bytes'),
        },
      },
    })
    expect(fileResponse.status()).toBe(201)
    file = (await fileResponse.json()) as FileRecord
    expect(
      (
        await page.request.put(`${planPath}/focus`, { headers, data: { task_ids: [task.id] } })
      ).ok(),
    ).toBe(true)
    await page.reload()
    const legacy: string[] = []
    page.on('request', (request) => {
      if (
        request.method() === 'DELETE' &&
        new URL(request.url()).pathname.startsWith('/api/v1/tasks/')
      )
        legacy.push(request.url())
    })
    receipts.push(await deleteThroughUI(page, task))
    receipts.push(await deleteThroughUI(page, created[1]!))
    const feedback = page.getByRole('region', { name: 'Task deletion Undo', exact: true })
    await expect(
      feedback.getByRole('button', { name: `Undo deletion of ${task.title}` }),
    ).toBeEnabled()
    const deletedNotes = (await (await page.request.get('/api/v1/notes', { headers })).json()) as {
      items: Note[]
    }
    expect(deletedNotes.items.some((item) => item.id === note.id)).toBe(false)
    const detached = (await (await page.request.get('/api/v1/files', { headers })).json()) as {
      items: FileRecord[]
    }
    expect(detached.items.find((item) => item.id === file!.id)?.note_id).toBeNull()
    await page.goto('/notes')
    await page.reload()
    await expect(
      feedback.getByRole('button', { name: `Undo deletion of ${created[1]!.title}` }),
    ).toBeEnabled()
    const consume = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/task-delete-undos/${receipts[0]!.id}/consume`,
    )
    await feedback.getByRole('button', { name: `Undo deletion of ${task.title}` }).click()
    expect((await consume).status()).toBe(204)
    await expect(feedback).toContainText(`Restored “${task.title}”.`)
    await expect(page.getByRole('button', { name: new RegExp(note.title) })).toBeVisible()
    const restoredTasks = (await (
      await page.request.get('/api/v1/tasks?limit=100', { headers })
    ).json()) as { items: Task[] }
    const restored = restoredTasks.items.find((item) => item.id === task.id)!
    expect(restored.title).toBe(task.title)
    expect(restored.version).toBeGreaterThan(task.version)
    const restoredNotes = (await (await page.request.get('/api/v1/notes', { headers })).json()) as {
      items: Note[]
    }
    expect(restoredNotes.items.find((item) => item.id === note.id)).toMatchObject({
      markdown: note.markdown,
      task_id: task.id,
    })
    const restoredFiles = (await (await page.request.get('/api/v1/files', { headers })).json()) as {
      items: FileRecord[]
    }
    expect(restoredFiles.items.find((item) => item.id === file!.id)?.note_id).toBe(note.id)
    const restoredEvents = (await (
      await page.request.get('/api/v1/events', { headers })
    ).json()) as { items: CalendarEvent[] }
    expect(restoredEvents.items.find((item) => item.id === event.id)?.linked_task_id).toBe(task.id)
    const restoredPlan = (await (await page.request.get(planPath, { headers })).json()) as DailyPlan
    expect(restoredPlan.focus_tasks.map((item) => item.id)).toContain(task.id)
    const summaries = (await (
      await page.request.get('/api/v1/projects?limit=100', { headers })
    ).json()) as { items: Project[] }
    expect(summaries.items.find((item) => item.id === project!.id)?.total_tasks).toBe(1)
    expect(
      (
        await page.request.post(`/api/v1/task-delete-undos/${receipts[0]!.id}/consume`, { headers })
      ).ok(),
    ).toBe(false)
    expect(legacy).toEqual([])
  } finally {
    // Only this test's entities; cleanup uses the intentionally retained legacy API.
    for (const receipt of receipts)
      await page.request.post(`/api/v1/task-delete-undos/${receipt.id}/consume`, { headers })
    await page.request.put(`${planPath}/focus`, {
      headers,
      data: { task_ids: originalPlan.focus_tasks.map((task) => task.id) },
    })
    if (file) await page.request.delete(`/api/v1/files/${file.id}`, { headers })
    const current = (await (
      await page.request.get('/api/v1/tasks?limit=100', { headers })
    ).json()) as { items: Task[] }
    for (const task of current.items.filter((task) =>
      created.some((created) => created.id === task.id),
    ))
      await page.request.delete(`/api/v1/tasks/${task.id}?expected_version=${task.version}`, {
        headers,
      })
    if (project)
      await page.request.delete(
        `/api/v1/projects/${project.id}?expected_version=${project.version}`,
        { headers },
      )
  }
})

test('real backend: parent deletion refusal leaves both tasks intact and offers no permanent fallback', async ({
  page,
}) => {
  const headers = await sessionHeaders(page)
  const suffix = `${test.info().project.name}-${Date.now()}`
  const tasks: Task[] = []
  try {
    for (const title of ['Parent', 'Child']) {
      const response = await page.request.post('/api/v1/tasks', {
        headers,
        data: { title: `${title} ${suffix}`, parent_task_id: tasks[0]?.id ?? null },
      })
      expect(response.status()).toBe(201)
      tasks.push((await response.json()) as Task)
    }
    await page.reload()
    await page.getByRole('button', { name: `Edit ${tasks[0]!.title}`, exact: true }).click()
    page.once('dialog', (dialog) => dialog.accept())
    const refusal = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/tasks/${tasks[0]!.id}/delete-with-undo`,
    )
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    expect((await refusal).status()).toBe(409)
    await expect(page.getByRole('alert')).toBeVisible()
    const listed = (await (
      await page.request.get('/api/v1/tasks?limit=100', { headers })
    ).json()) as { items: Task[] }
    expect(listed.items.filter((item) => tasks.some((task) => task.id === item.id))).toHaveLength(2)
    await expect(
      page.getByRole('button', { name: `Undo deletion of ${tasks[0]!.title}` }),
    ).toHaveCount(0)
  } finally {
    for (const task of tasks.toReversed())
      await page.request.delete(`/api/v1/tasks/${task.id}?expected_version=${task.version}`, {
        headers,
      })
  }
})
