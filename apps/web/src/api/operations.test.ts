// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_API_URL', 'https://api.example.test')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  localStorage.clear()
})

describe('operations shared API client', () => {
  it('uses credentialed no-store GET and forwards cancellation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('true'))
    vi.stubGlobal('fetch', fetch)
    const { getOperationsCapability } = await import('./client')
    const controller = new AbortController()
    expect(await getOperationsCapability(controller.signal)).toBe(true)
    const request = fetch.mock.calls[0]![0] as Request
    expect(request.url).toBe('https://api.example.test/api/v1/operations/capability')
    expect(request.method).toBe('GET')
    expect(request.credentials).toBe('include')
    expect(request.cache).toBe('no-store')
    expect(request.headers.has('x-prosepect-user-id')).toBe(false)
    controller.abort()
    expect(request.signal.aborted).toBe(true)
  })

  it('uses shared middleware for the local development identity', async () => {
    localStorage.setItem('prosepect.development-user-id', 'development-uuid')
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const { getOperationsSnapshot } = await import('./client')
    await getOperationsSnapshot()
    const request = fetch.mock.calls[0]![0] as Request
    expect(request.headers.get('x-prosepect-user-id')).toBe('development-uuid')
  })

  it.each([401, 403, 500])('sanitizes HTTP %i before parsing provider payloads', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('secret-provider-payload', { status })),
    )
    const { ApiError, getOperationsSnapshot } = await import('./client')
    const error = await getOperationsSnapshot().catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status, message: 'Operations request failed.' })
  })
})
