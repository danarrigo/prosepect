import type { FileUsage } from './api/types'

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`
}

export function fileUploadError(size: number, usage: FileUsage): string | null {
  if (size > usage.max_file_size_bytes) {
    return `This file exceeds the ${formatBytes(usage.max_file_size_bytes)} file limit.`
  }
  const remaining = Math.max(0, usage.max_user_storage_bytes - usage.used_bytes)
  if (size > remaining) {
    return `Only ${formatBytes(remaining)} of attachment storage remains. Delete unneeded files or choose a smaller file.`
  }
  return null
}
