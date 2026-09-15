import { expect, test, type Page } from '@playwright/test'

const projectName = 'CustomerSuccessMigration'.repeat(5)
const taskTitle = 'Prepare launch checklist and collect final reviews from all stakeholders'
const longLabel = 'cross-functional-customer-success-launch-readiness'
const now = '2026-09-01T08:00:00Z'

async function mockWorkspace(page: Page, populated = true) {
  await page.clock.setFixedTime(new Date(now))
  const projects = populated
    ? [
        {
          id: 'project-1',
          name: projectName,
          outcome: 'Coordinate engineering, customer success and finance for the autumn launch.',
          status: 'active',
          target_date: '2026-09-30',
          total_tasks: 2,
          completed_tasks: 0,
          color: '#64748b',
          version: 1,
        },
      ]
    : []
  const tasks = populated
    ? ['in_progress', 'blocked'].map((status, index) => ({
        id: `task-${index}`,
        project_id: 'project-1',
        parent_task_id: null,
        title: index ? 'Review customer readiness documentation' : taskTitle,
        description: 'Confirm owners and collect approvals.',
        status,
        priority: index ? 'urgent' : 'high',
        due_at: '2026-09-01T17:00:12.345Z',
        scheduled_start: null,
        scheduled_end: null,
        recurrence: 'none',
        labels: [longLabel],
        remind_at: null,
        completed_at: null,
        created_at: now,
        updated_at: now,
        position: (index + 1) * 1024,
        version: 1,
      }))
    : []
  page.on('pageerror', (error) => {
    throw error
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:5173') {
      await route.abort()
      throw new Error(`Unexpected external request: ${url.origin}`)
    }
    if (!url.pathname.startsWith('/api/v1/')) return route.fallback()
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
    else if (/^\/(tasks|projects)\//.test(path) && route.request().method() === 'PUT') {
      const item = [...tasks, ...projects].find((item) => item.id === path.split('/').at(-1))!
      Object.assign(item, route.request().postDataJSON(), { version: item.version + 1 })
      body = item
    } else if (path === '/tasks') body = { items: tasks }
    else if (path === '/projects') body = { items: projects }
    await route.fulfill({ json: body })
  })
  return { tasks, projects }
}

async function measure(page: Page, label: string) {
  const bounds = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    outside: [
      ...document.querySelectorAll(
        'main input, main select, main button, [role=dialog] input, [role=dialog] button, [role=dialog] select',
      ),
    ]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width && (r.left < -1 || r.right > innerWidth + 1)
      })
      .map((el) => ({
        label: el.getAttribute('aria-label') ?? el.textContent?.trim(),
        width: el.getBoundingClientRect().width,
      })),
  }))
  console.log(JSON.stringify({ label, ...bounds }))
  expect.soft(bounds.pageWidth, label).toBeLessThanOrEqual(bounds.viewport)
  expect.soft(bounds.outside, label).toEqual([])
}

