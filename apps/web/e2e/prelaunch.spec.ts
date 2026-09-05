import { expect, test, type Page } from '@playwright/test'

const now = '2026-09-01T09:00:00Z'
const job = {
  id: 'sync-1',
  calendar_id: null,
  kind: 'calendar_sync',
  status: 'pending',
  attempt_count: 0,
  available_at: now,
  last_error: null,
  created_at: now,
  updated_at: now,
}

async function mockWorkspace(page: Page) {
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
    else if (path.startsWith('/daily-plans/')) body = { focus_task_ids: [] }
    else if (path === '/integrations/google')
      body = {
        connected: true,
        scopes: [],
        expires_at: null,
        latest_synchronization: null,
        failed_synchronization_count: 0,
      }
    else if (path === '/files/usage')
      body = { used_bytes: 8, max_user_storage_bytes: 10, max_file_size_bytes: 5 }
    else if (path === '/synchronizations' || path === '/synchronizations/sync-1') body = job
    else if (path === '/files' && route.request().method() === 'POST')
      body = { id: 'file-1', filename: 'large.txt', byte_size: 6, created_at: now }
    await route.fulfill({ json: body })
  })
}

test.beforeEach(async ({ page }) => mockWorkspace(page))

test('checks configured attachment size and personal quota before upload', async ({ page }) => {
  let uploads = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/files') && request.method() === 'POST') uploads++
  })
  await page.goto('/files')
  await expect(page.getByText('8 B of 10 B used')).toBeVisible()
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.from('123456') })
  await expect(page.getByRole('alert')).toContainText('exceeds the 5 B file limit')
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'quota.txt', mimeType: 'text/plain', buffer: Buffer.from('123') })
  await expect(page.getByRole('alert')).toContainText('Only 2 B of attachment storage remains')
  expect(uploads).toBe(0)
})

test('shows a queued sync and follows its running and retry state without provider errors', async ({
  page,
}) => {
  let status = 'running'
  await page.route('**/api/v1/synchronizations/sync-1', (route) =>
    route.fulfill({
      json: { ...job, status, attempt_count: 1, last_error: 'secret-provider-token' },
    }),
  )
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sync now', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Synchronization queued' })).toBeVisible()
  await expect(page.getByText('Synchronization is running.')).toBeVisible({ timeout: 10000 })
  status = 'failed'
  await expect(page.getByText(/Retry scheduled/)).toBeVisible({ timeout: 10000 })
  await expect(page.locator('body')).not.toContainText('secret-provider-token')
})

test('preserves unsupported multi-weekday Todoist recurrence instead of changing it', async ({
  page,
}) => {
  await page.goto('/settings')
  await page.locator('input[type=file]').setInputFiles({
    name: 'work.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('TYPE,CONTENT,DATE\ntask,Check metrics,every Monday and Friday'),
  })
  await expect(page.getByText(/could not be represented and was preserved/)).toBeVisible()
})
