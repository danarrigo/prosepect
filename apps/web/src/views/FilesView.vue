<script setup lang="ts">
import { ref } from 'vue'
import { Download, FileUp, Trash2 } from '@lucide/vue'
import { apiUrl } from '../api/client'
import type { FileRecord } from '../api/types'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const uploading = ref(false)
const error = ref('')

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  error.value = ''
  try {
    await store.addFile(file)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Upload failed'
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function remove(file: FileRecord) {
  if (window.confirm(`Delete “${file.filename}”?`)) await store.removeFile(file)
}

function fileContext(file: FileRecord) {
  if (file.project_id) return 'Project attachment'
  if (file.task_id) return 'Task attachment'
  if (file.note_id) return 'Note attachment'
  if (file.event_id) return 'Event attachment'
  return 'Workspace file'
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
    <div class="flex items-end justify-between gap-4">
      <div>
        <h1 class="page-title !mt-0">Files</h1>
        <p class="page-description">
          Private attachments stored in your configured object storage.
        </p>
      </div>
      <label class="primary-button cursor-pointer">
        <FileUp :size="16" /> {{ uploading ? 'Uploading…' : 'Upload file' }}
        <input class="sr-only" type="file" :disabled="uploading" @change="upload" />
      </label>
    </div>
    <p v-if="error" class="mt-5 text-sm text-rose-600">{{ error }}</p>

    <div class="mt-10 border-y border-slate-200 dark:border-slate-800">
      <div
        v-for="file in store.files"
        :key="file.id"
        class="flex items-center gap-4 border-b border-slate-100 px-2 py-4 last:border-0 dark:border-slate-900"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ file.filename }}</p>
          <p class="mt-1 text-xs text-slate-400">
            {{ bytes(file.byte_size) }} · {{ fileContext(file) }} ·
            {{ new Date(file.created_at).toLocaleDateString() }}
          </p>
        </div>
        <a
          class="icon-button"
          :href="apiUrl(`/api/v1/files/${file.id}/download`)"
          :download="file.filename"
          :aria-label="`Download ${file.filename}`"
        >
          <Download :size="16" />
        </a>
        <button
          class="icon-button hover:!text-rose-600"
          type="button"
          :aria-label="`Delete ${file.filename}`"
          @click="remove(file)"
        >
          <Trash2 :size="16" />
        </button>
      </div>
      <p v-if="!store.files.length" class="py-16 text-center text-sm text-slate-400">
        No files uploaded.
      </p>
    </div>
  </div>
</template>
