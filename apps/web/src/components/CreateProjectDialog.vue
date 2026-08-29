<script setup lang="ts">
import { ref } from 'vue'
import { Plus, X } from '@lucide/vue'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const open = ref(false)
const name = ref('')
const outcome = ref('')
const targetDate = ref('')

async function submit() {
  if (!name.value.trim() || store.saving) return
  try {
    await store.addProject({
      name: name.value.trim(),
      outcome: outcome.value.trim(),
      target_date: targetDate.value || null,
      status: 'active',
    })
    name.value = ''
    outcome.value = ''
    targetDate.value = ''
    open.value = false
  } catch {
    // The workspace error banner keeps the dialog open so the user can retry.
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger as-child>
      <button class="primary-button" type="button">
        <Plus :size="16" />
        New project
      </button>
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-slate-950/30 data-[state=open]:animate-fade-in" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-slate-200 bg-white p-6 shadow-xl outline-none dark:border-slate-800 dark:bg-slate-950"
      >
        <div class="flex items-start gap-4">
          <div class="min-w-0 flex-1">
            <DialogTitle class="text-lg font-semibold tracking-tight">New project</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Define a clear outcome.
            </DialogDescription>
          </div>
          <button class="icon-button" type="button" aria-label="Close" @click="open = false">
            <X :size="18" />
          </button>
        </div>

        <form class="mt-6 space-y-4" @submit.prevent="submit">
          <label class="field-label">
            Project name
            <input
              v-model="name"
              class="field-input"
              maxlength="120"
              required
              autofocus
              placeholder="Project name"
            />
          </label>
          <label class="field-label">
            Desired outcome
            <textarea
              v-model="outcome"
              class="field-input min-h-24 resize-y py-3"
              maxlength="2000"
              placeholder="What does done look like?"
            />
          </label>
          <label class="field-label">
            Target date
            <input v-model="targetDate" class="field-input" type="date" />
          </label>
          <p
            v-if="store.error"
            class="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
            role="alert"
          >
            {{ store.error }}
          </p>
          <div class="flex justify-end gap-2 pt-2">
            <button class="secondary-button" type="button" @click="open = false">Cancel</button>
            <button class="primary-button" type="submit" :disabled="!name.trim() || store.saving">
              {{ store.saving ? 'Creating…' : 'Create project' }}
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
