import { expect, test, type Page } from '@playwright/test'

const eventTitle = 'Quarterly product planning with engineering and customer success teams'
const scheduledTitle = 'Prepare launch checklist and collect final reviews from all stakeholders'
const deadlineTitle = 'Send approved budget and supporting documentation to finance'
const allDayTitle = 'Team offsite across three days'

async function mockCalendar(page: Page, populated = true) {
  await page.clock.setFixedTime(new Date('2026-09-01T08:00:00Z'))
  const taskBase = {
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
  const tasks = populated
    ? [
        {
          ...taskBase,
          id: 'scheduled',
          title: scheduledTitle,
          position: 1024,
          due_at: null,
          scheduled_start: '2026-09-01T09:00:12.000Z',
          scheduled_end: '2026-09-01T10:30:34.000Z',
          status: 'in_progress',
          labels: ['launch', 'cross-functional'],
        },
        {
          ...taskBase,
          id: 'deadline',
          title: deadlineTitle,
          position: 2048,
          due_at: '2026-09-01T17:00:12.000Z',
          scheduled_start: null,
          scheduled_end: null,
          status: 'blocked',
          priority: 'high',
          labels: ['finance', 'approval'],
        },
      ]
    : []
  const eventBase = {
    calendar_id: 'calendar-1',
    description: 'Bring planning notes.',
    timezone: 'UTC',
    location: 'Meeting room',
    attendees: ['planner@example.test'],
    recurrence: 'none',
    recurrence_until: null,
    linked_task_id: null,
    version: 1,
  }
  const events = populated
    ? [
        {
          ...eventBase,
          id: 'timed',
          title: eventTitle,
          starts_at: '2026-09-01T11:00:12.000Z',
          ends_at: '2026-09-01T12:30:34.000Z',
          all_day: false,
        },
        {
          ...eventBase,
          id: 'overlap',
          title: 'Customer research follow-up',
          starts_at: '2026-09-01T11:30:00Z',
          ends_at: '2026-09-01T12:00:00Z',
          all_day: false,
        },
        {
          ...eventBase,
          id: 'all-day',
          title: allDayTitle,
          starts_at: '2026-09-01T00:00:00.000Z',
          ends_at: '2026-09-04T00:00:00.000Z',
          all_day: true,
        },
      ]
    : []
  const writes: { path: string; payload: Record<string, unknown> }[] = []
  page.on('pageerror', (error) => {
    throw error
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:5173') {
      await route.abort()
      throw new Error(`Unexpected external request: ${url.origin}`)
    }
    if (!url.pathname.startsWith('/api/v1/')) {
      await route.fallback()
      return
    }
    const path = url.pathname.replace('/api/v1', '')
    let body: unknown = { items: [] }
    if (path === '/session')
      body = {
        csrf_token: 'mock-csrf',
        user: { id: 'user-1', email: 'planner@example.test', display_name: 'Planner' },
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
    else if (path === '/calendars')
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
    else if (path === '/tasks') body = { items: tasks }
    else if (path === '/events') body = { items: events }
    else if (route.request().method() === 'DELETE' && path.startsWith('/events/')) {
      const index = events.findIndex((event) => event.id === path.split('/').at(-1))
      events.splice(index, 1)
      await route.fulfill({ status: 204 })
      return
    } else if (route.request().method() === 'PUT' && /^\/(tasks|events)\//.test(path)) {
      const item = [...tasks, ...events].find((item) => item.id === path.split('/').at(-1))!
      const payload = route.request().postDataJSON()
      writes.push({ path, payload })
      Object.assign(item, payload, { version: item.version + 1 })
      body = item
    }
    await route.fulfill({ json: body })
  })
  return { tasks, events, writes }
}

test.use({ timezoneId: 'UTC', locale: 'en-US' })

for (const colorScheme of ['light', 'dark'] as const) {
  for (const populated of [true, false]) {
    test(`calendar matrix ${colorScheme} ${populated ? 'populated' : 'empty'}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000)
      await page.emulateMedia({ colorScheme })
      await mockCalendar(page, populated)
      const widths = testInfo.project.use.isMobile ? [320, 375] : [768, 1280, 1600]
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 })
        for (const view of ['day', 'week', 'month', 'agenda']) {
          await page.goto(`/calendar?date=2026-09-01&view=${view}`)
          await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible()
          if (populated)
            await expect(page.getByText(allDayTitle, { exact: true }).first()).toBeVisible()
          await page.screenshot({
            path: testInfo.outputPath(`${view}-${width}.png`),
            fullPage: true,
          })
          const measurements = await page.evaluate(() => ({
            viewport: innerWidth,
            pageWidth: document.documentElement.scrollWidth,
            outside: [...document.querySelectorAll('main button, main input, main select')]
              .filter((el) => {
                const box = el.getBoundingClientRect()
                return box.width && (box.left < -1 || box.right > innerWidth + 1)
              })
              .map((el) => ({
                label: el.getAttribute('aria-label') ?? el.textContent,
                width: el.getBoundingClientRect().width,
              })),
          }))
          console.log(JSON.stringify({ colorScheme, populated, width, view, ...measurements }))
          expect.soft(measurements.pageWidth).toBeLessThanOrEqual(width)
        }
      }
    })
  }
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`day heading remains readable ${colorScheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    await mockCalendar(page)
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto('/calendar?date=2026-09-01&view=day')
    const heading = page.getByText('Tuesday, September 1', { exact: true })
    await expect(heading).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('day-heading.png'), scale: 'css' })
    const measurements = await heading.evaluate((el) => ({
      width: el.clientWidth,
      content: el.scrollWidth,
      height: el.getBoundingClientRect().height,
    }))
    console.log(JSON.stringify({ colorScheme, dayHeading: measurements }))
    expect(measurements.content).toBeLessThanOrEqual(measurements.width)
  })

  test(`week event titles retain their own readable line ${colorScheme}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    await mockCalendar(page)
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto('/calendar?date=2026-09-01&view=week')
    const event = page.getByRole('button').filter({ hasText: eventTitle })
    await expect(event).toBeVisible()
    await event.hover()
    await page.screenshot({ path: testInfo.outputPath('week-event-hover.png'), scale: 'css' })
    const lines = await event.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const boxes: { text: string; left: number; right: number; top: number; bottom: number }[] = []
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(walker.currentNode)
        const box = range.getBoundingClientRect()
        boxes.push({
          text: walker.currentNode.textContent.trim(),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        })
      }
      return { boxes, width: el.getBoundingClientRect().width }
    })
    console.log(JSON.stringify({ colorScheme, weekEvent: lines }))
    const title = lines.boxes.find((box) => box.text.includes(eventTitle))!
    const time = lines.boxes.find((box) => box.text.includes('11:00'))!
    expect(title.top >= time.bottom || time.top >= title.bottom).toBe(true)
  })

  test(`calendar event editor and calendar menu ${colorScheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    const { events, writes } = await mockCalendar(page)
    await page.setViewportSize({ width: testInfo.project.use.isMobile ? 320 : 1280, height: 900 })
    await page.goto('/calendar?date=2026-09-01&view=month')
    const event = page.getByRole('button', { name: `Edit ${eventTitle}`, exact: true })
    await expect(event).toBeVisible()
    await event.scrollIntoViewIfNeeded()
    if (testInfo.project.use.isMobile) {
      await expect(event).toHaveCSS('opacity', '1')
      await event.tap()
    } else {
      await event.locator('..').hover()
      await expect(event).toHaveCSS('opacity', '1')
      await page.mouse.move(0, 0)
      await event.focus()
      await expect(event).toHaveCSS('opacity', '1')
      await page.keyboard.press('Enter')
    }
    const form = page.getByRole('form', { name: 'Edit event', exact: true })
    await expect(form).toBeVisible()
    await expect(form).not.toContainText(/\((optional|required[^)]*)\)/)
    await form.locator('summary').click()
    await page.screenshot({
      path: testInfo.outputPath('event-editor.png'),
      scale: 'css',
      fullPage: true,
    })
    console.log(
      JSON.stringify({
        colorScheme,
        editor: await form.evaluate((el) => ({
          width: el.clientWidth,
          scrollWidth: el.scrollWidth,
        })),
      }),
    )
    expect.soft(await form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await form.getByLabel('Title', { exact: true }).fill(`${eventTitle} updated`)
    await form.getByRole('button', { name: 'Save event', exact: true }).click()
    await expect(form).toBeHidden()
    expect.soft(events[0]).toMatchObject({
      starts_at: '2026-09-01T11:00:12.000Z',
      ends_at: '2026-09-01T12:30:34.000Z',
      all_day: false,
    })
    console.log(JSON.stringify({ writes }))
    await page.getByRole('button', { name: 'Calendars', exact: true }).click()
    await page.screenshot({
      path: testInfo.outputPath('calendar-menu.png'),
      scale: 'css',
      fullPage: true,
    })
    const calendarForm = page.getByRole('form', { name: 'New calendar', exact: true })
    await expect(calendarForm.getByLabel('Name', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Edit Personal calendar', exact: true }).click()
    const calendarEdit = page.getByRole('form', { name: 'Edit Personal calendar', exact: true })
    await expect(calendarEdit.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Personal',
    )
    await page.screenshot({ path: testInfo.outputPath('calendar-name-editor.png'), scale: 'css' })
    console.log(
      JSON.stringify({
        calendarNameWidth: await calendarEdit
          .getByLabel('Name', { exact: true })
          .evaluate((el) => el.getBoundingClientRect().width),
      }),
    )
    await calendarEdit.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Close calendar management', exact: true }).click()
    await expect(calendarForm).toBeHidden()
    await page.getByRole('button', { name: `Edit ${allDayTitle}`, exact: true }).click()
    await expect(form.getByLabel('Starts')).toHaveValue('2026-09-01')
    await expect(form.getByLabel('Last day')).toHaveValue('2026-09-03')
    await page.keyboard.press('Escape')
    await expect(form).toBeHidden()
    expect(events[2]).toMatchObject({
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: '2026-09-04T00:00:00.000Z',
      all_day: true,
    })
    const remove = page.getByRole('button', {
      name: 'Delete Customer research follow-up',
      exact: true,
    })
    if (testInfo.project.use.isMobile) await remove.tap()
    else {
      await remove.focus()
      await page.keyboard.press('Enter')
    }
    await expect(remove).toBeHidden()
    expect(events).toHaveLength(2)
  })
}

test('month event actions are discoverable without hover on touch', async ({ page }, testInfo) => {
  test.skip(
    !testInfo.project.use.isMobile,
    'Touch-specific visibility; desktop keyboard and hover covered separately',
  )
  await mockCalendar(page)
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/calendar?date=2026-09-01&view=month')
  const edit = page.getByRole('button', { name: `Edit ${eventTitle}`, exact: true })
  await edit.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('touch-event-actions.png'), scale: 'css' })
  await expect.soft(edit).toHaveCSS('opacity', '1')
  await expect(page.getByRole('button', { name: `Delete ${eventTitle}`, exact: true })).toHaveCSS(
    'opacity',
    '1',
  )
})

