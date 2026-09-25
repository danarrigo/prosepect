import { expect, test, type Page } from '@playwright/test'

const scheduledTitle =
  'Prepare the quarterly planning review with the product and engineering teams'
const deadlineTitle = 'Send the final budget proposal and supporting documents to the finance team'

async function mockWorkspace(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-13T08:00:00Z'))
  const base = {
    project_id: null,
    parent_task_id: null,
    description: '',
    status: 'todo',
    priority: 'medium',
    recurrence: 'none',
    labels: [],
    remind_at: null,
    completed_at: null,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
    version: 1,
  }
  const tasks = [
    {
      ...base,
      id: 'scheduled',
      title: scheduledTitle,
      position: 1024,
      due_at: null,
      scheduled_start: '2026-09-01T09:00:00Z',
      scheduled_end: '2026-09-01T10:30:00Z',
    },
    {
      ...base,
      id: 'deadline',
      title: deadlineTitle,
      position: 2048,
      due_at: '2026-09-01T17:00:00Z',
      scheduled_start: null,
      scheduled_end: null,
      status: 'blocked',
      priority: 'high',
      labels: ['finance'],
    },
  ]
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
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
    else if (path === '/tasks') body = { items: tasks }
    else if (path === '/tasks/scheduled/move' && route.request().method() === 'POST') {
      const task = tasks.find((task) => task.id === 'scheduled')!
      const input = route.request().postDataJSON()
      expect(input).toEqual({
        starts_at: '2026-09-01T09:15:00.000Z',
        ends_at: '2026-09-01T10:45:00.000Z',
        expected_version: task.version,
      })
      Object.assign(task, {
        scheduled_start: input.starts_at,
        scheduled_end: input.ends_at,
        version: task.version + 1,
      })
      body = {
        id: 'move-receipt',
        event_id: 'scheduled-mirror',
        task_id: task.id,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }
    } else if (path.startsWith('/tasks/') && route.request().method() === 'PUT') {
      const task = tasks.find((task) => task.id === path.split('/').at(-1))!
      Object.assign(task, route.request().postDataJSON(), { version: task.version + 1 })
      body = task
    } else if (path === '/calendars')
      body = {
        items: [
          {
            id: 'calendar-1',
            name: 'Personal',
            source: 'native',
            color: '#64748b',
            selected: true,
            is_default: true,
            version: 1,
          },
        ],
      }
    await route.fulfill({ json: body })
  })
  return tasks
}

test.use({ timezoneId: 'UTC', locale: 'en-US' })

for (const colorScheme of ['light', 'dark'] as const) {
  test(`selected-day task layout and hover in ${colorScheme}`, async ({ page }, testInfo) => {
    if (!testInfo.project.use.isMobile) await page.setViewportSize({ width: 1600, height: 1000 })
    await page.emulateMedia({ colorScheme })
    await mockWorkspace(page)
    await page.goto('/calendar?date=2026-09-02&view=month')
    await page
      .getByRole('button', { name: /Tuesday, September 1, 2026, 0 events, 2 tasks/ })
      .click()
    const row = page.locator('[data-task-id="scheduled"]')
    await expect(row).toBeVisible()
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('selected-day.png'), fullPage: true })
    await row.hover()
    await page.screenshot({ path: testInfo.outputPath('selected-day-hover.png'), fullPage: true })
    const measurements = await row.evaluate((element) => {
      const title = element.querySelector('p')!
      return {
        rowWidth: element.getBoundingClientRect().width,
        titleWidth: title.getBoundingClientRect().width,
        controls: [...element.querySelectorAll('button, select, [title]')].map((control) => ({
          tag: control.tagName,
          label: control.getAttribute('aria-label'),
          title: control.getAttribute('title'),
          text:
            control instanceof HTMLSelectElement
              ? control.selectedOptions[0]?.text
              : control.textContent,
          width: control.getBoundingClientRect().width,
          opacity: getComputedStyle(control).opacity,
        })),
      }
    })
    console.log(JSON.stringify({ colorScheme, project: testInfo.project.name, measurements }))
    await testInfo.attach('rendered-dom.json', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    })
    // The task title must retain a readable majority of this narrow panel, including on hover.
    expect.soft(measurements.titleWidth).toBeGreaterThan(measurements.rowWidth / 2)
    // Narrow rows keep status editing in the labeled editor, not a hover-only value beside the title.
    await expect
      .soft(row.getByRole('combobox', { name: `Status for ${scheduledTitle}` }))
      .toBeHidden()
  })
}

