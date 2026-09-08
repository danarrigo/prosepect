import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { OperationsSnapshot } from '../src/api/types'

const snapshot: OperationsSnapshot = {
  as_of: '2026-09-01T09:00:00Z',
  api: 'ok',
  database: 'ok',
  limits: {
    max_user_accounts: null,
    max_total_file_storage_bytes: 5368709120,
    max_user_file_storage_bytes: 104857600,
    max_file_size_bytes: 26214400,
  },
  metrics: {
    accounts: 3,
    file_bytes: 1024,
    pending: 2,
    running: 1,
    retryable: 4,
    final_failed_all_time: 5,
    succeeded_all_time: 20,
    oldest_waiting_created_at: '2026-08-31T09:00:00Z',
    latest_completed_job_at: '2026-09-01T08:00:00Z',
  },
}

async function mockWorkspace(page: Page, owner = true, sidebar = true) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    let body: unknown = { items: [] }
    if (path === '/session')
      body = {
        csrf_token: 'mock-csrf',
        user: { id: 'user-1', email: 'private@example.test', display_name: 'Owner' },
      }
    else if (path === '/settings')
      body = {
        theme: 'system',
        automatic_daily_review: false,
        sidebar_visible: sidebar,
        sync_conflict_policy: 'ask',
        version: 1,
      }
    else if (path.startsWith('/daily-plans/')) body = { focus_task_ids: [], focus_tasks: [] }
    else if (path === '/integrations/google')
      body = {
        connected: false,
        scopes: [],
        expires_at: null,
        latest_synchronization: null,
        pending_synchronization_count: 0,
        failed_synchronization_count: 0,
      }
    else if (path === '/operations/capability') body = owner
    else if (path === '/operations') {
      await route.fulfill({
        status: owner ? 200 : 403,
        json: owner ? snapshot : { error: { message: 'private-provider-error' } },
      })
      return
    }
    await route.fulfill({ json: body })
  })
}

