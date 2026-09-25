import { expect, test, type Page } from '@playwright/test'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

async function mockMoves(page: Page) {
  const originalStart = '2026-09-13T09:00:00.000Z'
  const originalEnd = '2026-09-13T10:00:00.000Z'
  const event = {
    id: 'event-1',
    calendar_id: 'calendar-1',
    linked_task_id: null,
    title: 'Planning session',
    description: 'Keep these notes',
    starts_at: originalStart,
    ends_at: originalEnd,
    all_day: false,
    timezone: 'UTC',
    location: '',
    attendees: [],
    recurrence: 'none',
    recurrence_until: null,
    version: 1,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
  }
  const task = {
    id: 'task-1',
    project_id: null,
    parent_task_id: null,
    title: 'Scheduled work',
    description: '',
    due_at: null,
    scheduled_start: '2026-09-13T11:00:00.000Z',
    scheduled_end: '2026-09-13T12:00:00.000Z',
    status: 'todo',
    priority: 'medium',
    recurrence: 'none',
    labels: [],
    remind_at: null,
    completed_at: null,
    position: 1024,
    created_at: event.created_at,
    updated_at: event.updated_at,
    version: 1,
  }
  const receipts: { id: string; event_id: string; task_id: string | null; expires_at: string }[] =
    []
  const inverses = new Map<
    string,
    { start: string; end: string; version: number; isTask: boolean }
  >()
  const requests: string[] = []
  let failure = false
  let moveFailure = false
  let pending: Promise<void> | null = null
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    const method = route.request().method()
    requests.push(`${method} ${path}`)
    let body: unknown = { items: [] }
    if (path === '/session')
      body = {
        csrf_token: 'mock-csrf',
        user: { id: 'user-1', email: 'me@example.test', display_name: 'Planner' },
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
      body = { used_bytes: 0, max_user_storage_bytes: 1073741824, max_file_size_bytes: 10485760 }
    else if (path === '/tasks') body = { items: [task] }
    else if (path === '/events') body = { items: [event] }
    else if (path === '/calendars')
      body = {
        items: [
          {
            id: 'calendar-1',
            name: 'Personal',
            color: '#64748b',
            source: 'native',
            selected: true,
            is_default: true,
            version: 1,
          },
        ],
      }
    else if (path === '/calendar-move-undos')
      body = {
        items: receipts
          .filter((receipt) => Date.parse(receipt.expires_at) > Date.now())
          .toReversed(),
      }
    else if (path.endsWith('/move') && method === 'POST') {
      const input = route.request().postDataJSON()
      const isTask = path.startsWith('/tasks/')
      const item = isTask ? task : event
      if (moveFailure || input.expected_version !== item.version) {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'conflict', message: 'Calendar item changed.' } },
        })
        return
      }
      const receipt = {
        id: `receipt-${receipts.length + 1}`,
        event_id: isTask ? 'mirror-1' : event.id,
        task_id: isTask ? task.id : null,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      }
      inverses.set(receipt.id, {
        start: isTask ? task.scheduled_start : event.starts_at,
        end: isTask ? task.scheduled_end : event.ends_at,
        version: item.version + 1,
        isTask,
      })
      if (isTask)
        Object.assign(task, {
          scheduled_start: input.starts_at,
          scheduled_end: input.ends_at,
          version: task.version + 1,
        })
      else
        Object.assign(event, {
          starts_at: input.starts_at,
          ends_at: input.ends_at,
          version: event.version + 1,
        })
      receipts.push(receipt)
      body = receipt
    } else if (path.endsWith('/consume') && method === 'POST') {
      if (pending) await pending
      const id = path.split('/')[2]!
      const inverse = inverses.get(id)
      const receipt = receipts.find((receipt) => receipt.id === id)
      if (
        failure ||
        !inverse ||
        !receipt ||
        Date.parse(receipt.expires_at) <= Date.now() ||
        inverse.version !== (inverse.isTask ? task.version : event.version)
      ) {
        await route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'conflict',
              message: 'Calendar item changed. Undo cannot overwrite a later change.',
            },
          },
        })
        return
      }
      if (inverse.isTask)
        Object.assign(task, {
          scheduled_start: inverse.start,
          scheduled_end: inverse.end,
          version: task.version + 1,
        })
      else
        Object.assign(event, {
          starts_at: inverse.start,
          ends_at: inverse.end,
          version: event.version + 1,
        })
      receipts.splice(receipts.indexOf(receipt), 1)
      inverses.delete(id)
      await route.fulfill({ status: 204 })
      return
    }
    await route.fulfill({ json: body })
  })
  return {
    event,
    task,
    receipts,
    requests,
    failMove: () => {
      moveFailure = true
    },
    fail: () => {
      failure = true
    },
    hold: (value: Promise<void>) => {
      pending = value
    },
  }
}

