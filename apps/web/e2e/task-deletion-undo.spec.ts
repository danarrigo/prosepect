import { expect, test, type Page } from '@playwright/test'
import type { components } from '../src/api/schema'

type Task = components['schemas']['Task']
type Receipt = components['schemas']['TaskDeleteUndo']

async function mockDeletions(page: Page) {
  const tasks: Task[] = ['First task', 'Second task'].map((title, index) => ({
    id: `task-${index}`,
    title,
    description: '',
    project_id: null,
    parent_task_id: null,
    scheduled_start: null,
    scheduled_end: null,
    due_at: null,
    remind_at: null,
    completed_at: null,
    status: 'todo',
    priority: 'medium',
    recurrence: 'none',
    labels: [],
    position: index * 1024,
    version: 1,
    created_at: '',
    updated_at: '',
  }))
  const receipts: Receipt[] = []
  const deleted = new Map<string, Task>()
  const requests: string[] = []
  let refuse = false
  let refreshFailure = false
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    const method = route.request().method()
    requests.push(`${method} ${path}`)
    let body: unknown = { items: [] }
    if (path === '/session')
      body = {
        csrf_token: 'mock',
        user: { id: 'owner', email: 'owner@example.test', display_name: 'Owner', timezone: 'UTC' },
      }
    else if (path === '/settings')
      body = {
        theme: 'system',
        automatic_daily_review: false,
        sidebar_visible: true,
        sync_conflict_policy: 'ask',
        version: 1,
      }
    else if (path.startsWith('/daily-plans/')) body = { focus_task_ids: [], focus_tasks: [] }
    else if (path === '/tasks') body = { items: tasks }
    else if (path === '/notes' && refreshFailure) {
      await route.fulfill({
        status: 503,
        json: { error: { message: 'Offline', code: 'unavailable' } },
      })
      return
    } else if (path === '/task-delete-undos') body = { items: receipts }
    else if (path.endsWith('/delete-with-undo') && method === 'POST') {
      if (refuse) {
        await route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'conflict',
              message: 'Google mirror is not eligible. Task was not deleted.',
            },
          },
        })
        return
      }
      const index = tasks.findIndex((task) => task.id === path.split('/')[2])
      const task = tasks.splice(index, 1)[0]!
      expect(route.request().postDataJSON()).toEqual({ expected_version: task.version })
      const receipt = {
        id: `receipt-${task.id}`,
        task_id: task.id,
        task_title: task.title,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      }
      deleted.set(receipt.id, task)
      receipts.unshift(receipt)
      body = receipt
    } else if (path.endsWith('/consume') && method === 'POST') {
      const id = path.split('/')[2]!
      const task = deleted.get(id)!
      tasks.push({ ...task, version: task.version + 1 })
      receipts.splice(
        receipts.findIndex((receipt) => receipt.id === id),
        1,
      )
      deleted.delete(id)
      await route.fulfill({ status: 204 })
      return
    }
    await route.fulfill({ json: body })
  })
  return {
    tasks,
    receipts,
    requests,
    refuse: () => {
      refuse = true
    },
    failRefresh: () => {
      refreshFailure = true
    },
  }
}

async function remove(page: Page, title: string) {
  await page
    .getByRole('button', { name: `Edit ${title}`, exact: true })
    .first()
    .click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
}

test('distinct deletion receipts survive navigation and reload, restore identity and preserve keyboard focus', async ({
  page,
}, testInfo) => {
  const state = await mockDeletions(page)
  await page.goto('/projects')
  await remove(page, 'First task')
  const feedback = page.getByRole('region', { name: 'Task deletion Undo', exact: true })
  await expect(feedback.getByRole('button', { name: 'Undo deletion of First task' })).toBeEnabled()
  await expect(feedback).toBeFocused()
  await remove(page, 'Second task')
  await expect(feedback.getByRole('button', { name: 'Undo deletion of Second task' })).toBeEnabled()
  const notesLink = page.getByRole('link', { name: 'Notes', exact: true })
  if (!(await notesLink.isVisible()))
    await page.getByRole('button', { name: 'Open navigation' }).click()
  await notesLink.click()
  await expect(page).toHaveURL(/\/notes$/)
  await expect(feedback.getByRole('button', { name: 'Undo deletion of First task' })).toBeVisible()
  await page.reload()
  await expect(feedback.getByRole('button', { name: 'Undo deletion of First task' })).toBeVisible()
  const undo = feedback.getByRole('button', { name: 'Undo deletion of First task' })
  await undo.focus()
  await page.keyboard.press('Enter')
  await expect(feedback).toContainText('Restored “First task”.')
  await expect(feedback).toBeFocused()
  expect(state.tasks.find((task) => task.id === 'task-0')?.version).toBe(2)
  await expect(feedback.getByRole('button', { name: 'Undo deletion of Second task' })).toBeEnabled()
  expect(state.requests.some((request) => request.startsWith('DELETE /tasks/'))).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('deletion-undo.png'), fullPage: true })
})