async function expectContained(page: Page, selector: string) {
  const overflow = await page.locator(selector).evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return [...element.querySelectorAll('p, button, input:not(.sr-only), select, textarea')]
      .filter((child) => child.getBoundingClientRect().width > 0)
      .filter((child) => {
        const rect = child.getBoundingClientRect()
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1
      })
      .map((child) => child.getAttribute('aria-label') ?? child.textContent)
  })
  expect(overflow).toEqual([])
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`selected-day editing and completion remain accessible in ${colorScheme}`, async ({
    page,
  }, testInfo) => {
    if (!testInfo.project.use.isMobile) await page.setViewportSize({ width: 1600, height: 1000 })
    await page.emulateMedia({ colorScheme })
    const tasks = await mockWorkspace(page)
    await page.goto('/calendar?date=2026-09-01&view=month')
    const row = page.locator('[data-task-id="scheduled"]')
    const deadline = page.locator('[data-task-id="deadline"]')
    await expect(row).toContainText(scheduledTitle)
    await expect(deadline).toContainText('Blocked')
    await expect(deadline).toContainText('Sep 1')
    for (const target of [
      row.locator('p').first(),
      ...['Complete', 'Add subtask to', 'Edit'].map((action) =>
        row.getByRole('button', { name: `${action} ${scheduledTitle}`, exact: true }),
      ),
    ]) {
      if (!testInfo.project.use.isMobile) await target.hover()
      await expectContained(page, '[data-task-id="scheduled"]')
      expect((await target.getAttribute('title')) ?? '').not.toMatch(/^(todo|To do|in_progress)$/)
    }
    const edit = row.getByRole('button', { name: `Edit ${scheduledTitle}`, exact: true })
    if (testInfo.project.use.isMobile) await edit.tap()
    else {
      await edit.focus()
      await page.keyboard.press('Enter')
    }
    const form = row.getByRole('form', { name: `Edit ${scheduledTitle}` })
    await expect(form.getByLabel('Edit status')).toHaveValue('todo')
    await expect(form).not.toContainText(/\((optional|required[^)]*)\)/)
    await expectContained(page, '[data-task-id="scheduled"]')
    await form
      .getByLabel('Task title')
      .evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: testInfo.outputPath('selected-day-editor-top.png') })
    await form.getByRole('button', { name: 'Save', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('selected-day-editor-actions.png') })
    await form.getByLabel('Task title').fill(`${scheduledTitle} at 3pm`)
    await form.getByLabel('Edit status').selectOption('in_progress')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(form).toBeHidden()
    expect(tasks[0]).toMatchObject({
      title: `${scheduledTitle} at 3pm`,
      status: 'in_progress',
      due_at: null,
      scheduled_start: '2026-09-01T09:00:00Z',
      scheduled_end: '2026-09-01T10:30:00Z',
    })
    const complete = row.getByRole('button', {
      name: `Complete ${scheduledTitle} at 3pm`,
      exact: true,
    })
    if (testInfo.project.use.isMobile) await complete.tap()
    else {
      await complete.focus()
      await page.keyboard.press('Space')
    }
    await expect(
      row.getByRole('button', { name: `Mark ${scheduledTitle} at 3pm incomplete` }),
    ).toBeVisible()
    await row.getByRole('button', { name: `Mark ${scheduledTitle} at 3pm incomplete` }).click()
    await expect.poll(() => tasks[0]?.status).toBe('todo')
    await deadline.getByRole('button', { name: `Edit ${deadlineTitle}`, exact: true }).click()
    await deadline.getByLabel('Edit status').selectOption('in_progress')
    await deadline.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(deadline.getByRole('form')).toBeHidden()
    expect(tasks[1]).toMatchObject({
      due_at: '2026-09-01T17:00:00Z',
      scheduled_start: null,
      scheduled_end: null,
    })
    await row
      .locator('..')
      .locator('..')
      .screenshot({ path: testInfo.outputPath('selected-day-panel.png') })
  })
}