async function moveWithKeyboard(page: Page, title: string, key = 'Alt+ArrowDown') {
  const item = page.getByRole('button', { name: new RegExp(`^(Edit )?${title},`) }).first()
  await item.focus()
  await page.keyboard.press(key)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`gesture move can be undone after navigation and reload with the same identity in ${colorScheme}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    if (testInfo.project.use.isMobile) await page.setViewportSize({ width: 320, height: 800 })
    const state = await mockMoves(page)
    await page.goto('/calendar?date=2026-09-13&view=day')
    await moveWithKeyboard(page, 'Planning session')
    const feedback = page.getByRole('region', { name: 'Calendar move Undo' })
    await expect(feedback.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
    expect(state.event.starts_at).toBe('2026-09-13T09:15:00.000Z')
    const bounds = await feedback.evaluate((element) => {
      const region = element.getBoundingClientRect()
      return {
        left: region.left,
        right: region.right,
        viewport: document.documentElement.clientWidth,
        width: element.clientWidth,
        contentWidth: element.scrollWidth,
      }
    })
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewport)
    expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width)
    await page.screenshot({ path: testInfo.outputPath('undo-calendar.png'), fullPage: true })
    await page.goto('/projects')
    await page.reload()
    await expect(feedback.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('undo-after-reload.png'), fullPage: true })
    const undo = feedback.getByRole('button', { name: 'Undo', exact: true })
    if (testInfo.project.use.isMobile) await undo.tap()
    else {
      await undo.focus()
      await page.keyboard.press('Enter')
    }
    await expect(feedback).toContainText('Move undone')
    expect(state.event).toMatchObject({
      id: 'event-1',
      starts_at: '2026-09-13T09:00:00.000Z',
      version: 3,
      description: 'Keep these notes',
    })
    await page.screenshot({ path: testInfo.outputPath('undo-success.png'), fullPage: true })
  })
}

test('scheduled task resize has pending and conflict feedback without overwriting later changes', async ({
  page,
}) => {
  const state = await mockMoves(page)
  await page.goto('/calendar?date=2026-09-13&view=day')
  await moveWithKeyboard(page, 'Scheduled work', 'Shift+ArrowDown')
  const feedback = page.getByRole('region', { name: 'Calendar move Undo' })
  await expect(feedback.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  expect(state.task.scheduled_end).toBe('2026-09-13T12:15:00.000Z')
  let release!: () => void
  state.hold(
    new Promise<void>((resolve) => {
      release = resolve
    }),
  )
  state.fail()
  await feedback.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(feedback.getByRole('button', { name: 'Undoing…' })).toBeDisabled()
  release()
  await expect(feedback).toContainText('cannot overwrite a later change')
  expect(state.task.scheduled_end).toBe('2026-09-13T12:15:00.000Z')
})

test('expiry is explicit and text-field Ctrl+Z stays native', async ({ page }) => {
  await page.clock.install()
  await mockMoves(page)
  await page.goto('/calendar?date=2026-09-13&view=day')
  await moveWithKeyboard(page, 'Planning session')
  const feedback = page.getByRole('region', { name: 'Calendar move Undo' })
  await expect(feedback.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  await page.clock.fastForward(61000)
  await expect(feedback).toContainText('Undo expired')
  await expect(feedback.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: /^Edit Planning session,/ }).click()
  const search = page
    .getByRole('dialog', { name: 'Edit event' })
    .getByRole('textbox', { name: 'Title', exact: true })
  await search.fill('Planning')
  await search.press('End')
  await search.pressSequentially(' extra')
  await search.press('Control+z')
  await expect(search).toHaveValue('Planning')
})

for (const title of ['Planning session', 'Scheduled work']) {
  for (const gesture of ['move', 'resize start', 'resize end'] as const) {
    test(`pointer ${gesture} ${title} uses server Undo`, async ({ page }) => {
      const state = await mockMoves(page)
      await page.goto('/calendar?date=2026-09-13&view=day')
      const item = page.getByRole('button', { name: new RegExp(`^(Edit )?${title},`) })
      await item.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      const target =
        gesture === 'move'
          ? item
          : item.getByTitle(
              gesture === 'resize start' ? 'Drag top edge to trim' : 'Drag bottom edge to resize',
            )
      const box = (await target.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 24, { steps: 4 })
      await page.mouse.up()
      const feedback = page.getByRole('region', { name: 'Calendar move Undo' })
      await expect(feedback).toContainText('Calendar move saved')
      expect(state.requests.filter((request) => request.endsWith('/move'))).toEqual([
        `POST /${title === 'Planning session' ? 'events/event-1' : 'tasks/task-1'}/move`,
      ])
      expect(state.event.version + state.task.version).toBe(3)
      await feedback.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(feedback).toContainText('Move undone')
      expect(state.event.starts_at).toBe('2026-09-13T09:00:00.000Z')
      expect(state.event.ends_at).toBe('2026-09-13T10:00:00.000Z')
      expect(state.task.scheduled_start).toBe('2026-09-13T11:00:00.000Z')
      expect(state.task.scheduled_end).toBe('2026-09-13T12:00:00.000Z')
    })
  }
}

for (const cancel of ['Escape', 'pointercancel'] as const) {
  test(`${cancel} cancels move and resize without mutation or Undo`, async ({ page }) => {
    const state = await mockMoves(page)
    await page.goto('/calendar?date=2026-09-13&view=day')
    for (const resize of [false, true]) {
      const item = page.getByRole('button', { name: /^Edit Planning session,/ })
      await item.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      const box = (await (
        resize ? item.getByTitle('Drag bottom edge to resize') : item
      ).boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 24, { steps: 4 })
      if (cancel === 'Escape') await page.keyboard.press('Escape')
      else await page.dispatchEvent('body', 'pointercancel')
      await page.mouse.up()
    }
    expect(state.requests.filter((request) => request.endsWith('/move'))).toEqual([])
    await expect(page.getByRole('region', { name: 'Calendar move Undo' })).toBeHidden()
  })
}

test('a failed keyboard move never announces success or shows Undo', async ({ page }) => {
  const state = await mockMoves(page)
  state.failMove()
  await page.goto('/calendar?date=2026-09-13&view=day')
  await moveWithKeyboard(page, 'Planning session')
  const feedback = page.getByRole('region', { name: 'Calendar move Undo' })
  await expect(feedback.getByRole('alert')).toContainText('Calendar item changed')
  await expect(feedback.getByRole('button', { name: 'Undo', exact: true })).toBeHidden()
  expect(state.event.starts_at).toBe('2026-09-13T09:00:00.000Z')
  await expect(
    page.getByRole('status').filter({ hasText: /moved to|Calendar move saved/ }),
  ).toHaveCount(0)
})

for (const view of ['month', 'week']) {
  test(`${view} all-day drag preserves UTC dates and is undoable`, async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.use.isMobile === true && view === 'month',
      'Month drag sources are intentionally hidden on small screens',
    )
    const state = await mockMoves(page)
    state.event.all_day = true
    state.event.starts_at = '2026-09-13T00:00:00.000Z'
    state.event.ends_at = '2026-09-15T00:00:00.000Z'
    state.event.timezone = 'America/Los_Angeles'
    await page.goto(`/calendar?date=2026-09-13&view=${view}`)
    const source = page
      .locator('[draggable="true"]')
      .filter({ hasText: 'Planning session' })
      .first()
    const target =
      view === 'month'
        ? page.getByRole('button', { name: /Monday, September 14, 2026/ })
        : page.getByRole('button', { name: 'Sat 12', exact: true }).locator('..')
    await source.dragTo(target)
    const feedback = page.getByRole('region', { name: 'Calendar move Undo' })
    await expect(feedback).toContainText('Calendar move saved')
    expect(state.event.starts_at).toBe(`2026-09-${view === 'month' ? '14' : '12'}T00:00:00.000Z`)
    await feedback.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(feedback).toContainText('Move undone')
    expect(state.event.starts_at).toBe('2026-09-13T00:00:00.000Z')
    expect(state.event.ends_at).toBe('2026-09-15T00:00:00.000Z')
  })
}

for (const action of ['Undo', 'Dismiss calendar move feedback']) {
  test(`keyboard ${action} retains a meaningful focus destination`, async ({ page }, testInfo) => {
    await mockMoves(page)
    await page.goto('/calendar?date=2026-09-13&view=day')
    await moveWithKeyboard(page, 'Planning session')
    const feedback = page.getByRole('region', { name: 'Calendar move Undo' })
    const button = feedback.getByRole('button', { name: action, exact: true })
    await expect(button).toBeEnabled()
    await button.focus()
    await page.keyboard.press('Enter')
    if (action === 'Undo') await expect(feedback).toContainText('Move undone')
    else await expect(feedback).toBeHidden()
    await page.screenshot({ path: testInfo.outputPath('keyboard-focus.png'), fullPage: true })
    await testInfo.attach('active-element.txt', {
      body: await page.evaluate(() => document.activeElement?.outerHTML ?? 'none'),
      contentType: 'text/plain',
    })
    await expect(action === 'Undo' ? feedback : page.locator('#workspace-content')).toBeFocused()
  })
}

for (const navigate of [false, true]) {
  test(`late Undo response does not steal focus after ${navigate ? 'navigation' : 'focus moves away'}`, async ({
    page,
  }) => {
    const state = await mockMoves(page)
    await page.goto('/calendar?date=2026-09-13&view=day')
    await moveWithKeyboard(page, 'Planning session')
    let release!: () => void
    state.hold(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const feedback = page.getByRole('region', { name: 'Calendar move Undo' })
    const undo = feedback.getByRole('button', { name: 'Undo', exact: true })
    await expect(undo).toBeEnabled()
    await undo.focus()
    await page.keyboard.press('Enter')
    await expect(feedback).toContainText('Undoing')
    if (navigate) {
      // Use same-document navigation, retaining the pending component and request.
      await page
        .locator('a[href="/projects"]')
        .first()
        .evaluate((link) => (link as HTMLElement).click())
      await expect(page).toHaveURL(/\/projects$/)
    }
    const destination = navigate
      ? page.locator('#workspace-content')
      : page.getByRole('button', { name: 'New event', exact: true })
    await destination.focus()
    release()
    await expect(feedback).toContainText('Move undone')
    await expect(destination).toBeFocused()
  })
}
