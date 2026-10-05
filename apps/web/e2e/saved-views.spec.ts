import { expect, test, type Page } from '@playwright/test'
import type { SavedTaskView } from '../src/api/types'

async function fixture(page: Page) {
  let views: SavedTaskView[] = []
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    let body: unknown = { items: [] }
    if (path === '/session')
      body = {
        csrf_token: 'mock',
        user: { id: 'owner', email: 'owner@example.test', display_name: 'Owner', timezone: 'UTC' },
      }
    else if (path === '/settings')
      body = {
        theme: 'system',
        sidebar_visible: true,
        automatic_daily_review: false,
        sync_conflict_policy: 'ask',
        version: 1,
      }
    else if (path.startsWith('/daily-plans/')) body = { focus_task_ids: [], focus_tasks: [] }
    else if (path === '/projects')
      body = {
        items: [
          {
            id: 'work',
            name: 'Work',
            status: 'active',
            completed_tasks: 0,
            total_tasks: 1,
            version: 1,
          },
        ],
      }
    else if (path === '/files/usage')
      body = { used_bytes: 0, max_user_storage_bytes: 104857600, max_file_size_bytes: 10485760 }
    else if (path === '/tasks')
      body = {
        items: ['Zebra', 'Alpha'].map((title, position) => ({
          id: title,
          title,
          position,
          project_id: title === 'Alpha' ? 'work' : null,
          parent_task_id: null,
          status: 'todo',
          description: '',
          priority: 'medium',
          labels: ['work'],
          recurrence: 'none',
          version: 1,
          created_at: '',
          updated_at: '',
        })),
      }
    else if (path === '/saved-task-views') {
      if (route.request().method() === 'POST') {
        const saved = {
          ...route.request().postDataJSON(),
          id: `saved-${views.length}`,
          created_at: '2026-10-05T00:00:00Z',
        }
        views.push(saved)
        body = saved
      } else body = views
    } else if (path.startsWith('/saved-task-views/') && route.request().method() === 'DELETE') {
      views = views.filter((view) => view.id !== path.split('/')[2])
      return route.fulfill({ status: 204 })
    }
    await route.fulfill({ json: body })
  })
}

test('project task sorting survives task-list rendering', async ({ page }) => {
  await fixture(page)
  await page.goto('/projects')
  await page.getByRole('combobox', { name: 'Sort tasks', exact: true }).selectOption('title')
  await expect(page.locator('[data-task-id]').first()).toHaveAttribute('data-task-id', 'Alpha')
})

test('saved filters retain project scope across reload and deletion leaves tasks alone', async ({
  page,
}) => {
  await fixture(page)
  await page.goto('/projects?project=work')
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('Alpha')
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('todo')
  await page.getByRole('combobox', { name: 'Filter by priority' }).selectOption('medium')
  await page.getByRole('combobox', { name: 'Filter by label' }).selectOption('work')
  await page.getByRole('combobox', { name: 'Sort tasks', exact: true }).selectOption('title')
  await page.getByRole('button', { name: 'Save current view', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'View name' })).toBeFocused()
  await page.getByRole('textbox', { name: 'View name' }).fill('Work reports')
  await page.getByRole('button', { name: 'Save view', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save current view', exact: true })).toBeFocused()
  await page.reload()
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.locator('[data-task-id]')).toHaveCount(2)
  await page.locator('summary').filter({ hasText: 'Saved views' }).click()
  await page.getByRole('button', { name: 'Work reports Work', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Work', exact: true })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('Alpha')
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toBeFocused()
  await expect(page.getByRole('combobox', { name: 'Filter by status' })).toHaveValue('todo')
  await expect(page.getByRole('combobox', { name: 'Filter by priority' })).toHaveValue('medium')
  await expect(page.getByRole('combobox', { name: 'Filter by label' })).toHaveValue('work')
  await expect(page.getByRole('combobox', { name: 'Sort tasks', exact: true })).toHaveValue('title')
  await expect(page.locator('[data-task-id]')).toHaveCount(1)
  await page.setViewportSize({ width: 320, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: test.info().outputPath('views-320.png'), fullPage: true })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: test.info().outputPath('views-320-dark.png'), fullPage: true })
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete saved view Work reports', exact: true }).click()
  await expect(page.getByText('No saved views yet.', { exact: true })).toBeVisible()
  await expect(page.locator('summary').filter({ hasText: 'Saved views' })).toBeFocused()
  await expect(page.locator('[data-task-id]')).toHaveCount(1)
})

test('failed save preserves the name and filters for retry', async ({ page }) => {
  await fixture(page)
  await page.goto('/projects')
  await page.getByRole('button', { name: 'Save current view', exact: true }).click()
  await page.getByRole('textbox', { name: 'View name' }).fill('Reports')
  await page.route('**/api/v1/saved-task-views', async (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({
        status: 409,
        json: {
          error: { code: 'conflict', message: 'A saved view with that name already exists.' },
        },
      })
    await route.fallback()
  })
  await page.getByRole('button', { name: 'Save view', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'A saved view with that name already exists.' }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'View name' })).toHaveValue('Reports')
  await expect(page.getByRole('button', { name: 'Save view', exact: true })).toBeEnabled()
})

test('global saved filters reopen independently of selected project', async ({ page }) => {
  await fixture(page)
  await page.goto('/projects')
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('Zebra')
  await page.getByRole('button', { name: 'Save current view', exact: true }).click()
  await page.getByRole('textbox', { name: 'View name' }).fill('Every project')
  await page.getByRole('button', { name: 'Save view', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save current view', exact: true })).toBeFocused()
  await page.goto('/projects?project=work')
  await expect(page.getByRole('heading', { name: 'Work', exact: true })).toBeVisible()
  await page.locator('summary').filter({ hasText: 'Saved views' }).click()
  await page.getByRole('button', { name: 'Every project All projects', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'All tasks', exact: true })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('Zebra')
  await expect(page.locator('[data-task-id]')).toHaveCount(1)
  await expect(page.locator('[data-task-id]')).toHaveAttribute('data-task-id', 'Zebra')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete saved view Every project', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Every project All projects', exact: true }),
  ).toBeVisible()
  await page.route('**/api/v1/saved-task-views/*', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'unavailable', message: 'Try deleting again shortly.' } },
    }),
  )
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete saved view Every project', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Try deleting again shortly.' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Every project All projects', exact: true }),
  ).toBeVisible()
})

test('saved views loading failure can be retried without disturbing task filters', async ({
  page,
}) => {
  await fixture(page)
  let failed = false
  await page.route('**/api/v1/saved-task-views', async (route) => {
    if (!failed) {
      failed = true
      return route.fulfill({
        status: 503,
        json: { error: { code: 'unavailable', message: 'Saved views unavailable.' } },
      })
    }
    await route.fallback()
  })
  await page.goto('/projects')
  await expect(page.getByRole('button', { name: 'Save current view', exact: true })).toBeDisabled()
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('Alpha')
  await page.getByRole('button', { name: 'Retry saved views' }).click()
  await expect(page.getByRole('button', { name: 'Save current view', exact: true })).toBeEnabled()
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('Alpha')
})