test('day and week keep scheduled work separate from deadline-only tasks', async ({
  page,
}, testInfo) => {
  const tasks = await mockWorkspace(page)
  await page.goto('/calendar?date=2026-09-01&view=day')
  const block = page.getByRole('button', {
    name: `${scheduledTitle}, scheduled task, 09:00–10:30. Drag to move. Alt plus arrow keys move; Shift plus arrow keys resize.`,
  })
  await block.scrollIntoViewIfNeeded()
  await expect(block).toContainText('09:00–10:30')
  await expect(page.locator('[data-task-id="deadline"]')).toBeVisible()
  await expect(page.locator('[data-task-id="scheduled"]')).toHaveCount(0)
  if (!testInfo.project.use.isMobile) {
    await block.hover()
    await block.focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(() => tasks[0]?.scheduled_start).toBe('2026-09-01T09:15:00.000Z')
  }
  await page.screenshot({ path: testInfo.outputPath('day.png') })
  await page.getByRole('button', { name: 'week', exact: true }).click()
  await expect(page.getByText(scheduledTitle, { exact: true })).toBeVisible()
  await expect(page.getByText(deadlineTitle, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('week.png') })
})

test('week columns contain long titles without widening the page', async ({ page }, testInfo) => {
  await mockWorkspace(page)
  await page.goto('/calendar?date=2026-09-01&view=week')
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const title = page.getByText(scheduledTitle, { exact: true })
    await expect(title).toBeVisible()
    await title.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`week-${width}.png`) })
    const bounds = await title.evaluate((element) => ({
      right: element.getBoundingClientRect().right,
      viewport: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
    }))
    expect.soft(bounds.right).toBeLessThanOrEqual(bounds.viewport)
    expect.soft(bounds.pageWidth).toBeLessThanOrEqual(bounds.viewport)
  }
})

test('wide shared task rows retain hover status and keyboard editing', async ({
  page,
}, testInfo) => {
  test.skip(
    Boolean(testInfo.project.use.isMobile),
    'Wide desktop controls; touch editor covered in selected-day tests',
  )
  await page.setViewportSize({ width: 1600, height: 1000 })
  const tasks = await mockWorkspace(page)
  await page.goto('/calendar?date=2026-09-01&view=day')
  const row = page.locator('[data-task-id="deadline"]')
  await row.hover()
  const status = row.getByRole('combobox', { name: `Status for ${deadlineTitle}` })
  await expect(status).toBeVisible()
  await expect(status).toHaveAttribute('title', 'Change task status')
  await status.focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await expect.poll(() => tasks[1]?.status).toBe('todo')
  await expectContained(page, '[data-task-id="deadline"]')
})

test('selected-day rows fit on either side of the desktop breakpoint', async ({
  page,
}, testInfo) => {
  test.skip(
    Boolean(testInfo.project.use.isMobile),
    'Desktop resize matrix; Pixel touch tests cover mobile',
  )
  await mockWorkspace(page)
  await page.goto('/calendar?date=2026-09-01&view=month')
  for (const width of [1024, 1280, 1535, 1536, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    const row = page.locator('[data-task-id="scheduled"]')
    await row.hover()
    await expect(row.getByRole('combobox')).toBeHidden()
    await expectContained(page, '[data-task-id="scheduled"]')
    expect(
      await row
        .locator('p')
        .first()
        .evaluate((element) => element.getBoundingClientRect().width),
    ).toBeGreaterThan(160)
  }
})
