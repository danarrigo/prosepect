// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_API_URL', 'https://api.example.test')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  localStorage.clear()
})

it('an aborted late development bootstrap cannot restore browser identity or CSRF credentials', async () => {
  let respond!: (response: Response) => void
  const fetch = vi.fn().mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve
      }),
  )
  vi.stubGlobal('fetch', fetch)
  const api = await import('./client')
  const controller = new AbortController()
  const starting = api.startDevelopmentSession(controller.signal)
  const rejected = expect(starting).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  controller.abort()
  respond(new Response(JSON.stringify({ csrf_token: 'old-token', user: { id: 'old-account' } })))
  await rejected
  expect(localStorage.getItem('prosepect.development-user-id')).toBeNull()
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'receipt' })))
  await api.deleteTaskWithUndo('task', 3)
  const request = fetch.mock.calls[1]![0] as Request
  expect(request.headers.has('x-csrf-token')).toBe(false)
  expect(request.headers.has('x-prosepect-user-id')).toBe(false)
})
