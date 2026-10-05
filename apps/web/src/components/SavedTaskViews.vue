<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Trash2 } from '@lucide/vue'
import { createSavedTaskView, deleteSavedTaskView, listSavedTaskViews } from '../api/client'
import type { CreateSavedTaskView, Project, SavedTaskView } from '../api/types'

const props = defineProps<{ filters: Omit<CreateSavedTaskView, 'name'>; projects: Project[] }>()
const emit = defineEmits<{ open: [view: SavedTaskView] }>()
const views = ref<SavedTaskView[]>([])
const availableViews = computed(() =>
  views.value.filter(
    (view) => !view.project_id || props.projects.some((project) => project.id === view.project_id),
  ),
)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const loaded = ref(false)
const editing = ref(false)
const name = ref('')
const announcement = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const saveButton = ref<HTMLButtonElement | null>(null)
const summary = ref<HTMLElement | null>(null)
const details = ref<HTMLDetailsElement | null>(null)
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())
onMounted(load)

async function load() {
  if (busy.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await listSavedTaskViews(controller.signal)
    controller.signal.throwIfAborted()
    if (!Array.isArray(result)) throw new Error('Saved views could not be loaded.')
    views.value = result
    loaded.value = true
  } catch (cause) {
    if (!controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : 'Saved views could not be loaded.'
  } finally {
    loading.value = false
  }
}

async function begin() {
  editing.value = true
  await nextTick()
  nameInput.value?.focus()
}

async function close() {
  editing.value = false
  name.value = ''
  await nextTick()
  saveButton.value?.focus()
}

async function save() {
  if (busy.value || !name.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    const saved = await createSavedTaskView(
      { ...props.filters, name: name.value.trim() },
      controller.signal,
    )
    controller.signal.throwIfAborted()
    views.value = [...views.value, saved].sort((a, b) => a.name.localeCompare(b.name))
    if (details.value) details.value.open = true
    announcement.value = `Saved ${saved.name}.`
    busy.value = false
    await close()
  } catch (cause) {
    if (!controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : 'The view could not be saved.'
  } finally {
    busy.value = false
  }
}

async function remove(view: SavedTaskView) {
  if (
    busy.value ||
    !window.confirm(`Delete saved view “${view.name}”? Your tasks will not be deleted.`)
  )
    return
  busy.value = true
  error.value = ''
  const focused = document.activeElement
  try {
    await deleteSavedTaskView(view.id, controller.signal)
    controller.signal.throwIfAborted()
    views.value = views.value.filter((item) => item.id !== view.id)
    announcement.value = `Deleted saved view ${view.name}.`
    await nextTick()
    if (focused && !focused.isConnected && document.activeElement === document.body)
      summary.value?.focus()
  } catch (cause) {
    if (!controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : 'The saved view could not be deleted.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section
    class="my-6 min-w-0 border-y border-slate-200 py-4 dark:border-slate-800"
    aria-label="Saved task views"
  >
    <details ref="details">
      <summary ref="summary" class="cursor-pointer text-sm font-medium">Saved views</summary>
      <p v-if="loading" class="mt-3 text-sm text-slate-400" role="status">Loading saved views…</p>
      <p v-else-if="loaded && !availableViews.length" class="mt-3 text-sm text-slate-400">
        No saved views yet.
      </p>
      <ul v-else class="mt-3 max-h-64 space-y-1 overflow-y-auto">
        <li v-for="view in availableViews" :key="view.id" class="flex items-center gap-2">
          <button
            type="button"
            class="min-w-0 flex-1 rounded px-2 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-900"
            :disabled="busy"
            @click="emit('open', view)"
          >
            <span class="block [overflow-wrap:anywhere]">{{ view.name }}</span>
            <span class="text-xs text-slate-400">{{
              view.project_id
                ? (projects.find((project) => project.id === view.project_id)?.name ??
                  'Unavailable project')
                : 'All projects'
            }}</span>
          </button>
          <button
            type="button"
            class="icon-button shrink-0"
            :aria-label="`Delete saved view ${view.name}`"
            :disabled="busy"
            @click="remove(view)"
          >
            <Trash2 :size="15" />
          </button>
        </li>
      </ul>
    </details>
    <div v-if="error" class="mt-3 text-sm" role="alert">
      {{ error }}
      <button
        v-if="!loaded"
        type="button"
        class="secondary-button ml-2"
        :disabled="loading"
        @click="load"
      >
        Retry saved views
      </button>
    </div>
    <form v-if="editing" class="mt-4 space-y-3" aria-label="Save task view" @submit.prevent="save">
      <label class="field-label"
        >View name<input
          ref="nameInput"
          v-model="name"
          class="field-input"
          required
          maxlength="80"
          :disabled="busy"
      /></label>
      <div class="flex flex-wrap gap-2">
        <button type="submit" class="primary-button" :disabled="busy || !name.trim()">
          Save view
        </button>
        <button type="button" class="secondary-button" :disabled="busy" @click="close">
          Cancel
        </button>
      </div>
    </form>
    <button
      v-else
      ref="saveButton"
      type="button"
      class="secondary-button mt-3"
      :disabled="busy || !loaded"
      @click="begin"
    >
      Save current view
    </button>
    <p class="sr-only" role="status">{{ announcement }}</p>
  </section>
</template>