test.use({ timezoneId: 'UTC', locale: 'en-US' })
for (const colorScheme of ['light', 'dark'] as const) {
  for (const populated of [true, false]) {
    test(`tasks and projects matrix ${colorScheme} ${populated ? 'populated' : 'empty'}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000)
      await page.emulateMedia({ colorScheme })
      await mockWorkspace(page, populated)
      for (const width of testInfo.project.use.isMobile ? [320, 375] : [768, 1280, 1600]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto('/')
        await expect(
          page.getByRole('heading', { name: 'Make today count.', exact: true }),
        ).toBeVisible()
        await page.screenshot({
          path: testInfo.outputPath(`today-tasks-${width}.png`),
          scale: 'css',
          fullPage: true,
        })
        await measure(page, `today-tasks-${width}`)
        await page.goto('/projects')
        await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
        await page.screenshot({
          scale: 'css',
          path: testInfo.outputPath(`projects-${width}.png`),
          fullPage: true,
        })
        await measure(page, `projects-${width}`)
        await page.getByRole('button', { name: 'New project', exact: true }).click()
        const creation = page.getByRole('dialog', { name: 'New project', exact: true })
        await expect(creation.getByLabel('Project name')).toBeFocused()
        await expect(
          creation.getByRole('button', { name: 'Create project', exact: true }),
        ).toBeDisabled()
        await creation.getByLabel('Project name').fill(projectName)
        await page.screenshot({
          scale: 'css',
          path: testInfo.outputPath(`create-project-${width}.png`),
        })
        await measure(page, `create-project-${width}`)
        await page.keyboard.press('Escape')
        if (populated) {
          await page.locator('main').getByRole('button').filter({ hasText: projectName }).click()
          await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible()
          await page.screenshot({
            scale: 'css',
            path: testInfo.outputPath(`project-detail-${width}.png`),
            fullPage: true,
          })
          await measure(page, `project-detail-${width}`)
          await page.getByRole('button', { name: 'Edit project', exact: true }).click()
          await page.screenshot({
            scale: 'css',
            path: testInfo.outputPath(`project-editor-${width}.png`),
            fullPage: true,
          })
          await measure(page, `project-editor-${width}`)
          await page
            .getByRole('form', { name: 'Edit project', exact: true })
            .getByRole('button', { name: 'Cancel', exact: true })
            .click()
          const edit = page.getByRole('button', { name: `Edit ${taskTitle}`, exact: true })
          await edit.scrollIntoViewIfNeeded()
          if (testInfo.project.use.isMobile) await edit.tap()
          else {
            await edit.focus()
            await page.keyboard.press('Enter')
          }
          const form = page.getByRole('form', { name: `Edit ${taskTitle}`, exact: true })
          await expect(form).toBeVisible()
          await page.screenshot({
            scale: 'css',
            path: testInfo.outputPath(`task-editor-${width}.png`),
            fullPage: true,
          })
          await measure(page, `task-editor-${width}`)
          const editorBounds = await form.evaluate((el) => ({
            width: el.clientWidth,
            content: el.scrollWidth,
          }))
          console.log(JSON.stringify({ width, editorBounds }))
          expect.soft(editorBounds.content).toBeLessThanOrEqual(editorBounds.width)
          await form.getByRole('button', { name: 'Cancel', exact: true }).click()
        }
        await page.keyboard.press('n')
        const taskCreation = page.getByRole('dialog', { name: 'New task', exact: true })
        await expect(taskCreation).toBeVisible()
        await expect(
          taskCreation.getByRole('button', { name: 'Create task', exact: true }),
        ).toBeDisabled()
        await expect(taskCreation).not.toContainText(
          'Only a title is required. A deadline does not reserve work time.',
        )
        await expect(taskCreation).not.toContainText('Enter a task title to create it.')
        await taskCreation.getByLabel('Task title', { exact: true }).fill(taskTitle)
        await taskCreation.getByRole('button', { name: 'Details', exact: true }).click()
        await page.screenshot({
          scale: 'css',
          path: testInfo.outputPath(`create-task-${width}.png`),
          fullPage: true,
        })
        await measure(page, `create-task-${width}`)
        await page.keyboard.press('Escape')
      }
    })
  }
}

test('project actions and task metadata remain usable by keyboard and touch', async ({
  page,
}, testInfo) => {
  const { tasks, projects } = await mockWorkspace(page)
  await page.goto('/projects?project=project-1')
  const row = page.locator('[data-task-id="task-0"]')
  await expect(row).toContainText('In progress')
  await expect(row).toContainText('high')
  await expect(row).toContainText('Today')
  const edit = row.getByRole('button', { name: `Edit ${taskTitle}`, exact: true })
  if (testInfo.project.use.isMobile) await edit.tap()
  else {
    await row.hover()
    await edit.focus()
    await page.keyboard.press('Enter')
  }
  const form = page.getByRole('form', { name: `Edit ${taskTitle}`, exact: true })
  await form.getByLabel('Task title', { exact: true }).fill('Updated launch checklist')
  await form.getByLabel('Edit status', { exact: true }).selectOption('blocked')
  await form.getByLabel('Edit priority', { exact: true }).selectOption('urgent')
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(form).toBeHidden()
  expect(tasks[0]).toMatchObject({
    title: 'Updated launch checklist',
    status: 'blocked',
    priority: 'urgent',
    due_at: '2026-09-01T17:00:12.345Z',
    scheduled_start: null,
    scheduled_end: null,
  })
  await page.getByRole('button', { name: 'Archive project', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restore project', exact: true })).toBeVisible()
  expect(projects[0]?.status).toBe('archived')
  await page.getByRole('button', { name: 'Restore project', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Archive project', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
})

test('project creation keeps required name validation and saves optional metadata', async ({
  page,
}) => {
  const { projects } = await mockWorkspace(page, false)
  await page.route('**/api/v1/projects', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const project = {
      ...route.request().postDataJSON(),
      id: 'created-project',
      color: '#64748b',
      total_tasks: 0,
      completed_tasks: 0,
      version: 1,
    }
    projects.push(project)
    await route.fulfill({ json: project })
  })
  await page.goto('/projects')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'New project', exact: true })
  const name = form.getByLabel('Project name', { exact: true })
  await expect(name).toBeFocused()
  await name.fill('   ')
  await expect(form.getByRole('button', { name: 'Create project', exact: true })).toBeDisabled()
  await name.fill('Launch coordination')
  await form.getByLabel('Desired outcome', { exact: true }).fill('Ready for launch')
  await form.getByLabel('Target date', { exact: true }).fill('2026-09-30')
  await form.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(form).toBeHidden()
  expect(projects[0]).toMatchObject({
    name: 'Launch coordination',
    outcome: 'Ready for launch',
    target_date: '2026-09-30',
    status: 'active',
  })
})
