import { expect, test, type Page } from '@playwright/test'

const title = 'CustomerSuccessMigration'.repeat(5)
const filename = `${'customer-success-quarterly-deliverables-'.repeat(5)}.pdf`
const now = '2026-09-01T08:00:00Z'
const markdown = `# Launch documentation\n\n${'Long prose for the customer handover. '.repeat(30)}\n\n[${'reference'.repeat(25)}](https://example.test/reference)\n\n\`\`\`text\n${'long_code_segment_'.repeat(20)}\n\`\`\`\n\n| Owner | Deliverable | Status |\n| --- | --- | --- |\n| Customer success | ${'Documentation'.repeat(12)} | Ready |`

type State = 'populated' | 'empty' | 'error'
async function mockWorkspace(page: Page, state: State = 'populated') {
  const notes =
    state === 'empty'
      ? []
      : [{ id: 'note-1', title, markdown, created_at: now, updated_at: now, version: 1 }]
  const files =
    state === 'empty'
      ? []
      : [
          {
            id: 'file-1',
            filename,
            byte_size: 7340032,
            content_type: 'application/pdf',
            created_at: now,
          },
        ]
  const mutations: string[] = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:5173') {
      await route.abort()
      throw new Error(`Unexpected external request: ${url.origin}`)
    }
    if (!url.pathname.startsWith('/api/v1/')) return route.fallback()
    const path = url.pathname.replace('/api/v1', '')
    if (route.request().method() !== 'GET') mutations.push(`${route.request().method()} ${path}`)
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
    else if (path === '/operations/capability') body = false
    else if (path === '/integrations/google')
      body = {
        connected: false,
        scopes: [],
        expires_at: null,
        latest_synchronization: null,
        pending_synchronization_count: 0,
        failed_synchronization_count: 0,
      }
    else if (path === '/files/usage')
      body = {
        used_bytes: state === 'empty' ? 0 : 94371840,
        max_user_storage_bytes: 104857600,
        max_file_size_bytes: 10485760,
      }
    else if (path === '/notes') body = { items: notes }
    else if (path === '/files') body = { items: files }
    if (
      state === 'error' &&
      ['/notes', '/files', '/files/usage', '/integrations/google'].includes(path)
    )
      return route.fulfill({
        status: 503,
        json: { error: { code: 'unavailable', message: 'Temporarily unavailable. Please retry.' } },
      })
    if (route.request().method() !== 'GET')
      return route.fulfill({
        status: 503,
        json: { error: { code: 'unavailable', message: 'Could not save. Please retry.' } },
      })
    await route.fulfill({ json: body })
  })
  return { notes, files, mutations }
}

async function capture(page: Page, name: string, project: string) {
  if (process.env.UI_AUDIT_EVIDENCE)
    await page.screenshot({
      path: `${process.env.UI_AUDIT_EVIDENCE}/${project}-${name}.png`,
      fullPage: true,
      scale: 'css',
    })
}
async function measure(page: Page, name: string) {
  const bounds = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    width: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll('main button, main input, main select, main textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width && (r.left < -1 || r.right > document.documentElement.clientWidth + 1)
      })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim()),
  }))
  console.log(JSON.stringify({ name, ...bounds }))
  expect.soft(bounds.width, name).toBeLessThanOrEqual(bounds.viewport)
  expect.soft(bounds.outside, name).toEqual([])
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const state of ['populated', 'empty', 'error'] as const) {
    test(`notes files settings matrix ${colorScheme} ${state}`, async ({ page }, info) => {
      test.setTimeout(120_000)
      await page.emulateMedia({ colorScheme })
      await mockWorkspace(page, state)
      for (const width of info.project.use.isMobile ? [320, 375] : [768, 1280, 1600]) {
        await page.setViewportSize({ width, height: 900 })
        for (const view of ['notes', 'files', 'settings']) {
          await page.goto(`/${view}`)
          await expect(
            page.getByRole('heading', { name: view, exact: false }).first(),
          ).toBeVisible()
          if (view === 'settings') {
            const panel = page.getByRole('region', { name: 'Google Calendar synchronization' })
            await expect(
              panel.getByRole('button', { name: 'Refresh status', exact: true }),
            ).toBeEnabled()
          }
          const label = `${view}-${width}-${colorScheme}-${state}`
          await capture(page, label, info.project.name)
          await measure(page, label)
          if (view === 'notes' && state === 'populated') {
            await page.getByRole('button', { name: 'Edit note', exact: true }).click()
            const form = page.getByRole('form', { name: 'Note editor' })
            await expect(form.getByLabel('Title', { exact: true })).toBeFocused()
            await capture(page, `editor-${width}-${colorScheme}`, info.project.name)
            await measure(page, `editor-${width}-${colorScheme}`)
            await expect(
              form.getByRole('region', { name: 'Preview' }).getByRole('link'),
            ).toHaveAttribute('href', 'https://example.test/reference')
            for (const element of await form.locator('pre, table').all()) {
              const sizes = await element.evaluate((el) => ({
                width: el.clientWidth,
                content: el.scrollWidth,
              }))
              expect(sizes.content).toBeGreaterThan(sizes.width)
            }
            await form.getByRole('button', { name: 'Cancel', exact: true }).click()
          }
        }
      }
    })
  }
}