test('refusal leaves the task intact and never falls back to permanent deletion', async ({
  page,
}) => {
  const state = await mockDeletions(page)
  state.refuse()
  await page.goto('/projects')
  await remove(page, 'First task')
  await expect(page.getByRole('alert')).toContainText('Task was not deleted')
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
  expect(state.requests.some((request) => request.startsWith('DELETE /tasks/'))).toBe(false)
})

test('a saved deletion keeps Undo when a dependent refresh fails', async ({ page }) => {
  const state = await mockDeletions(page)
  await page.goto('/projects')
  await expect(
    page.getByRole('button', { name: 'Edit First task', exact: true }).first(),
  ).toBeVisible()
  state.failRefresh()
  await remove(page, 'First task')
  const feedback = page.getByRole('region', { name: 'Task deletion Undo', exact: true })
  await expect(feedback).toContainText('Deletion saved, but refresh failed')
  await expect(feedback.getByRole('button', { name: 'Undo deletion of First task' })).toBeEnabled()
})

// These are UI protocol mocks, not backend or Google acceptance.
test('expiry disables Undo without countdown announcements; server errors re-fetch receipts', async ({
  page,
}) => {
  const state = await mockDeletions(page)
  await page.clock.install()
  await page.goto('/projects')
  await remove(page, 'First task')
  const feedback = page.getByRole('region', { name: 'Task deletion Undo', exact: true })
  const undo = feedback.getByRole('button', { name: 'Undo deletion of First task' })
  await expect(undo).toBeEnabled()
  const status = await feedback.getByRole('status').textContent()
  await page.clock.fastForward(10000)
  await expect(feedback.getByRole('status')).toHaveText(status!)
  await page.route('**/task-delete-undos/*/consume', async (route) => {
    state.receipts.splice(0)
    await route.fulfill({
      status: 409,
      json: {
        error: { code: 'conflict', message: 'Undo is no longer available. Task stays deleted.' },
      },
    })
  })
  await undo.click()
  await expect(feedback.getByRole('alert')).toContainText('Task stays deleted')
  await expect(undo).toHaveCount(0)
  await remove(page, 'Second task')
  const second = feedback.getByRole('button', { name: 'Undo deletion of Second task' })
  await expect(second).toBeEnabled()
  await page.clock.fastForward(61000)
  await expect(second).toBeDisabled()
  await expect(feedback.getByRole('status')).toContainText('1 deletion Undo expired')
  await feedback.getByRole('button', { name: 'Dismiss deletion feedback' }).click()
  await expect(feedback).toHaveCount(0)
  await expect(page.getByRole('main')).toBeFocused()
  expect(
    state.requests.filter((request) => request === 'GET /task-delete-undos').length,
  ).toBeGreaterThan(1)
})

test('receipt-list outage has a working recovery action independent of workspace bootstrap', async ({
  page,
}) => {
  await mockDeletions(page)
  let fail = true
  await page.route('**/task-delete-undos', (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { error: { message: 'Unavailable' } } }
        : {
            json: {
              items: [
                {
                  id: 'recover',
                  task_id: 'old',
                  task_title: 'Recovered deletion',
                  expires_at: new Date(Date.now() + 60000).toISOString(),
                },
              ],
            },
          },
    ),
  )
  await page.goto('/projects')
  const feedback = page.getByRole('region', { name: 'Task deletion Undo', exact: true })
  await expect(feedback.getByRole('alert')).toContainText('Could not recover')
  fail = false
  await feedback.getByRole('button', { name: 'Retry refresh' }).click()
  await expect(
    feedback.getByRole('button', { name: 'Undo deletion of Recovered deletion' }),
  ).toBeEnabled()
  await expect(feedback.getByRole('alert')).toHaveCount(0)
})

