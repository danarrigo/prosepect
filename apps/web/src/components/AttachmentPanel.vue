<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download, Paperclip, Trash2 } from '@lucide/vue'
import type { FileRecord } from '../api/types'
import { useWorkspaceStore } from '../stores/workspace'

const props = defineProps<{
  kind: 'project' | 'task' | 'note' | 'event'
  parentId: string
}>()
const store = useWorkspaceStore()
const uploading = ref(false)
const error = ref('')
const idField = computed(() => `${props.kind}_id` as const)
const attachments = computed(() =>
  store.files.filter((file) => file[idField.value] === props.parentId),
)

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  error.value = ''
  try {
    await store.addFile(file, { [idField.value]: props.parentId })
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
</script>

<template>
  <section class="border-t border-slate-100 pt-4 dark:border-slate-900" aria-label="Attachments">
    <div class="flex items-center justify-between gap-3">
      <span class="field-label !mb-0">Attachments</span>
      <label class="secondary-button cursor-pointer !h-8 !px-3 !text-xs">
        <Paperclip :size="14" /> {{ uploading ? 'Uploading…' : 'Attach file' }}
        <input class="sr-only" type="file" :disabled="uploading" @change="upload" />
      </label>
    </div>
    <p v-if="error" class="mt-2 text-xs text-rose-600">{{ error }}</p>
    <div class="mt-2 space-y-1">
      <div
        v-for="file in attachments"
        :key="file.id"
        class="flex items-center rounded-md px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-900"
      >
        <span class="min-w-0 flex-1 truncate">{{ file.filename }}</span>
        <a
          class="icon-button !size-7"
          :href="`/api/v1/files/${file.id}/download`"
          :download="file.filename"
          :aria-label="`Download ${file.filename}`"
          ><Download :size="13"
        /></a>
        <button
          class="icon-button !size-7 hover:!text-rose-600"
          type="button"
          :aria-label="`Delete ${file.filename}`"
          @click="remove(file)"
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </div>
  </section>
</template>
