import { expect, test, type Page } from '@playwright/test'

test('does not render demo identity or unfinished feature placeholders', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Make today count.' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(
    /Soon|Calendar foundation comes next|Prosepect Developer/i,
  )
})

test('opens the full calendar from Today and browses months', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Calendar', level: 2 })).toBeVisible()
  await page.getByRole('button', { name: 'View month' }).click()
  await expect(page).toHaveURL(/\/calendar\?date=\d{4}-\d{2}-\d{2}/)
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible()

  const month = page.locator('section').first().getByRole('heading', { level: 2 })
  const initialMonth = await month.textContent()
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(month).not.toHaveText(initialMonth ?? '')
})

test('creates and edits a standalone task with an automatic deadline', async ({ page }) => {
  const taskName = `Standalone task ${test.info().project.name}-${Date.now().toString().slice(-6)}`
  const editedTaskName = `Edited ${taskName}`
  let cleanupName = taskName

  try {
    await page.goto('/')
    await page.keyboard.press('n')
    const dialog = page.getByRole('dialog', { name: 'New task' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Task title')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.keyboard.press('n')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Task title')).toBeFocused()
    await dialog.getByLabel('Project').selectOption('')
    await dialog.getByLabel('Task title').fill(`${taskName} tomorrow`)
    await expect(dialog.getByText('Deadline detected: Tomorrow', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Due date')).not.toHaveValue('')
    await page.keyboard.press('Control+Enter')
    await expect(dialog).toBeHidden()
    const createdTask = page.getByText(taskName, { exact: true }).locator('xpath=ancestor::article')
    await expect(createdTask).toBeVisible()
    await expect(createdTask.getByText('Tomorrow', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: `Edit ${taskName}` }).click()
    const editor = page.getByRole('form', { name: `Edit ${taskName}` })
    await editor.getByLabel('Task title').fill(editedTaskName)
    await editor.getByLabel('Edit priority').selectOption('high')
    await editor.getByLabel('Edit status').selectOption('blocked')
    await editor.getByRole('button', { name: 'Save' }).click()
    cleanupName = editedTaskName

    const editedTask = page
      .getByText(editedTaskName, { exact: true })
      .locator('xpath=ancestor::article')
    await expect(editedTask).toBeVisible()
    await expect(
      editedTask.locator('span.font-medium').filter({ hasText: 'Blocked' }),
    ).toBeVisible()
  } finally {
    await removeTestTask(page, cleanupName)
  }
})

test('manages descriptions, labels, reminders, and subtasks', async ({ page }) => {
  const suffix = `${test.info().project.name}-${Date.now().toString().slice(-6)}`
  const taskName = `Detailed task ${suffix}`
  const subtaskName = `Detailed subtask ${suffix}`
  const due = new Date()
  due.setDate(due.getDate() + 1)
  const reminder = new Date(Date.now() - 60_000)

  try {
    await page.goto('/')
    await page.keyboard.press('n')
    const dialog = page.getByRole('dialog', { name: 'New task' })
    await dialog.getByLabel('Task title').fill(taskName)
    await dialog.getByLabel('Due date').fill(localDateKey(due))
    await dialog.getByRole('button', { name: 'Details' }).click()
    await dialog.getByLabel('Description').fill('Context that survives the quick capture flow')
    await dialog.getByLabel('Reminder').fill(localDateTimeKey(reminder))
    await dialog.getByLabel('Labels').fill('E2E, Review')
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog).toBeHidden()

    const task = page.getByText(taskName, { exact: true }).locator('xpath=ancestor::article')
    await expect(task).toContainText('Context that survives the quick capture flow')
    await expect(task.getByText('e2e', { exact: true })).toBeVisible()
    await expect(task.getByText('review', { exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: taskName })).toBeVisible()
    await page.getByRole('button', { name: `Dismiss reminder for ${taskName}` }).click()

    await task.getByRole('button', { name: `Add subtask to ${taskName}` }).click()
    await task.getByPlaceholder('Subtask title').fill(subtaskName)
    await task.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText(subtaskName, { exact: true })).toBeVisible()

    await page.goto('/projects')
    await page.getByPlaceholder('Search tasks').fill(taskName)
    await expect(page.getByText(taskName, { exact: true })).toBeVisible()
    await expect(page.getByText(subtaskName, { exact: true })).toHaveCount(0)
    await page.getByLabel('Filter by label').selectOption('e2e')
    await expect(page.getByText(taskName, { exact: true })).toBeVisible()
  } finally {
    await removeTestTasks(page, [taskName, subtaskName])
  }
})

test('creates the next recurring task when an occurrence is completed', async ({ page }) => {
  const taskName = `Recurring task ${test.info().project.name}-${Date.now().toString().slice(-6)}`
  const due = new Date()
  due.setDate(due.getDate() + 1)

  try {
    await page.goto('/')
    await page.keyboard.press('n')
    const dialog = page.getByRole('dialog', { name: 'New task' })
    await dialog.getByLabel('Task title').fill(taskName)
    await dialog.getByLabel('Due date').fill(localDateKey(due))
    await dialog.getByRole('button', { name: 'Details' }).click()
    await dialog.getByLabel('Repeat').selectOption('daily')
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog).toBeHidden()

    const occurrence = page
      .getByText(taskName, { exact: true })
      .first()
      .locator('xpath=ancestor::article')
    await expect(occurrence.getByText('daily', { exact: true })).toBeVisible()
    await occurrence.getByRole('button', { name: `Complete ${taskName}` }).click()

    await page.goto('/projects')
    await page.getByPlaceholder('Search tasks').fill(taskName)
    await expect(page.getByRole('button', { name: `Complete ${taskName}` })).toBeVisible()
    await expect(page.getByText('daily', { exact: true })).toBeVisible()
    await page.getByLabel('Filter by status').selectOption('completed')
    await expect(page.getByRole('button', { name: `Mark ${taskName} incomplete` })).toBeVisible()
  } finally {
    await removeTestTasks(page, [taskName])
  }
})