test('Undo refresh preserves a routed note draft and does not steal focus after an asynchronous response', async ({
  page,
}) => {
  await mockDeletions(page)
  await page.route('**/api/v1/notes', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'note',
            title: 'Saved note',
            markdown: 'Saved text',
            version: 1,
            updated_at: new Date().toISOString(),
          },
        ],
      },
    }),
  )
  await page.goto('/projects')
  await remove(page, 'First task')
  await page.goto('/notes?note=note')
  await page.getByRole('button', { name: 'Edit note', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'Markdown', exact: true })
  await draft.fill('Unsaved note draft')
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/task-delete-undos/*/consume', async (route) => {
    await pending
    await route.fallback()
  })
  await page.getByRole('button', { name: 'Undo deletion of First task' }).click()
  await draft.focus()
  release()
  await expect(page.getByRole('region', { name: 'Task deletion Undo', exact: true })).toContainText(
    'Restored “First task”.',
  )
  await expect(draft).toHaveValue('Unsaved note draft')
  await expect(draft).toBeFocused()
})

test('task and settings drafts survive dependent refresh', async ({ page }) => {
  await mockDeletions(page)
  await page.goto('/projects')
  await remove(page, 'First task')
  await page.getByRole('button', { name: 'Edit Second task', exact: true }).click()
  const title = page.getByRole('textbox', { name: 'Task title', exact: true })
  await title.fill('Unsaved second task')
  await page.getByRole('button', { name: 'Undo deletion of First task' }).click()
  await expect(title).toHaveValue('Unsaved second task')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await remove(page, 'First task')
  await page.goto('/settings')
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true })
  await theme.selectOption('dark')
  await page.getByRole('button', { name: 'Undo deletion of First task' }).click()
  await expect(theme).toHaveValue('dark')
})

test('logout clears private feedback and rejects an in-flight deletion response', async ({
  page,
}) => {
  await mockDeletions(page)
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/tasks/*/delete-with-undo', async (route) => {
    await pending
    await route.fallback()
  })
  await page.goto('/projects')
  await remove(page, 'First task')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  release()
  await expect(page.getByRole('region', { name: 'Task deletion Undo', exact: true })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('First task')
})

