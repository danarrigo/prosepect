import { expect, test } from '@playwright/test'

// Real isolated CI backend, no route interception or Google credentials.
// Provider reconciliation is exercised separately by the Rust/Postgres tests;
// this verifies the browser/HTTP permission and configuration boundary.
test('real backend: Tasks stays opt-in and refuses unauthorized copying', async ({
  page,
  playwright,
  baseURL,
}) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  const panel = page.getByRole('region', { name: 'Google Tasks', exact: true })
  await expect(panel.getByRole('link', { name: 'Connect Google Tasks' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Enable Tasks sync' })).toHaveCount(0)
  await expect(panel.getByRole('link', { name: 'Privacy Policy' })).toBeVisible()

  const user = await page.evaluate(() => localStorage.getItem('prosepect.development-user-id'))
  expect(user).toBeTruthy()
  const sessionResponse = await page.request.get('/api/v1/session')
  expect(sessionResponse.status()).toBe(200)
  const session = await sessionResponse.json()
  expect(session.user.id).toBe(user)
  const headers = { 'x-csrf-token': session.csrf_token as string }
  const path = '/api/v1/integrations/google/tasks'
  const initial = await page.request.get(path, { headers })
  expect(initial.status()).toBe(200)
  expect(await initial.json()).toMatchObject({ authorized: false, enabled: false, version: 0 })
  for (const resource of ['conflicts', 'recoveries']) {
    const response = await page.request.get(`${path}/${resource}`, { headers })
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual([])
  }
  const enable = await page.request.put(path, {
    headers,
    data: { enabled: true, expected_version: 0, task_list_id: 'unverified', timezone: 'UTC' },
  })
  expect(enable.status()).toBe(403)
  expect((await page.request.post(`${path}/sync`, { headers })).status()).toBe(409)
  expect(
    (await page.request.post(`${path}/lists`, { headers, data: { expected_version: 0 } })).status(),
  ).toBe(403)

  const disabled = await page.request.put(path, {
    headers,
    data: { enabled: false, expected_version: 0 },
  })
  expect(disabled.status()).toBe(200)
  expect(await disabled.json()).toMatchObject({ enabled: false, version: 1 })
  const stale = await page.request.put(path, {
    headers,
    data: { enabled: false, expected_version: 0 },
  })
  expect(stale.status()).toBe(409)
  const noCsrf = await page.request.put(path, { data: { enabled: false, expected_version: 1 } })
  expect(noCsrf.status()).toBe(403)

  const anonymous = await playwright.request.newContext({ baseURL })
  try {
    for (const resource of ['', '/conflicts', '/recoveries']) {
      expect((await anonymous.get(path + resource)).status()).toBe(401)
    }
  } finally {
    await anonymous.dispose()
  }
  await page.reload()
  await expect(panel.getByRole('link', { name: 'Connect Google Tasks' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Enable Tasks sync' })).toHaveCount(0)
  const retained = await page.request.get(path, { headers })
  expect(retained.status()).toBe(200)
  expect(await retained.json()).toMatchObject({ authorized: false, enabled: false, version: 1 })
})
