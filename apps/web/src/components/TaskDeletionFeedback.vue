<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { X } from '@lucide/vue'
import type { TaskDeleteUndo } from '../api/types'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const feedback = ref<HTMLElement | null>(null)
const now = ref(Date.now())
const timer = window.setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => window.clearInterval(timer))
const expired = (receipt: TaskDeleteUndo) => Date.parse(receipt.expires_at) <= now.value
const expiredCount = computed(() => store.taskDeleteUndos.filter(expired).length)

function dismiss(event: MouseEvent) {
  if (document.activeElement === event.currentTarget)
    document.getElementById('workspace-content')?.focus()
  store.dismissTaskDeletionFeedback()
}

function undo(event: MouseEvent, receipt: TaskDeleteUndo) {
  // Focus the surviving region before disabling/removing the triggering control.
  // Async responses must never steal focus from another editor.
  if (document.activeElement === event.currentTarget) feedback.value?.focus()
  void store.undoTaskDeletion(receipt)
}
</script>

<template>
  <section
    v-if="
      store.taskDeleteUndos.length ||
      store.taskDeleteMessage ||
      store.taskDeleteError ||
      store.taskDeletePending
    "
    id="task-deletion-feedback"
    ref="feedback"
    tabindex="-1"
    aria-label="Task deletion Undo"
    :aria-busy="store.taskDeletePending"
    class="rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-950 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
  >
    <div class="flex items-center gap-2">
      <p class="min-w-0 flex-1 break-words" role="status" aria-live="polite" aria-atomic="true">
        {{ store.taskDeletePending ? 'Saving task change…' : store.taskDeleteMessage }}
        <span v-if="expiredCount">{{ expiredCount }} deletion Undo expired.</span>
      </p>
      <button
        v-if="expiredCount === store.taskDeleteUndos.length"
        class="icon-button min-h-11 min-w-11 shrink-0"
        type="button"
        aria-label="Dismiss deletion feedback"
        :disabled="store.taskDeletePending"
        @click="dismiss"
      >
        <X :size="16" aria-hidden="true" />
      </button>
    </div>
    <ul
      v-if="store.taskDeleteUndos.length"
      class="mt-1 divide-y divide-slate-200 dark:divide-slate-700"
    >
      <li
        v-for="receipt in store.taskDeleteUndos"
        :key="receipt.id"
        class="flex items-center gap-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <p class="break-words">{{ receipt.task_title }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{
              expired(receipt)
                ? 'Undo expired. Task kept deleted.'
                : 'Undo available for 60 seconds after deletion.'
            }}
          </p>
        </div>
        <button
          class="secondary-button min-h-11 shrink-0"
          type="button"
          :aria-label="`Undo deletion of ${receipt.task_title}`"
          :disabled="expired(receipt) || store.saving || store.loading"
          @click="undo($event, receipt)"
        >
          Undo
        </button>
      </li>
    </ul>
    <p v-if="store.taskDeleteError" role="alert" class="mt-2 text-rose-700 dark:text-rose-300">
      {{ store.taskDeleteError }}
    </p>
    <button
      v-if="store.taskDeleteError"
      class="secondary-button mt-2 min-h-11"
      type="button"
      :disabled="store.saving || store.loading"
      @click="store.retryTaskDeletionRefresh()"
    >
      Retry refresh
    </button>
  </section>
</template>