test('deletion and move Undo share one accessible surface across narrow and desktop themes', async ({
  page,
}, testInfo) => {
  await mockDeletions(page)
  await page.route('**/calendar-move-undos', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'move',
            event_id: 'standalone',
            task_id: null,
            expires_at: new Date(Date.now() + 60000).toISOString(),
          },
        ],
      },
    }),
  )
  await page.route('**/calendar-move-undos/move/consume', (route) => route.fulfill({ status: 204 }))
  await page.goto('/projects')
  await remove(page, 'First task')
  await remove(page, 'Second task')
  const move = page.getByRole('region', { name: 'Calendar move Undo', exact: true })
  const deletion = page.getByRole('region', { name: 'Task deletion Undo', exact: true })
  await expect(move).toBeVisible()
  await expect(deletion).toBeVisible()
  await expect(deletion.getByRole('button', { name: 'Undo deletion of Second task' })).toBeEnabled()
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: width < 400 ? 812 : 900 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
        theme,
      )
      await expect(page.getByRole('button', { name: 'Undo deletion of First task' })).toBeVisible()
      const bounds = await deletion.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({
        path: testInfo.outputPath(`undo-${width}-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      })
    }
  }
  await move.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(move).toContainText('Move undone.')
  await expect(deletion.getByRole('button', { name: 'Undo deletion of First task' })).toBeEnabled()
})

test('Google conflict controls use capabilities and keep authoritative 409 errors actionable', async ({
  page,
}) => {
  await mockDeletions(page)
  await page.route('**/api/v1/integrations/google', (route) =>
    route.fulfill({ json: { connected: true } }),
  )
  await page.route('**/api/v1/sync-conflicts', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'special',
            title: 'Deleted task conflict',
            canonical_event_id: 'not-null',
            allowed_resolutions: ['google'],
          },
          {
            id: 'ordinary',
            title: 'Ordinary null-ID conflict',
            canonical_event_id: null,
            allowed_resolutions: ['google', 'prosepect', 'latest'],
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/sync-conflicts/special/resolve', (route) => {
    expect(route.request().postDataJSON()).toEqual({ resolution: 'google' })
    return route.fulfill({
      status: 409,
      json: { error: { code: 'conflict', message: 'Decision changed. Refresh the conflict.' } },
    })
  })
  await page.goto('/settings')
  await expect(page.getByRole('button', { name: 'Use Google', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Use Prosepect', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Use latest', exact: true })).toHaveCount(1)
  await expect(page.getByText(/The task stays deleted. Keep Google/)).toBeVisible()
  await page.getByRole('button', { name: 'Keep Google', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Decision changed. Refresh the conflict.')
})

test('restoration refreshes dependent notes and attachment links in the current view', async ({
  page,
}) => {
  const state = await mockDeletions(page)
  const present = () => state.tasks.some((task) => task.id === 'task-0')
  await page.route('**/api/v1/notes', (route) =>
    route.fulfill({
      json: {
        items: present()
          ? [
              {
                id: 'dependent',
                title: 'Linked task note',
                markdown: 'Preserved contents',
                task_id: 'task-0',
                version: present() ? 2 : 1,
                updated_at: new Date().toISOString(),
              },
            ]
          : [],
      },
    }),
  )
  await page.route('**/api/v1/files', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'file',
            filename: 'linked-proof.txt',
            content_type: 'text/plain',
            size_bytes: 10,
            note_id: present() ? 'dependent' : null,
            created_at: new Date().toISOString(),
          },
        ],
      },
    }),
  )
  await page.goto('/projects')
  await remove(page, 'First task')
  await page.goto('/notes?note=dependent')
  await expect(page.getByRole('heading', { name: 'Linked task note' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo deletion of First task' }).click()
  await expect(page.getByRole('heading', { name: 'Linked task note' })).toBeVisible()
  await expect(page.getByText('Preserved contents', { exact: true })).toBeVisible()
  await expect(page.getByText('linked-proof.txt', { exact: true })).toBeVisible()
})

test('a delayed initial calendar read cannot resurrect pre-deletion data', async ({ page }) => {
  const state = await mockDeletions(page)
  state.tasks[0]!.due_at = '2026-09-13T12:00:00Z'
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let reads = 0
  await page.route('**/api/v1/events?**', async (route) => {
    reads += 1
    if (reads === 2) {
      await pending
      await route.fulfill({
        json: {
          items: [
            {
              id: 'stale-event',
              calendar_id: 'native',
              title: 'Stale pre-deletion snapshot',
              starts_at: '2026-09-13T09:00:00Z',
              ends_at: '2026-09-13T10:00:00Z',
              all_day: false,
              timezone: 'UTC',
              recurrence: 'none',
              version: 1,
            },
          ],
        },
      })
    } else await route.fulfill({ json: { items: [] } })
  })
  await page.goto('/calendar?date=2026-09-13&view=day')
  await expect.poll(() => reads).toBe(2)
  await remove(page, 'First task')
  await expect(page.getByRole('button', { name: 'Undo deletion of First task' })).toBeEnabled()
  const lateResponse = page.waitForResponse(
    async (response) =>
      new URL(response.url()).pathname === '/api/v1/events' &&
      (await response.json()).items.some((item: { id: string }) => item.id === 'stale-event'),
  )
  release()
  await (await lateResponse).finished()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await expect(page.getByText('Stale pre-deletion snapshot', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit First task', exact: true })).toHaveCount(0)
})

// Independent-review regressions: exercise real editor/store interleavings with deferred HTTP.
test('review: a successful note creation survives an older Undo refresh snapshot', async ({
  page,
}) => {
  await mockDeletions(page)
  const notes: { id: string; title: string; markdown: string; version: number }[] = []
  await page.route('**/api/v1/notes', async (route) => {
    if (route.request().method() === 'POST') {
      const note = {
        ...route.request().postDataJSON(),
        id: 'new-note',
        version: 1,
        updated_at: new Date().toISOString(),
      }
      notes.push(note)
      await route.fulfill({ status: 201, json: note })
    } else await route.fulfill({ json: { items: notes } })
  })
  await page.goto('/projects')
  await remove(page, 'First task')
  await page.goto('/notes')
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Saved during Undo')
  await page.getByRole('textbox', { name: 'Markdown', exact: true }).fill('New successful content')
  let release!: () => void
  let captured = false
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/files', async (route) => {
    captured = true
    await pending
    await route.fulfill({ json: { items: [] } })
  })
  const snapshot = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/notes' && response.request().method() === 'GET',
  )
  await page.getByRole('button', { name: 'Undo deletion of First task' }).click()
  await snapshot
  await expect.poll(() => captured).toBe(true)
  await page.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Saved during Undo' })).toBeVisible()
  release()
  await expect(page.getByRole('region', { name: 'Task deletion Undo', exact: true })).toContainText(
    'Restored “First task”.',
  )
  await expect(page.getByRole('heading', { name: 'Saved during Undo' })).toBeVisible()
  await expect(page.getByText('New successful content', { exact: true })).toBeVisible()
})

test('review: a routed note draft retains its base version and reopening uses the newest content', async ({
  page,
}) => {
  await mockDeletions(page)
  let note = {
    id: 'note',
    title: 'Concurrent note',
    markdown: 'Original content',
    version: 1,
    updated_at: new Date().toISOString(),
  }
  let submittedVersion: number | undefined
  await page.route('**/api/v1/notes', (route) => route.fulfill({ json: { items: [note] } }))
  await page.route('**/api/v1/notes/note', async (route) => {
    const input = route.request().postDataJSON()
    submittedVersion = input.expected_version
    if (submittedVersion !== note.version)
      await route.fulfill({
        status: 409,
        json: { error: { code: 'conflict', message: 'Note changed. Your draft was not saved.' } },
      })
    else {
      note = { ...note, ...input, version: note.version + 1 }
      await route.fulfill({ json: note })
    }
  })
  await page.goto('/projects')
  await remove(page, 'First task')
  await remove(page, 'Second task')
  await page.goto('/notes?note=note')
  await page.getByRole('button', { name: 'Edit note', exact: true }).click()
  const markdown = page.getByRole('textbox', { name: 'Markdown', exact: true })
  await markdown.fill('My unsaved version-one draft')
  note = { ...note, markdown: 'Other session version two', version: 2 }
  await page.getByRole('button', { name: 'Undo deletion of First task' }).click()
  await expect(page.getByRole('region', { name: 'Task deletion Undo', exact: true })).toContainText(
    'Restored “First task”.',
  )
  await page.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect.poll(() => submittedVersion).toBe(1)
  await expect(page.getByRole('alert')).toContainText('Your draft was not saved')
  await expect(markdown).toHaveValue('My unsaved version-one draft')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  note = { ...note, markdown: 'Other session version three', version: 3 }
  await page.getByRole('button', { name: 'Undo deletion of Second task' }).click()
  await expect(page.getByText('Other session version three', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit note', exact: true }).click()
  await expect(markdown).toHaveValue('Other session version three')
})

test('review: a project draft retains its base version through Undo summary refresh', async ({
  page,
}) => {
  await mockDeletions(page)
  let project = {
    id: 'project',
    name: 'Concurrent project',
    outcome: 'Original outcome',
    status: 'active',
    total_tasks: 0,
    completed_tasks: 0,
    version: 1,
  }
  let submittedVersion: number | undefined
  await page.route('**/api/v1/projects?**', (route) =>
    route.fulfill({ json: { items: [project], next_cursor: null } }),
  )
  await page.route('**/api/v1/projects/project', async (route) => {
    const input = route.request().postDataJSON()
    submittedVersion = input.expected_version
    if (submittedVersion !== project.version)
      await route.fulfill({
        status: 409,
        json: {
          error: { code: 'conflict', message: 'Project changed. Your draft was not saved.' },
        },
      })
    else {
      project = { ...project, ...input, version: project.version + 1 }
      await route.fulfill({ json: project })
    }
  })
  await page.goto('/projects')
  await remove(page, 'First task')
  await page
    .getByRole('main')
    .getByRole('button', { name: /Concurrent project/ })
    .click()
  await page.getByRole('button', { name: 'Edit project', exact: true }).click()
  const outcome = page.getByRole('form', { name: 'Edit project' }).getByLabel('Desired outcome')
  await outcome.fill('My unsaved version-one outcome')
  project = { ...project, outcome: 'Other session version two', version: 2 }
  await page.getByRole('button', { name: 'Undo deletion of First task' }).click()
  await expect(page.getByRole('region', { name: 'Task deletion Undo', exact: true })).toContainText(
    'Restored “First task”.',
  )
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect.poll(() => submittedVersion).toBe(1)
  await expect(page.getByRole('alert')).toContainText('Your draft was not saved')
  await expect(outcome).toHaveValue('My unsaved version-one outcome')
})
