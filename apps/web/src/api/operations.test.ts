// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import { getOperationsCapability, getOperationsSnapshot } from './operations'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('operations API seam', () => {
  it('uses credentialed no-store GET and forwards cancellation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('true'))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    expect(await getOperationsCapability(controller.signal)).toBe(true)
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/operations/capability',
      expect.objectContaining({
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      }),
    )
    const headers = fetch.mock.calls[0]![1].headers as Headers
    expect(headers.has('x-prosepect-user-id')).toBe(false)
  })

  it('preserves existing local development identity behavior', async () => {
    localStorage.setItem('prosepect.development-user-id', 'development-uuid')
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    await getOperationsSnapshot()
    expect((fetch.mock.calls[0]![1].headers as Headers).get('x-prosepect-user-id')).toBe(
      'development-uuid',
    )
  })

  it.each([401, 403, 500])(
    'sanitizes HTTP %i without reading provider payloads',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('secret-provider-payload', { status })),
      )
      const error = await getOperationsSnapshot().catch((cause: unknown) => cause)
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status, message: 'Operations request failed.' })
    },
  )
})
