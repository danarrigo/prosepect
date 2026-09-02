<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Search, X } from '@lucide/vue'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { keyboardCommands, type KeyboardCommandId } from '../keyboard'

const props = defineProps<{ open: boolean; mode: 'commands' | 'help' }>()
const emit = defineEmits<{ close: []; select: [command: KeyboardCommandId] }>()
const query = ref('')
const selectedIndex = ref(0)
const input = ref<HTMLInputElement | null>(null)

const visibleCommands = computed(() => {
  const value = query.value.trim().toLowerCase()
  if (!value) return keyboardCommands
  return keyboardCommands.filter((command) =>
    `${command.label} ${command.group} ${command.keywords}`.toLowerCase().includes(value),
  )
})

const helpRows = computed(() => [
  ...keyboardCommands,
  {
    id: 'command-palette',
    label: 'Open command palette',
    group: 'Actions' as const,
    shortcut: ['Ctrl/⌘', 'K'],
  },
  {
    id: 'shortcut-help',
    label: 'Show keyboard shortcuts',
    group: 'Actions' as const,
    shortcut: ['?'],
  },
  {
    id: 'close',
    label: 'Close or cancel',
    group: 'Actions' as const,
    shortcut: ['Esc'],
  },
  {
    id: 'calendar-move',
    label: 'Move focused calendar block by 15 minutes',
    group: 'Calendar' as const,
    shortcut: ['Alt', '↑/↓'],
  },
  {
    id: 'calendar-resize',
    label: 'Resize focused calendar block by 15 minutes',
    group: 'Calendar' as const,
    shortcut: ['Shift', '↑/↓'],
  },
])

watch(
  () => props.open,
  (open) => {
    if (!open) return
    query.value = ''
    selectedIndex.value = 0
  },
)

watch(visibleCommands, () => {
  selectedIndex.value = 0
})

async function focusPalette(event: Event) {
  if (props.mode !== 'commands') return
  event.preventDefault()
  await nextTick()
  input.value?.focus()
}

function moveSelection(offset: number) {
  if (!visibleCommands.value.length) return
  selectedIndex.value =
    (selectedIndex.value + offset + visibleCommands.value.length) % visibleCommands.value.length
}

function selectCurrent() {
  const command = visibleCommands.value[selectedIndex.value]
  if (command) emit('select', command.id)
}

function handleKeydown(event: KeyboardEvent) {
  if (props.mode !== 'commands') return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveSelection(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveSelection(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    selectCurrent()
  }
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="!$event && emit('close')">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[80] bg-slate-950/35 backdrop-blur-[1px]" />
      <DialogContent
        class="fixed left-1/2 top-[16vh] z-[81] max-h-[70vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden border border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-800 dark:bg-slate-950"
        :aria-label="props.mode === 'commands' ? 'Command palette' : 'Keyboard shortcuts'"
        @open-auto-focus="focusPalette"
        @keydown="handleKeydown"
      >
        <div
          class="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800"
        >
          <div>
            <DialogTitle class="text-sm font-semibold">
              {{ props.mode === 'commands' ? 'Command palette' : 'Keyboard shortcuts' }}
            </DialogTitle>
            <DialogDescription class="mt-1 text-xs text-slate-400">
              {{
                props.mode === 'commands'
                  ? 'Navigate and act without leaving the keyboard.'
                  : 'Shortcuts pause while you type in a field.'
              }}
            </DialogDescription>
          </div>
          <button
            class="icon-button !size-7"
            type="button"
            aria-label="Close"
            @click="emit('close')"
          >
            <X :size="15" />
          </button>
        </div>

        <template v-if="props.mode === 'commands'">
          <label class="relative block border-b border-slate-200 dark:border-slate-800">
            <span class="sr-only">Search commands</span>
            <Search
              class="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400"
              :size="17"
            />
            <input
              ref="input"
              v-model="query"
              class="h-12 w-full bg-transparent pl-12 pr-5 text-sm outline-none placeholder:text-slate-400"
              type="text"
              placeholder="Search commands"
              autocomplete="off"
            />
          </label>
          <div class="max-h-[50vh] overflow-y-auto p-2" role="listbox" aria-label="Commands">
            <button
              v-for="(command, index) in visibleCommands"
              :key="command.id"
              class="flex w-full items-center gap-4 px-3 py-2.5 text-left text-sm transition"
              :class="
                selectedIndex === index
                  ? 'bg-slate-100 text-slate-950 dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300'
              "
              type="button"
              role="option"
              :aria-selected="selectedIndex === index"
              @mousemove="selectedIndex = index"
              @click="emit('select', command.id)"
            >
              <span class="min-w-0 flex-1 truncate">{{ command.label }}</span>
              <span class="flex shrink-0 items-center gap-1">
                <kbd v-for="key in command.shortcut" :key="key">{{ key }}</kbd>
              </span>
            </button>
            <p v-if="!visibleCommands.length" class="px-3 py-8 text-center text-sm text-slate-400">
              No matching commands.
            </p>
          </div>
          <p
            class="border-t border-slate-200 px-5 py-3 text-[11px] text-slate-400 dark:border-slate-800"
          >
            <kbd>↑</kbd>/<kbd>↓</kbd> select · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close
          </p>
        </template>

        <div v-else class="max-h-[55vh] overflow-y-auto p-3">
          <div
            v-for="group in ['Navigation', 'Actions', 'Calendar']"
            :key="group"
            class="mb-5 last:mb-0"
          >
            <h3 class="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {{ group }}
            </h3>
            <div class="divide-y divide-slate-100 dark:divide-slate-900">
              <div
                v-for="command in helpRows.filter((item) => item.group === group)"
                :key="command.id"
                class="flex items-center gap-4 px-2 py-2.5 text-sm"
              >
                <span class="min-w-0 flex-1">{{ command.label }}</span>
                <span class="flex shrink-0 items-center gap-1">
                  <kbd v-for="key in command.shortcut" :key="key">{{ key }}</kbd>
                </span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