test('creates a project and completes its first task', async ({ page }) => {
  const suffix = `${test.info().project.name}-${Date.now().toString().slice(-6)}`
  const projectName = `E2E journey ${suffix}`
  const taskName = `Complete vertical slice ${suffix}`
  const due = new Date()
  due.setDate(due.getDate() + 1)
  const dueDate = localDateKey(due)

  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Make today count.' })).toBeVisible()

    await page.getByRole('main').getByRole('button', { name: 'New project', exact: true }).click()
    await page.getByLabel('Project name').fill(projectName)
    await page.getByLabel('Desired outcome').fill('Verify the complete browser workflow')
    const projectCreated = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/projects') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
    )
    await page.getByRole('button', { name: 'Create project', exact: true }).click()
    await projectCreated

    await page.goto('/projects')
    await page
      .getByRole('main')
      .getByRole('button', { name: new RegExp(projectName) })
      .click()
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible()

    await page.getByRole('button', { name: 'Edit project' }).click()
    const projectEditor = page.getByRole('form', { name: 'Edit project' })
    await projectEditor
      .getByLabel('Desired outcome')
      .fill('Verify editing, progress, archive, and restore workflows')
    await projectEditor.getByLabel('Status').selectOption('active')
    await projectEditor.getByRole('button', { name: 'Save project' }).click()
    await expect(
      page.getByText('Verify editing, progress, archive, and restore workflows'),
    ).toBeVisible()

    await page.getByLabel('Task title').fill(taskName)
    await page.getByLabel('Due date').fill(dueDate)
    await page.getByRole('button', { name: /^Add(?: task)?$/ }).click()
    await expect(page.getByText(taskName, { exact: true })).toBeVisible()

    await page.goto(`/calendar?date=${dueDate}`)
    const agenda = page.locator('section').last()
    await expect(agenda.getByText(taskName, { exact: true })).toBeVisible()
    await agenda.getByRole('button', { name: `Complete ${taskName}` }).click()
    await expect(agenda.getByRole('button', { name: `Mark ${taskName} incomplete` })).toBeVisible()

    await page.goto('/projects')
    await page
      .getByRole('main')
      .getByRole('button', { name: new RegExp(projectName) })
      .click()
    await expect(page.getByText('1 of 1 tasks complete', { exact: true })).toBeVisible()
    await page.getByLabel('Filter by status').selectOption('completed')
    await expect(page.getByText(taskName, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Archive project' }).click()
    await expect(page.getByText('archived', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await expect(page.getByRole('main').getByText(projectName, { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: /Show archived/ }).click()
    await page
      .getByRole('main')
      .getByRole('button', { name: new RegExp(projectName) })
      .click()
    await page.getByRole('button', { name: 'Restore project' }).click()
    await expect(page.getByText('active', { exact: true })).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete project' }).click()
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible()
    await expect(page.getByRole('main').getByText(projectName, { exact: true })).toHaveCount(0)
  } finally {
    await removeTestProject(page, projectName)
  }
})

function localDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localDateTimeKey(value: Date) {
  return `${localDateKey(value)}T${String(value.getHours()).padStart(2, '0')}:${String(
    value.getMinutes(),
  ).padStart(2, '0')}`
}

async function removeTestTask(page: Page, taskName: string) {
  await removeTestTasks(page, [taskName])
}

async function removeTestTasks(page: Page, taskNames: string[]) {
  const userId = await page
    .evaluate(() => localStorage.getItem('prosepect.development-user-id'))
    .catch(() => null)
  if (!userId) return

  const headers = { 'x-prosepect-user-id': userId }
  const tasksResponse = await page.request.get('/api/v1/tasks?limit=100', { headers })
  if (!tasksResponse.ok()) return
  const body = (await tasksResponse.json()) as {
    items: Array<{ id: string; parent_task_id: string | null; title: string; version: number }>
  }
  const tasks = body.items
    .filter((candidate) => taskNames.includes(candidate.title))
    .sort(
      (first, second) =>
        Number(Boolean(second.parent_task_id)) - Number(Boolean(first.parent_task_id)),
    )

  for (const task of tasks) {
    await page.request.delete(`/api/v1/tasks/${task.id}?expected_version=${task.version}`, {
      headers,
    })
  }
}

async function removeTestProject(page: Page, projectName: string) {
  const userId = await page
    .evaluate(() => localStorage.getItem('prosepect.development-user-id'))
    .catch(() => null)
  if (!userId) return

  const headers = { 'x-prosepect-user-id': userId }
  const projectsResponse = await page.request.get('/api/v1/projects?limit=100', { headers })
  if (!projectsResponse.ok()) return
  const projects = (await projectsResponse.json()) as {
    items: Array<{ id: string; name: string; version: number }>
  }
  const project = projects.items.find((candidate) => candidate.name === projectName)
  if (!project) return

  const tasksResponse = await page.request.get(`/api/v1/tasks?project_id=${project.id}&limit=100`, {
    headers,
  })
  if (tasksResponse.ok()) {
    const tasks = (await tasksResponse.json()) as {
      items: Array<{ id: string; version: number }>
    }
    for (const task of tasks.items) {
      await page.request.delete(`/api/v1/tasks/${task.id}?expected_version=${task.version}`, {
        headers,
      })
    }
  }

  await page.request.delete(`/api/v1/projects/${project.id}?expected_version=${project.version}`, {
    headers,
  })
}
