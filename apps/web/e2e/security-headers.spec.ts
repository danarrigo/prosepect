import { expect, test } from '@playwright/test'

test('production headers contain framing and script injection while preserving signup', async ({
  page,
}) => {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'authentication_required', message: 'authentication is required' } },
    }),
  )
  const response = await page.goto('/')
  const headers = response!.headers()
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['content-security-policy']).toContain("script-src 'self'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  await expect(page.getByRole('button', { name: /sign in with google/i })).toBeDisabled()
  await page.getByRole('checkbox').check()
  await expect(page.getByRole('button', { name: /sign in with google/i })).toBeEnabled()
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.__prosepectInlineProbe = true'
    document.body.append(script)
  })
  expect(await page.evaluate('window.__prosepectInlineProbe')).toBeUndefined()
  const framingBlocked = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const frame = document.createElement('iframe')
        frame.src = '/privacy'
        frame.onload = () => resolve(frame.contentDocument === null)
        document.body.append(frame)
      }),
  )
  expect(framingBlocked).toBe(true)
})