test('event editor fields and actions fit 320px with details open and closed', async ({
  page,
}, testInfo) => {
  await mockCalendar(page)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/calendar?date=2026-09-01&view=day')
  await page.getByRole('button', { name: allDayTitle, exact: true }).click()
  const form = page.getByRole('form', { name: 'Edit event', exact: true })
  for (const allDay of [true, false]) {
    if (!allDay) await form.getByLabel('All day').uncheck()
    for (const expanded of [true, false]) {
      await form.locator('details').evaluate((el, expanded) => {
        el.open = expanded
      }, expanded)
      await form.getByLabel('Title', { exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({
        path: testInfo.outputPath(`editor-${allDay}-${expanded}.png`),
        scale: 'css',
      })
      const bounds = await form.evaluate((el) => ({
        viewport: innerWidth,
        left: el.getBoundingClientRect().left,
        right: el.getBoundingClientRect().right,
        outside: [...el.querySelectorAll('input:not([type=file]), button, select, textarea')]
          .filter((child) => {
            const r = child.getBoundingClientRect()
            return r.width && (r.left < 0 || r.right > innerWidth)
          })
          .map((child) => child.textContent || child.tagName),
      }))
      console.log(JSON.stringify({ allDay, expanded, editorBounds: bounds }))
      expect.soft(bounds.right).toBeLessThanOrEqual(bounds.viewport)
      expect.soft(bounds.left).toBeGreaterThanOrEqual(0)
      expect.soft(bounds.outside).toEqual([])
    }
  }
})

for (const endpoint of ['Starts', 'Ends'] as const) {
  test(`editing event ${endpoint} preserves the untouched endpoint exactly`, async ({ page }) => {
    const { events } = await mockCalendar(page)
    events[0]!.starts_at = '2026-09-01T13:00:12.345+02:00'
    events[0]!.ends_at = '2026-09-01T14:30:34.567+02:00'
    await page.goto('/calendar?date=2026-09-01&view=week')
    await page.getByRole('button').filter({ hasText: eventTitle }).click()
    const form = page.getByRole('form', { name: 'Edit event', exact: true })
    await form
      .getByLabel(endpoint)
      .fill(endpoint === 'Starts' ? '2026-09-01T11:15' : '2026-09-01T12:45')
    await form.getByRole('button', { name: 'Save event' }).click()
    await expect(form).toBeHidden()
    expect(events[0]).toMatchObject({
      starts_at:
        endpoint === 'Starts' ? '2026-09-01T11:15:00.000Z' : '2026-09-01T13:00:12.345+02:00',
      ends_at: endpoint === 'Ends' ? '2026-09-01T12:45:00.000Z' : '2026-09-01T14:30:34.567+02:00',
    })
  })
}

for (const view of ['day', 'week', 'month', 'agenda']) {
  test(`${view} date navigation preserves selected view and all-day boundaries`, async ({
    page,
  }) => {
    await mockCalendar(page)
    await page.goto(`/calendar?date=2026-09-03&view=${view}`)
    await expect(page.getByRole('button', { name: view, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByText(allDayTitle, { exact: true }).first()).toBeVisible()
    const period = view === 'agenda' ? 'period' : view
    await page.getByRole('button', { name: `Next ${period}`, exact: true }).click()
    await expect(page.getByText(allDayTitle, { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: `Previous ${period}`, exact: true }).click()
    await expect(page.getByText(allDayTitle, { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`date=2026-09-01.*view=${view}`))
    await expect(page.getByRole('button', { name: view, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
}

test('populated day timeline keeps overlapping event clocks and scheduled work distinct', async ({
  page,
}, testInfo) => {
  await mockCalendar(page)
  await page.goto('/calendar?date=2026-09-01&view=day')
  const scheduled = page.getByRole('button', {
    name: new RegExp(`^${scheduledTitle}, scheduled task`),
  })
  await scheduled.scrollIntoViewIfNeeded()
  await expect(scheduled).toContainText('09:00–10:30')
  await expect(page.locator('[data-task-id="deadline"]')).toBeVisible()
  await expect(page.locator('[data-task-id="scheduled"]')).toHaveCount(0)
  const event = page.getByRole('button', { name: new RegExp(`^Edit ${eventTitle},`) })
  const overlap = page.getByRole('button', { name: /^Edit Customer research follow-up,/ })
  await event.scrollIntoViewIfNeeded()
  await expect(event).toContainText('11:00–12:30')
  await expect(overlap).toContainText('11:30–12:00')
  const eventBox = (await event.boundingBox())!
  const overlapBox = (await overlap.boundingBox())!
  expect(eventBox.x + eventBox.width).toBeLessThanOrEqual(overlapBox.x + 1)
  await page.screenshot({ path: testInfo.outputPath('populated-day-timeline.png'), scale: 'css' })
  if (testInfo.project.use.isMobile) await event.tap()
  else {
    await event.focus()
    await page.keyboard.press('Enter')
  }
  await expect(page.getByRole('form', { name: 'Edit event', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
})

for (const title of [eventTitle, allDayTitle]) {
  test(`existing event editor focuses its title and Escape closes: ${title}`, async ({
    page,
  }, testInfo) => {
    await mockCalendar(page)
    await page.goto('/calendar?date=2026-09-01&view=month')
    const edit = page.getByRole('button', { name: `Edit ${title}`, exact: true })
    if (testInfo.project.use.isMobile) await edit.tap()
    else {
      await edit.focus()
      await page.keyboard.press('Enter')
    }
    const form = page.getByRole('form', { name: 'Edit event', exact: true })
    await expect(form.getByLabel('Title', { exact: true })).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('editor-initial-focus.png'), scale: 'css' })
    await page.keyboard.press('Escape')
    await expect(form).toBeHidden()
    await expect(edit).toBeFocused()
  })
}

for (const close of ['Escape', 'Cancel', 'backdrop', 'Close', 'save'] as const) {
  test(`event editor returns focus after ${close}`, async ({ page }, testInfo) => {
    await mockCalendar(page)
    await page.goto('/calendar?date=2026-09-01&view=month')
    const opener = page.getByRole('button', { name: `Edit ${eventTitle}`, exact: true })
    if (testInfo.project.use.isMobile) await opener.tap()
    else {
      await opener.focus()
      await page.keyboard.press('Enter')
    }
    const form = page.getByRole('form', { name: 'Edit event', exact: true })
    await expect(form.getByLabel('Title', { exact: true })).toBeFocused()
    if (close === 'Escape') await page.keyboard.press('Escape')
    else if (close === 'backdrop')
      await page
        .getByRole('button', { name: 'Close event form', exact: true })
        .click({ position: { x: 2, y: 2 } })
    else
      await form
        .getByRole('button', { name: close === 'save' ? 'Save event' : close, exact: true })
        .click()
    await expect(form).toBeHidden()
    await expect(opener).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath(`focus-return-${close}.png`), scale: 'css' })
  })
}

test('event save failure retains editor focus and retry returns to opener', async ({ page }) => {
  await mockCalendar(page)
  let fail = true
  await page.route('**/api/v1/events/timed', async (route) => {
    if (fail) {
      fail = false
      await route.fulfill({ status: 500, json: { error: 'failed' } })
    } else await route.fallback()
  })
  await page.goto('/calendar?date=2026-09-01&view=month')
  const opener = page.getByRole('button', { name: `Edit ${eventTitle}`, exact: true })
  await opener.click()
  const form = page.getByRole('form', { name: 'Edit event', exact: true })
  const save = form.getByRole('button', { name: 'Save event', exact: true })
  await save.click()
  await expect(form.getByRole('alert')).toContainText('Your draft is kept')
  await expect(save).toBeFocused()
  await expect(form.getByLabel('Title', { exact: true })).toHaveValue(eventTitle)
  await save.click()
  await expect(form).toBeHidden()
  await expect(opener).toBeFocused()
})

test('saving an event outside the selected date uses the reachable New event fallback', async ({
  page,
}) => {
  await mockCalendar(page)
  await page.goto('/calendar?date=2026-09-01&view=month')
  await page.getByRole('button', { name: `Edit ${eventTitle}`, exact: true }).click()
  const form = page.getByRole('form', { name: 'Edit event', exact: true })
  await form.getByLabel('Ends').fill('2026-09-02T12:30')
  await form.getByLabel('Starts').fill('2026-09-02T11:00')
  await form.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect(form).toBeHidden()
  await expect(page.getByRole('button', { name: 'New event', exact: true })).toBeFocused()
})

test('calendar view navigation without an editor does not restore stale opener focus', async ({
  page,
}) => {
  await mockCalendar(page)
  await page.goto('/calendar?date=2026-09-01&view=month')
  await page.getByRole('button', { name: `Edit ${eventTitle}`, exact: true }).click()
  await page.keyboard.press('Escape')
  const week = page.getByRole('button', { name: 'week', exact: true })
  await week.click()
  await expect(week).toHaveAttribute('aria-pressed', 'true')
  await expect(week).toBeFocused()
})

test('pending event save does not steal focus after navigation away', async ({ page }) => {
  await mockCalendar(page)
  let release!: () => void
  const response = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/events/timed', async (route) => {
    await response
    await route.fallback()
  })
  await page.goto('/calendar?date=2026-09-01&view=month')
  await page.getByRole('button', { name: `Edit ${eventTitle}`, exact: true }).click()
  const request = page.waitForRequest('**/api/v1/events/timed')
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await request
  // Browser history navigation remains possible while a request is pending.
  await page.evaluate(() => {
    history.pushState({}, '', '/projects')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  const newProject = page.getByRole('button', { name: 'New project', exact: true })
  await newProject.focus()
  const savedResponse = page.waitForResponse('**/api/v1/events/timed')
  release()
  await (await savedResponse).finished()
  await page.waitForTimeout(100)
  await expect(newProject).toBeFocused()
})