test('note editor preserves drafts on save failure and restores keyboard focus on cancel', async ({
  page,
}, info) => {
  const { notes } = await mockWorkspace(page)
  notes[0]!.title = 'Launch checklist'
  notes[0]!.markdown = 'Original content'
  await page.goto('/notes')
  const edit = page.getByRole('button', { name: 'Edit note', exact: true })
  await edit.focus()
  await page.keyboard.press('Enter')
  const form = page.getByRole('form', { name: 'Note editor' })
  await expect.soft(form.getByLabel('Title', { exact: true })).toBeFocused()
  await form.getByLabel('Title', { exact: true }).fill('Unsaved draft')
  await form.getByLabel('Markdown', { exact: true }).fill('Keep my revised prose')
  await form.getByRole('button', { name: 'Save note', exact: true }).click()
  await capture(page, 'note-save-error', info.project.name)
  await expect(form.getByRole('alert')).toContainText('Could not save')
  await expect(form.getByRole('button', { name: 'Save note', exact: true })).toBeFocused()
  await expect(form.getByLabel('Title', { exact: true })).toHaveValue('Unsaved draft')
  await expect(form.getByLabel('Markdown', { exact: true })).toHaveValue('Keep my revised prose')
  await form.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.soft(edit).toBeFocused()
  await edit.click()
  await expect.soft(form.getByLabel('Title', { exact: true })).toHaveValue('Launch checklist')
  await expect.soft(form.getByLabel('Markdown', { exact: true })).toHaveValue('Original content')
})

test('failed initial Google status does not claim it is still loading', async ({ page }, info) => {
  await mockWorkspace(page)
  await page.route('**/api/v1/integrations/google', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'unavailable', message: 'Unavailable' } },
    }),
  )
  await page.goto('/settings')
  const panel = page.getByRole('region', { name: 'Google Calendar synchronization' })
  await expect(panel.getByRole('alert')).toContainText('Could not refresh Google status')
  await capture(page, 'google-status-failed', info.project.name)
  await expect(panel).not.toContainText('Loading Google connection')
  await expect(panel.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled()
})

test('settings save failure preserves preferences and exposes a retryable error', async ({
  page,
}, info) => {
  await mockWorkspace(page)
  await page.goto('/settings')
  const form = page.getByRole('form', { name: 'Workspace settings' })
  await expect(form.getByLabel('Theme')).toHaveValue('system')
  await expect(form.getByLabel('Start the daily review automatically')).not.toBeChecked()
  await form.getByLabel('Theme').selectOption('dark')
  await form.getByLabel('Show sidebar').uncheck()
  await form.getByRole('button', { name: 'Save settings', exact: true }).click()
  await capture(page, 'settings-save-error', info.project.name)
  await expect(form.getByRole('alert')).toContainText('Could not save')
  await expect(form.getByLabel('Theme')).toHaveValue('dark')
  await expect(form.getByLabel('Show sidebar')).not.toBeChecked()
  await expect(form.getByRole('button', { name: 'Save settings', exact: true })).toBeFocused()
})

