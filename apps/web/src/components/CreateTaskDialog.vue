<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { X } from '@lucide/vue'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import SchedulingHelp from './SchedulingHelp.vue'
import QuickTaskForm from './QuickTaskForm.vue'
import type { Task } from '../api/types'
import { useWorkspaceStore } from '../stores/workspace'

const props = defineProps<{ defaultProjectId?: string | null }>()
const store = useWorkspaceStore()
const duplicateSource = ref<Task | undefined>()
const draftProjectId = computed(() =>
  duplicateSource.value
    ? (store.projects.find(
        (project) =>
          project.id === duplicateSource.value?.project_id && project.status !== 'archived',
      )?.id ?? null)
    : props.defaultProjectId,
)
let returnFocus: HTMLElement | null = null

const open = ref(false)
const taskForm = ref<InstanceType<typeof QuickTaskForm> | null>(null)
const draftKey = ref(0)

function openTaskDialog(source?: Task) {
  if (open.value) return
  duplicateSource.value = source ? { ...source, labels: [...source.labels] } : undefined
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  draftKey.value += 1
  open.value = true
}

async function focusTaskTitle(event: Event) {
  event.preventDefault()
  await nextTick()
  taskForm.value?.focusTitle()
}

function restoreFocus(event: Event) {
  if (returnFocus?.isConnected) {
    event.preventDefault()
    returnFocus.focus()
  }
}

defineExpose({ open: openTaskDialog })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-slate-950/30 data-[state=open]:animate-fade-in" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:p-6 outline-none dark:border-slate-800 dark:bg-slate-950"
        @open-auto-focus="focusTaskTitle"
        @close-auto-focus="restoreFocus"
      >
        <div class="flex items-start gap-4">
          <div class="min-w-0 flex-1">
            <DialogTitle class="text-lg font-semibold tracking-tight">{{
              duplicateSource ? 'Duplicate task' : 'New task'
            }}</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {{
                duplicateSource
                  ? 'Copy saved details into a fresh task, without timing, repeat rules or linked content.'
                  : 'Start with a title. Project, deadline and details are optional.'
              }}
            </DialogDescription>
          </div>
          <button class="icon-button" type="button" aria-label="Close" @click="open = false">
            <X :size="18" />
          </button>
        </div>

        <div class="mt-6">
          <QuickTaskForm
            v-if="open"
            :key="draftKey"
            ref="taskForm"
            :default-project-id="draftProjectId"
            :initial-task="duplicateSource"
            autofocus
            embedded
            @created="open = false"
          />
        </div>
        <SchedulingHelp />
        <p class="mt-4 text-right text-[11px] text-slate-400">
          <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to create
        </p>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
