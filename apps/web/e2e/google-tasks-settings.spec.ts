import { expect, test, type Page } from '@playwright/test'
import type { GoogleTasksStatus } from '../src/api/types'

async function settings(page: Page, authorized = true) {
  let status: GoogleTasksStatus = {
    authorized,
    enabled: false,
    task_list_id: null,
    timezone: null,
    list_create_attempted: false,
    last_synced_at: null,
    last_error: null,
    version: 0,
  }
  let ambiguous = false
  const lists: { id: string; title: string }[] = []
  const writes: string[] = []
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    const method = route.request().method()
    let body: unknown = { items: [] }
    if (path === '/session')
      body = {
        user: { id: 'owner', display_name: 'Owner', email: 'owner@example.test', timezone: 'UTC' },
        csrf_token: 'mock',
      }
    else if (path === '/settings')
      body = {
        theme: 'system',
        automatic_daily_review: false,
        sidebar_visible: false,
        sync_conflict_policy: 'ask',
        version: 1,
      }
    else if (path.startsWith('/daily-plans')) body = { focus_tasks: [], focus_task_ids: [] }
    else if (path === '/integrations/google')
      body = { connected: true, calendar_authorized: true, latest_synchronization: null }
    else if (path === '/integrations/google/tasks') {
      if (method === 'PUT') {
        writes.push(method + ' ' + path)
        const input = route.request().postDataJSON()
        expect(input.expected_version).toBe(status.version)
        status = { ...status, ...input, version: status.version + 1 }
      }
      body = status
    } else if (path === '/integrations/google/tasks/lists') {
      if (method === 'POST') {
        writes.push(method + ' ' + path)
        expect(route.request().postDataJSON().expected_version).toBe(status.version)
        status = { ...status, list_create_attempted: true, version: status.version + 1 }
        const list = { id: 'created', title: 'prosepect' }
        lists.push(list)
        if (ambiguous) {
          await route.fulfill({
            status: 502,
            json: {
              error: {
                code: 'integration',
                message: 'Google may have created the list. Refresh lists before retrying.',
              },
            },
          })
          return
        }
        body = list
      } else body = lists
    } else if (path === '/integrations/google/tasks/sync') {
      writes.push(method + ' ' + path)
      body = { id: 'sync', kind: 'tasks_sync', status: 'pending', attempt_count: 0 }
    }
    await route.fulfill({ json: body })
  })
  return {
    writes,
    ambiguous: () => {
      ambiguous = true
    },
  }
}

test('Tasks consent is separate and never starts copying automatically', async ({ page }) => {
  const fixture = await settings(page, false)
  await page.goto('/settings')
  const panel = page.getByRole('region', { name: 'Google Tasks', exact: true })
  await expect(panel.getByRole('link', { name: 'Connect Google Tasks' })).toHaveAttribute(
    'href',
    '/api/v1/auth/google/tasks/start',
  )
  await expect(panel.getByRole('button', { name: 'Enable Tasks sync' })).toHaveCount(0)
  expect(fixture.writes).toEqual([])
})

test('create, select, enable, sync and disable Tasks without revoking Calendar', async ({
  page,
}) => {
  const fixture = await settings(page)
  await page.goto('/settings')
  const panel = page.getByRole('region', { name: 'Google Tasks', exact: true })
  await expect(panel.getByRole('button', { name: 'Enable Tasks sync' })).toBeDisabled()
  await panel.getByRole('button', { name: 'Create prosepect list' }).click()
  await expect(panel.getByRole('combobox', { name: 'Task list' })).toHaveValue('created')
  await panel.getByRole('button', { name: 'Enable Tasks sync' }).click()
  await expect(panel.getByRole('status')).toContainText('Initial synchronization is queued')
  await panel.getByRole('button', { name: 'Sync Tasks now' }).click()
  await expect(panel.getByRole('status')).toContainText('changes are not applied yet')
  await panel.getByRole('button', { name: 'Disable Tasks sync' }).click()
  await expect(panel.getByRole('status')).toContainText('Calendar sync is unchanged')
  expect(fixture.writes).toEqual([
    'POST /integrations/google/tasks/lists',
    'PUT /integrations/google/tasks',
    'POST /integrations/google/tasks/sync',
    'PUT /integrations/google/tasks',
  ])
  await page.setViewportSize({ width: 320, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await panel.screenshot({ path: test.info().outputPath('tasks-settings-320.png') })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await panel.screenshot({ path: test.info().outputPath('tasks-settings-320-dark.png') })
  await page.setViewportSize({ width: 1280, height: 900 })
  await panel.screenshot({ path: test.info().outputPath('tasks-settings-desktop-dark.png') })
})

test('uncertain list creation requires discovery, not a duplicate POST', async ({ page }) => {
  const fixture = await settings(page)
  fixture.ambiguous()
  await page.goto('/settings')
  const panel = page.getByRole('region', { name: 'Google Tasks', exact: true })
  await panel.getByRole('button', { name: 'Create prosepect list' }).click()
  await expect(panel.getByRole('alert')).toContainText('Refresh lists before retrying')
  await expect(panel.getByRole('button', { name: 'Create prosepect list' })).toBeDisabled()
  await panel.getByRole('button', { name: 'Refresh Tasks status and lists' }).click()
  await panel.getByRole('combobox', { name: 'Task list' }).selectOption('created')
  await panel.getByRole('button', { name: 'Enable Tasks sync' }).click()
  expect(
    fixture.writes.filter((request) => request === 'POST /integrations/google/tasks/lists'),
  ).toHaveLength(1)
})