test('notes can retry a failed creation and save edits without duplicate submissions', async ({
  page,
}) => {
  await mockWorkspace(page, 'empty')
  await page.goto('/notes')
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  const form = page.getByRole('form', { name: 'Note editor' })
  await expect(form.getByLabel('Title', { exact: true })).toBeFocused()
  await expect(form.getByRole('button', { name: 'Save note', exact: true })).toBeDisabled()
  await form.getByLabel('Title', { exact: true }).fill('New draft')
  await form.getByLabel('Markdown', { exact: true }).fill(markdown)
  await form.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('Could not save')
  await expect(form.getByLabel('Markdown', { exact: true })).toHaveValue(markdown)
  let release: (() => void) | undefined
  let creates = 0
  await page.route('**/api/v1/notes', async (route) => {
    creates++
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fulfill({
      json: {
        id: 'new-note',
        ...route.request().postDataJSON(),
        created_at: now,
        updated_at: now,
        version: 1,
      },
    })
  })
  await form.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(form.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
  await expect(form.getByLabel('Title', { exact: true })).toBeDisabled()
  await expect.poll(() => creates).toBe(1)
  release!()
  await expect(form).toBeHidden()
  const edit = page.getByRole('button', { name: 'Edit note', exact: true })
  await expect(edit).toBeFocused()
  await edit.click()
  await form.getByLabel('Title', { exact: true }).fill('Saved revision')
  await page.route('**/api/v1/notes/new-note', (route) =>
    route.fulfill({
      json: {
        id: 'new-note',
        ...route.request().postDataJSON(),
        created_at: now,
        updated_at: now,
        version: 2,
      },
    }),
  )
  await form.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Saved revision', exact: true })).toBeVisible()
  await expect(edit).toBeFocused()
})

test('files loading, quota, upload, download link and confirmed deletion UI use mocks only', async ({
  page,
}, info) => {
  const { files } = await mockWorkspace(page)
  let usageRequests = 0
  let release: (() => void) | undefined
  let full = false
  await page.route('**/api/v1/files/usage', async (route) => {
    usageRequests++
    if (usageRequests === 1)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    await route.fulfill({
      json: {
        used_bytes: full ? 104857600 : 94371840,
        max_user_storage_bytes: 104857600,
        max_file_size_bytes: 10485760,
      },
    })
  })
  await page.goto('/files')
  const upload = page.getByLabel('Upload file')
  await expect(page.getByRole('status')).toContainText('Checking attachment storage')
  await expect(upload).toBeDisabled()
  await capture(page, 'files-loading', info.project.name)
  release!()
  await expect(upload).toBeEnabled()
  await expect(page.getByText('90.0 MiB of 100.0 MiB used')).toBeVisible()
  const fixture = {
    name: 'handover.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Mock handover'),
  }
  full = true
  await upload.setInputFiles(fixture)
  await expect(page.getByRole('alert')).toContainText('storage')
  await capture(page, 'files-quota-error', info.project.name)
  full = false
  await upload.setInputFiles(fixture)
  await expect(page.getByRole('alert')).toContainText('Could not save')
  await page.route('**/api/v1/files', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          json: {
            ...files[0],
            id: 'uploaded',
            filename: fixture.name,
            byte_size: fixture.buffer.length,
          },
        })
      : route.fallback(),
  )
  await upload.setInputFiles(fixture)
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible()
  // Chromium's native download bypasses Playwright routing. Byte-transfer coverage
  // belongs to the real-backend workspace spec; this mock audit checks the link only.
  const downloadLink = page.getByRole('link', { name: `Download ${filename}`, exact: true })
  await expect(downloadLink).toHaveAttribute('href', '/api/v1/files/file-1/download')
  await expect(downloadLink).toHaveAttribute('download', filename)
  let deletes = 0
  let deleteFails = true
  await page.route('**/api/v1/files/file-1', (route) => {
    deletes++
    return route.fulfill(
      deleteFails
        ? { status: 503, json: { error: { code: 'unavailable', message: 'Unavailable' } } }
        : { status: 204 },
    )
  })
  const remove = page.getByRole('button', { name: `Delete ${filename}`, exact: true })
  page.once('dialog', (dialog) => dialog.dismiss())
  await remove.click()
  expect(deletes).toBe(0)
  page.once('dialog', (dialog) => dialog.accept())
  await remove.click()
  await expect(page.getByRole('alert')).toContainText('Could not delete this file')
  await expect(remove).toBeVisible()
  deleteFails = false
  page.once('dialog', (dialog) => dialog.accept())
  await remove.click()
  await expect(remove).toHaveCount(0)
  expect(deletes).toBe(2)
})

