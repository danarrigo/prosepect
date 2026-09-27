import { expect, test, type Page } from '@playwright/test'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

async function remoteCalendar(page: Page) {
  let title = 'Before Google edit'
  let requests = 0
  let fail = false
  let removed = false
  let taskRemoved = false
  let pending: Promise<void> | null = null
  const writes: string[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    if (request.method() !== 'GET') writes.push(path)
    let body: unknown = { items: [] }
    if (path === '/session')
      body = {
        csrf_token: 'test-csrf',
        user: { id: 'owner', email: 'owner@example.test', display_name: 'Owner' },
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
    else if (path === '/files/usage')
      body = { used_bytes: 0, max_user_storage_bytes: 1000000, max_file_size_bytes: 1000000 }
    else if (path === '/calendars')
      body = {
        items: [
          {
            id: 'google-calendar',
            name: 'Google personal',
            color: '#64748b',
            source: 'google',
            selected: true,
            is_default: false,
            access_role: 'owner',
            version: 1,
          },
        ],
      }
    else if (path === '/tasks')
      body = {
        items: taskRemoved
          ? []
          : [
              {
                id: 'task',
                project_id: null,
                parent_task_id: null,
                title: 'Scheduled task',
                description: '',
                due_at: null,
                scheduled_start: '2026-09-13T11:00:00Z',
                scheduled_end: '2026-09-13T12:00:00Z',
                status: 'todo',
                priority: 'medium',
                recurrence: 'none',
                labels: [],
                remind_at: null,
                completed_at: null,
                position: 1024,
                version: 1,
              },
            ],
      }
    else if (path === '/events') {
      requests += 1
      if (fail) {
        await route.fulfill({
          status: 503,
          json: { error: { code: 'unavailable', message: 'Synthetic outage' } },
        })
        return
      }
      body = {
        items: removed
          ? []
          : [
              {
                id: 'remote-event',
                calendar_id: 'google-calendar',
                linked_task_id: null,
                title,
                description: '',
                starts_at:
                  title === 'Before Google edit'
                    ? '2026-09-13T09:00:00.000Z'
                    : '2026-09-13T10:00:00.000Z',
                ends_at:
                  title === 'Before Google edit'
                    ? '2026-09-13T10:00:00.000Z'
                    : '2026-09-13T11:00:00.000Z',
                all_day: false,
                timezone: 'UTC',
                location: '',
                attendees: [],
                recurrence: 'none',
                recurrence_until: null,
                version: title === 'Before Google edit' ? 1 : 2,
                created_at: '2026-09-01T00:00:00Z',
                updated_at: '2026-09-13T00:00:00Z',
              },
            ],
      }
      if (pending) await pending
    }
    await route.fulfill({ json: body })
  })
  return {
    change: () => {
      title = 'After Google edit'
    },
    remove: () => {
      removed = true
    },
    removeTask: () => {
      taskRemoved = true
    },
    fail: (value: boolean) => {
      fail = value
    },
    requests: () => requests,
    hold: (value: Promise<void> | null) => {
      pending = value
    },
    writes,
  }
}

for (const view of ['day', 'week', 'month', 'agenda']) {
  test(`refreshes server changes in ${view} without reload or sync requests`, async ({
    page,
  }, info) => {
    await page.clock.install()
    const state = await remoteCalendar(page)
    await page.goto(`/calendar?date=2026-09-13&view=${view}`)
    await expect(page.getByText('Before Google edit', { exact: true }).first()).toBeVisible()
    const url = page.url()
    if (view === 'day')
      await page.getByRole('button', { name: /^Edit Before Google edit,/ }).focus()
    state.change()
    await page.clock.fastForward(30_000)
    await expect(page.getByText('After Google edit', { exact: true }).first()).toBeVisible()
    expect(page.url()).toBe(url)
    if (view === 'day')
      await expect(
        page.getByRole('button', { name: /^Edit After Google edit, 10:00/ }),
      ).toBeFocused()
    expect(state.writes).toEqual([])
    await page.screenshot({ path: info.outputPath('refreshed-calendar.png'), fullPage: true })
    state.remove()
    await page.clock.fastForward(30_000)
    await expect(page.getByText('After Google edit', { exact: true })).toHaveCount(0)
  })
}

test('preserves an open event draft and refreshes after cancel', async ({ page }) => {
  await page.clock.install()
  const state = await remoteCalendar(page)
  await page.goto('/calendar?date=2026-09-13&view=day')
  await page
    .getByRole('button', { name: /^Edit Before Google edit,/ })
    .first()
    .click()
  const title = page.getByRole('textbox', { name: 'Title', exact: true })
  await title.fill('My unsaved draft')
  const count = state.requests()
  state.change()
  await page.clock.fastForward(60_000)
  await expect(title).toHaveValue('My unsaved draft')
  expect(state.requests()).toBe(count)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.clock.fastForward(30_000)
  await expect(page.getByText('After Google edit', { exact: true }).first()).toBeVisible()
  expect(state.writes).toEqual([])
})

