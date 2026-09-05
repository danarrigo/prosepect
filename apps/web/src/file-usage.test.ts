import { describe, expect, it } from 'vitest'
import { fileUploadError, formatBytes } from './file-usage'

describe('file usage feedback', () => {
  it('formats configured byte limits and blocks oversized uploads before request', () => {
    expect(formatBytes(10)).toBe('10 B')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(
      fileUploadError(6, {
        used_bytes: 8,
        max_user_storage_bytes: 10,
        max_file_size_bytes: 5,
      }),
    ).toContain('5 B file limit')
    expect(
      fileUploadError(3, {
        used_bytes: 8,
        max_user_storage_bytes: 10,
        max_file_size_bytes: 5,
      }),
    ).toContain('Only 2 B')
  })
})