test('file limits failure disables upload until a successful retry', async ({ page }) => {
  await mockWorkspace(page)
  let failed = true
  await page.route('**/api/v1/files/usage', (route) =>
    route.fulfill(
      failed
        ? { status: 503, json: { error: { message: 'Unavailable' } } }
        : {
            json: {
              used_bytes: 0,
              max_user_storage_bytes: 104857600,
              max_file_size_bytes: 10485760,
            },
          },
    ),
  )
  await page.goto('/files')
  await expect(page.getByLabel('Upload file')).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('Could not load attachment limits')
  failed = false
  await page.getByRole('button', { name: 'Retry limits' }).click()
  await expect(page.getByLabel('Upload file')).toBeEnabled()
  await expect(page.getByText('0 B of 100.0 MiB used')).toBeVisible()
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`Google connected retrying and final-failed presentation ${colorScheme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme })
    await mockWorkspace(page)
    let attempts = 2
    await page.route('**/api/v1/integrations/google', (route) =>
      route.fulfill({
        json: {
          connected: true,
          scopes: ['https://www.googleapis.com/auth/calendar.events'],
          expires_at: null,
          pending_synchronization_count: attempts < 8 ? 1 : 0,
          failed_synchronization_count: attempts < 8 ? 0 : 1,
          latest_synchronization: {
            id: 'sync-1',
            kind: 'calendar_sync',
            status: 'failed',
            attempt_count: attempts,
            available_at: now,
            created_at: now,
            updated_at: now,
          },
        },
      }),
    )
    for (const width of info.project.use.isMobile ? [320, 375] : [768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 })
      for (const count of [2, 8]) {
        attempts = count
        await page.goto('/settings')
        const panel = page.getByRole('region', { name: 'Google Calendar synchronization' })
        await expect(panel).toContainText('Connected with encrypted credentials')
        await expect(panel.getByRole('status')).toContainText(
          count < 8 ? 'Retry scheduled' : 'stopped after repeated failures',
        )
        if (count < 8) await expect(panel.getByRole('button', { name: 'Sync now' })).toBeDisabled()
        else await expect(panel.getByRole('button', { name: 'Sync now' })).toBeEnabled()
        await measure(page, `google-${width}-${colorScheme}-${count}`)
        await capture(page, `google-${width}-${colorScheme}-${count}`, info.project.name)
      }
    }
  })
}

test('settings mocked save applies theme/sidebar; account deletion cancel and wrong text send no request', async ({
  page,
}, info) => {
  const { mutations } = await mockWorkspace(page)
  await page.goto('/settings')
  const form = page.getByRole('form', { name: 'Workspace settings' })
  await page.route('**/api/v1/settings', (route) =>
    route.fulfill({ json: { ...route.request().postDataJSON(), version: 2 } }),
  )
  await form.getByLabel('Theme').selectOption('dark')
  await form.getByLabel('Show sidebar').uncheck()
  await form.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect(page.locator('html')).toHaveClass('dark')
  if (!info.project.use.isMobile)
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden()
  await expect(form.getByRole('button', { name: 'Save settings', exact: true })).toBeFocused()
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('Type DELETE')
    return dialog.dismiss()
  })
  await page.getByRole('button', { name: 'Delete my account' }).click()
  page.once('dialog', (dialog) => dialog.accept('delete'))
  await page.getByRole('button', { name: 'Delete my account' }).click()
  expect(mutations).toEqual([])
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  for (const [name, path] of [
    ['Complete JSON', 'json'],
    ['Tasks CSV', 'tasks.csv'],
    ['Notes Markdown', 'notes.md'],
    ['Calendars ICS', 'calendars.ics'],
  ]) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute(
      'href',
      `/api/v1/exports/${path}`,
    )
  }
  await expect(page.getByLabel('Choose Todoist CSV')).toHaveAttribute('accept', '.csv,text/csv')
  await page.getByLabel('Choose Todoist CSV').setInputFiles({
    name: 'project.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT\ntask,Mock handover,,1,1\n'),
  })
  await expect(page.getByText('1 tasks ready')).toBeVisible()
  await expect(page.getByLabel('New project name')).toHaveValue('project')
  await expect(page.getByRole('button', { name: 'Import project', exact: true })).toBeEnabled()
  expect(mutations).toEqual([])
})
