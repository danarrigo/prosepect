import { describe, expect, it, vi } from 'vitest'
import { collectCursorPages } from './pagination'

describe('collectCursorPages', () => {
  it('collects records beyond the first API page', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 50 }, (_, index) => index),
        next_cursor: 'page-2',
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 25 }, (_, index) => index + 50),
        next_cursor: null,
      })

    const items = await collectCursorPages(loadPage)

    expect(items).toHaveLength(75)
    expect(items.at(-1)).toBe(74)
    expect(loadPage).toHaveBeenNthCalledWith(1, undefined)
    expect(loadPage).toHaveBeenNthCalledWith(2, 'page-2')
  })

  it('rejects a repeated cursor instead of looping forever', async () => {
    const loadPage = vi.fn().mockResolvedValue({ items: [], next_cursor: 'same-page' })

    await expect(collectCursorPages(loadPage)).rejects.toThrow('repeated pagination cursor')
  })
})