async function screenshot(page: Page, name: string) {
  if (!process.env.OPERATIONS_SCREENSHOT_DIR) return
  await mkdir(process.env.OPERATIONS_SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({
    path: `${process.env.OPERATIONS_SCREENSHOT_DIR}/${name}.png`,
    fullPage: true,
  })
}

test('owner sees aggregate meanings, unknown evidence and accessible responsive cards', async ({
  page,
}, info) => {
  await mockWorkspace(page)
  await page.goto('/operations')
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible()
  await expect(page.getByText('Unlimited - not configured')).toBeVisible()
  await expect(page.getByText('Final failed · all time')).toBeVisible()
  await expect(
    page.getByText('A completed job does not prove every calendar is healthy.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Not verified' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('private@example.test')
  const refresh = page.getByRole('button', { name: 'Refresh snapshot' })
  await refresh.focus()
  await expect(refresh).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await screenshot(page, `owner-${info.project.name}-light`)
  await page.getByRole('button', { name: 'Use dark theme' }).click()
  await expect(page.locator('html')).toHaveClass('dark')
  await screenshot(page, `owner-${info.project.name}-dark`)
})

test('slow capability discovery does not delay the workspace', async ({ page }) => {
  await mockWorkspace(page)
  await page.route('**/api/v1/operations/capability', () => {})
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Make today count.', exact: true })).toBeVisible({
    timeout: 5000,
  })
  await expect(page.getByRole('link', { name: 'Operations', exact: true })).toHaveCount(0)
})

test('owner navigation remains available with the sidebar disabled', async ({ page }) => {
  await mockWorkspace(page, true, false)
  await page.goto('/')
  await page.getByRole('link', { name: 'Operations', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible()
})

test('nonowner navigation is hidden and direct URL is clearly denied without payload leakage', async ({
  page,
}) => {
  await mockWorkspace(page, false)
  await page.goto('/operations')
  await expect(page.getByRole('alert')).toContainText('restricted to the owner')
  await expect(page.getByRole('link', { name: 'Operations', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('private-provider-error')
})

test('degraded snapshot shows unknown metrics, not old values or zero', async ({ page }, info) => {
  await mockWorkspace(page)
  await page.route('**/api/v1/operations', (route) =>
    route.fulfill({ json: { ...snapshot, database: 'unavailable', metrics: null } }),
  )
  await page.goto('/operations')
  await expect(page.getByRole('alert')).toContainText('Degraded snapshot')
  await expect(page.getByRole('alert')).toContainText('unknown, not zero')
  const accounts = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Accounts', exact: true }) })
  await expect(accounts).toContainText('Unknown')
  await expect(accounts).not.toContainText('Current accounts3')
  await screenshot(page, `degraded-${info.project.name}`)
})

test('refresh failure retains a stale snapshot; retry recovers; revocation clears aggregates', async ({
  page,
}) => {
  await mockWorkspace(page)
  let status = 200
  await page.route('**/api/v1/operations', (route) =>
    route.fulfill({
      status,
      json: status === 200 ? snapshot : { error: { message: 'private-provider-error' } },
    }),
  )
  await page.goto('/operations')
  await expect(page.getByRole('button', { name: 'Refresh snapshot' })).toBeVisible()
  status = 500
  await page.getByRole('button', { name: 'Refresh snapshot' }).click()
  await expect(page.getByRole('alert')).toContainText('Service status is unknown')
  await expect(page.getByRole('status')).toContainText('Stale snapshot')
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('private-provider-error')
  status = 200
  await page.getByRole('button', { name: 'Retry refresh' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('status')).not.toContainText('Stale snapshot')
  status = 403
  await page.getByRole('button', { name: 'Refresh snapshot' }).click()
  await expect(page.getByRole('alert')).toContainText('restricted to the owner')
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toHaveCount(0)
})

test('polls only while mounted and visible, with no overlapping or stale updates', async ({
  page,
}) => {
  await page.clock.install()
  await mockWorkspace(page, true, false)
  let requests = 0
  let release: (() => void) | undefined
  await page.route('**/api/v1/operations', async (route) => {
    requests++
    if (requests === 2)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    await route
      .fulfill({
        json: { ...snapshot, metrics: { ...snapshot.metrics, accounts: requests === 2 ? 999 : 3 } },
      })
      .catch(() => {})
  })
  await page.goto('/operations')
  await expect(page.getByRole('button', { name: 'Refresh snapshot' })).toBeVisible()
  expect(requests).toBe(1)
  await page.clock.fastForward(60_000)
  await expect.poll(() => requests).toBe(2)
  await expect(page.getByRole('button', { name: 'Refreshing…' })).toBeDisabled()
  await page.clock.fastForward(5_000)
  expect(requests).toBe(2)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  release?.()
  await page.clock.fastForward(180_000)
  expect(requests).toBe(2)
  await expect(page.locator('body')).not.toContainText('999')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => requests).toBe(3)
  await expect(page.getByRole('button', { name: 'Refresh snapshot' })).toBeVisible()
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toHaveCount(0)
  await page.clock.fastForward(180_000)
  expect(requests).toBe(3)
})

test('empty job history uses no-data labels and configured capacity is explicit', async ({
  page,
}) => {
  await mockWorkspace(page)
  await page.route('**/api/v1/operations', (route) =>
    route.fulfill({
      json: {
        ...snapshot,
        limits: { ...snapshot.limits, max_user_accounts: 3 },
        metrics: {
          ...snapshot.metrics,
          pending: 0,
          running: 0,
          retryable: 0,
          final_failed_all_time: 0,
          succeeded_all_time: 0,
          oldest_waiting_created_at: null,
          latest_completed_job_at: null,
        },
      },
    }),
  )
  await page.goto('/operations')
  await expect(page.getByText('No data', { exact: true })).toBeVisible()
  await expect(page.getByText('No waiting jobs', { exact: true })).toBeVisible()
  await expect(page.getByText('Account cap reached.', { exact: false })).toBeVisible()
})

test('expired session clears access and does not expose server errors', async ({ page }) => {
  await mockWorkspace(page)
  await page.route('**/api/v1/operations', (route) =>
    route.fulfill({ status: 401, body: 'private-session-detail' }),
  )
  await page.goto('/operations')
  await expect(page.getByRole('alert')).toContainText('Sign in again')
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Operations', exact: true })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('private-session-detail')
})

test('hung refresh times out and can be retried without applying its late result', async ({
  page,
}) => {
  await page.clock.install()
  await mockWorkspace(page)
  let requests = 0
  let release: (() => void) | undefined
  await page.route('**/api/v1/operations', async (route) => {
    const current = ++requests
    if (current === 2)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    await route
      .fulfill({
        json: { ...snapshot, metrics: { ...snapshot.metrics, accounts: current === 2 ? 999 : 3 } },
      })
      .catch(() => {})
  })
  await page.goto('/operations')
  await page.getByRole('button', { name: 'Refresh snapshot' }).click()
  await expect.poll(() => requests).toBe(2)
  await page.clock.fastForward(15_000)
  await expect(page.getByRole('alert')).toContainText('Service status is unknown')
  await page.getByRole('button', { name: 'Retry refresh' }).click()
  await expect.poll(() => requests).toBe(3)
  await expect(page.getByRole('alert')).toHaveCount(0)
  release?.()
  await expect(page.locator('body')).not.toContainText('999')
})
