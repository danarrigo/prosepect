import { expect, test, type Page } from '@playwright/test'

test.use({ timezoneId: 'UTC', locale: 'en-US' })

async function mockMoves(page: Page) {
  const originalStart = '2026-09-13T09:00:00.000Z'
  const originalEnd = '2026-09-13T10:00:00.000Z'
  const event = {
    id: 'event-1', calendar_id: 'calendar-1', linked_task_id: null,
    title: 'Planning session', description: 'Keep these notes', starts_at: originalStart,
    ends_at: originalEnd, all_day: false, timezone: 'UTC', location: '', attendees: [],
    recurrence: 'none', recurrence_until: null, version: 1,
    created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z',
  }
  const task = {
    id: 'task-1', project_id: null, parent_task_id: null, title: 'Scheduled work', description: '',
    due_at: null, scheduled_start: '2026-09-13T11:00:00.000Z', scheduled_end: '2026-09-13T12:00:00.000Z',
    status: 'todo', priority: 'medium', recurrence: 'none', labels: [], remind_at: null,
    completed_at: null, position: 1024, created_at: event.created_at, updated_at: event.updated_at, version: 1,
  }
  const receipts: { id: string; event_id: string; task_id: string | null; expires_at: string }[] = []
  const inverses = new Map<string, { start: string; end: string; version: number; isTask: boolean }>()
  const requests: string[] = []
  let failure = false
  let pending: Promise<void> | null = null
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    const method = route.request().method()
    requests.push(`${method} ${path}`)
    let body: unknown = { items: [] }
    if (path === '/session') body = { csrf_token: 'mock-csrf', user: { id: 'user-1', email: 'me@example.test', display_name: 'Planner' } }
    else if (path === '/settings') body = { theme: 'system', automatic_daily_review: false, sidebar_visible: true, sync_conflict_policy: 'ask', version: 1 }
    else if (path.startsWith('/daily-plans/')) body = { focus_task_ids: [], focus_tasks: [] }
    else if (path === '/files/usage') body = { used_bytes: 0, max_user_storage_bytes: 1073741824, max_file_size_bytes: 10485760 }
    else if (path === '/tasks') body = { items: [task] }
    else if (path === '/events') body = { items: [event] }
    else if (path === '/calendars') body = { items: [{ id: 'calendar-1', name: 'Personal', color: '#64748b', source: 'native', selected: true, is_default: true, version: 1 }] }
    else if (path === '/calendar-move-undos') body = { items: receipts.filter((receipt) => Date.parse(receipt.expires_at) > Date.now()).toReversed() }
    else if (path.endsWith('/move') && method === 'POST') {
      const input = route.request().postDataJSON()
      const isTask = path.startsWith('/tasks/')
      const item = isTask ? task : event
      if (input.expected_version !== item.version) {
        await route.fulfill({ status: 409, json: { error: { code: 'conflict', message: 'Calendar item changed.' } } }); return
      }
      const receipt = { id: `receipt-${receipts.length + 1}`, event_id: isTask ? 'mirror-1' : event.id, task_id: isTask ? task.id : null, expires_at: new Date(Date.now() + 60000).toISOString() }
      inverses.set(receipt.id, { start: isTask ? task.scheduled_start : event.starts_at, end: isTask ? task.scheduled_end : event.ends_at, version: item.version + 1, isTask })
      if (isTask) Object.assign(task, { scheduled_start: input.starts_at, scheduled_end: input.ends_at, version: task.version + 1 })
      else Object.assign(event, { starts_at: input.starts_at, ends_at: input.ends_at, version: event.version + 1 })
      receipts.push(receipt); body = receipt
    } else if (path.endsWith('/consume') && method === 'POST') {
      if (pending) await pending
      const id = path.split('/')[2]!
      const inverse = inverses.get(id)
      const receipt = receipts.find((receipt) => receipt.id === id)
      if (failure || !inverse || !receipt || Date.parse(receipt.expires_at) <= Date.now() || inverse.version !== (inverse.isTask ? task.version : event.version)) {
        await route.fulfill({ status: 409, json: { error: { code: 'conflict', message: 'Calendar item changed. Undo cannot overwrite a later change.' } } }); return
      }
      if (inverse.isTask) Object.assign(task, { scheduled_start: inverse.start, scheduled_end: inverse.end, version: task.version + 1 })
      else Object.assign(event, { starts_at: inverse.start, ends_at: inverse.end, version: event.version + 1 })
      receipts.splice(receipts.indexOf(receipt), 1); inverses.delete(id)
      await route.fulfill({ status: 204 }); return
    }
    await route.fulfill({ json: body })
  })
  return { event, task, receipts, requests, fail: () => { failure = true }, hold: (value: Promise<void>) => { pending = value } }
}

async function moveWithKeyboard(page: Page, title: string, key = 'Alt+ArrowDown') {
  const item = page.getByRole('button', { name: new RegExp(`^(Edit )?${title},`) }).first()
  await item.focus()
  await page.keyboard.press(key)
}

test('gesture move can be undone after navigation and reload with the same identity', async ({ page }, testInfo) => {
  const state = await mockMoves(page)
  await page.goto('/calendar?date=2026-09-13&view=day')
  await moveWithKeyboard(page, 'Planning session')
  const feedback = page.getByRole('region', { name: 'Calendar move Undo' })
  await expect(feedback.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  expect(state.event.starts_at).toBe('2026-09-13T09:15:00.000Z')
  await page.goto('/projects')
  await page.reload()
  await expect(feedback.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('undo-after-reload.png'), fullPage: true })
  const undo = feedback.getByRole('button', { name: 'Undo', exact: true })
  if (testInfo.project.use.isMobile) await undo.tap()
  else { await undo.focus(); await page.keyboard.press('Enter') }
  await expect(feedback).toContainText('Move undone')
  expect(state.event).toMatchObject({ id: 'event-1', starts_at: '2026-09-13T09:00:00.000Z', version: 3, description: 'Keep these notes' })
  await page.screenshot({ path: testInfo.outputPath('undo-success.png'), fullPage: true })
})

test('scheduled task resize has pending and conflict feedback without overwriting later changes', async ({ page }) => {
  const state = await mockMoves(page)
  await page.goto('/calendar?date=2026-09-13&view=day')
  await moveWithKeyboard(page, 'Scheduled work', 'Shift+ArrowDown')
  const feedback = page.getByRole('region', { name: 'Calendar move Undo' })
  await expect(feedback.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  expect(state.task.scheduled_end).toBe('2026-09-13T12:15:00.000Z')
  let release!: () => void
  state.hold(new Promise<void>((resolve) => { release = resolve }))
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
  const search = page.getByRole('searchbox').first()
  await search.fill('Planning')
  await search.press('End')
  await search.pressSequentially(' extra')
  await search.press('Control+z')
  await expect(search).toHaveValue('Planning')
})