test('preserves a task editor even after focus leaves its draft', async ({ page }) => {
  await page.clock.install()
  const state = await remoteCalendar(page)
  await page.goto('/calendar?date=2026-09-13&view=month')
  await page.getByRole('button', { name: 'Edit Scheduled task', exact: true }).click()
  const editor = page.getByRole('form', { name: 'Edit Scheduled task', exact: true })
  await editor.getByRole('textbox', { name: 'Task title', exact: true }).fill('Unsaved task draft')
  await page.getByRole('heading', { name: 'Calendar', exact: true }).click()
  const count = state.requests()
  state.change()
  await page.clock.fastForward(30_000)
  await expect(editor.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'Unsaved task draft',
  )
  expect(state.requests()).toBe(count)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.clock.fastForward(30_000)
  await expect(page.getByText('After Google edit', { exact: true }).first()).toBeVisible()
})

test('preserves a subtask draft when its parent disappears remotely', async ({ page }) => {
  await page.clock.install()
  const state = await remoteCalendar(page)
  await page.goto('/calendar?date=2026-09-13&view=month')
  await page.getByRole('button', { name: 'Add subtask to Scheduled task', exact: true }).click()
  const input = page.getByPlaceholder('Subtask title', { exact: true })
  await input.fill('Unsaved subtask')
  state.removeTask()
  await page.clock.fastForward(30_000)
  await expect(input).toHaveValue('Unsaved subtask')
  await expect(input).toBeFocused()
  await page.getByRole('button', { name: 'Cancel adding subtask', exact: true }).click()
  await page.clock.fastForward(30_000)
  await expect(
    page.getByRole('button', { name: 'Add subtask to Scheduled task', exact: true }),
  ).toHaveCount(0)
})

test('does not overlap requests or apply a response after an editor opens', async ({ page }) => {
  await page.clock.install()
  const state = await remoteCalendar(page)
  await page.goto('/calendar?date=2026-09-13&view=day')
  await expect(page.getByText('Before Google edit', { exact: true }).first()).toBeVisible()
  let release!: () => void
  state.hold(
    new Promise<void>((resolve) => {
      release = resolve
    }),
  )
  const count = state.requests()
  state.change()
  await page.clock.fastForward(30_000)
  await expect.poll(state.requests).toBe(count + 1)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(state.requests()).toBe(count + 1)
  await page.getByRole('button', { name: /^Edit Before Google edit,/ }).click()
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Draft during slow request')
  const response = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/events',
  )
  release()
  await response
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    'Draft during slow request',
  )
  await expect(page.getByText('Before Google edit', { exact: true }).first()).toBeVisible()
  state.hold(null)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.clock.fastForward(30_000)
  await expect(page.getByText('After Google edit', { exact: true }).first()).toBeVisible()
})

test('times out a stalled read and retries without overlapping it', async ({ page }) => {
  await page.clock.install()
  const state = await remoteCalendar(page)
  await page.goto('/calendar?date=2026-09-13&view=day')
  await expect(page.getByText('Before Google edit', { exact: true }).first()).toBeVisible()
  let release!: () => void
  state.hold(
    new Promise<void>((resolve) => {
      release = resolve
    }),
  )
  const count = state.requests()
  await page.clock.fastForward(30_000)
  await expect.poll(state.requests).toBe(count + 1)
  // AbortSignal.timeout uses browser-native active time, not the mocked page clock.
  await expect(
    page.getByText('Calendar could not refresh. Showing the last loaded data.'),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Before Google edit', { exact: true }).first()).toBeVisible()
  state.hold(null)
  release()
  state.change()
  await page.clock.fastForward(30_000)
  await expect(page.getByText('After Google edit', { exact: true }).first()).toBeVisible()
  await expect(
    page.getByText('Calendar could not refresh. Showing the last loaded data.'),
  ).toHaveCount(0)
})

test('keeps last data during an outage and recovers automatically', async ({ page }) => {
  await page.clock.install()
  const state = await remoteCalendar(page)
  await page.goto('/calendar?date=2026-09-13&view=day')
  await expect(page.getByText('Before Google edit', { exact: true }).first()).toBeVisible()
  state.fail(true)
  await page.clock.fastForward(30_000)
  await expect(
    page.getByText('Calendar could not refresh. Showing the last loaded data.'),
  ).toBeVisible()
  await expect(page.getByText('Before Google edit', { exact: true }).first()).toBeVisible()
  state.fail(false)
  state.change()
  await page.clock.fastForward(30_000)
  await expect(page.getByText('After Google edit', { exact: true }).first()).toBeVisible()
  await expect(
    page.getByText('Calendar could not refresh. Showing the last loaded data.'),
  ).toHaveCount(0)
})

test('stops reads when hidden or away and refreshes on return', async ({ page }) => {
  await page.clock.install()
  const state = await remoteCalendar(page)
  await page.goto('/calendar?date=2026-09-13&view=day')
  await expect(page.getByText('Before Google edit', { exact: true }).first()).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const count = state.requests()
  state.change()
  await page.clock.fastForward(60_000)
  expect(state.requests()).toBe(count)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText('After Google edit', { exact: true }).first()).toBeVisible()
  const navigation = page.getByRole('button', { name: 'Open navigation', exact: true })
  if (await navigation.isVisible()) await navigation.click()
  await page.getByRole('link', { name: 'Notes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible()
  const away = state.requests()
  await page.clock.fastForward(60_000)
  expect(state.requests()).toBe(away)
})
