<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Search, X } from '@lucide/vue'
import { useRouter } from 'vue-router'
import * as api from '../api/client'
import type { SearchResult } from '../api/types'

const router = useRouter()
const query = ref('')
const results = ref<SearchResult[]>([])
const open = ref(false)
const loading = ref(false)
const selectedIndex = ref(0)
const container = ref<HTMLElement>()
const input = ref<HTMLInputElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

watch(query, (value) => {
  if (timer) clearTimeout(timer)
  if (!value.trim()) {
    results.value = []
    return
  }
  timer = setTimeout(async () => {
    loading.value = true
    try {
      results.value = await api.search(value)
      selectedIndex.value = 0
      open.value = true
    } finally {
      loading.value = false
    }
  }, 180)
})

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerDown))

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
})

function choose(result: SearchResult) {
  open.value = false
  query.value = ''
  if (result.kind === 'note') void router.push({ path: '/notes', query: { note: result.id } })
  else if (result.kind === 'event') void router.push('/calendar')
  else if (result.kind === 'project') {
    void router.push({ path: '/projects', query: { project: result.id } })
  } else void router.push({ path: '/projects', query: { search: result.title } })
}

function clear() {
  query.value = ''
  results.value = []
  selectedIndex.value = 0
  open.value = false
}

function moveSelection(offset: number) {
  if (!results.value.length) return
  open.value = true
  selectedIndex.value = (selectedIndex.value + offset + results.value.length) % results.value.length
}

function chooseSelected() {
  const result = results.value[selectedIndex.value]
  if (open.value && result) choose(result)
}

async function focusSearch() {
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (event.target instanceof Node && !container.value?.contains(event.target)) clear()
}

defineExpose({ focus: focusSearch })
</script>

<template>
  <div ref="container" class="relative hidden sm:block" @keydown.esc="clear">
    <label class="relative block">
      <span class="sr-only">Search workspace</span>
      <Search
        class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
        :size="15"
      />
      <input
        ref="input"
        v-model="query"
        class="h-8 w-44 rounded-md border border-slate-200 bg-transparent pl-8 pr-7 text-xs outline-none transition focus:w-64 focus:border-slate-400 dark:border-slate-800 dark:focus:border-slate-600"
        type="search"
        placeholder="Search workspace"
        autocomplete="off"
        aria-autocomplete="list"
        :aria-expanded="open"
        @focus="open = Boolean(query)"
        @keydown.down.prevent="moveSelection(1)"
        @keydown.up.prevent="moveSelection(-1)"
        @keydown.enter.prevent="chooseSelected"
      />
      <button
        v-if="query"
        class="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400"
        type="button"
        aria-label="Clear search"
        @click="clear"
      >
        <X :size="14" />
      </button>
    </label>
    <div
      v-if="open"
      class="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950"
      role="listbox"
      aria-label="Search results"
    >
      <p v-if="loading" class="px-4 py-5 text-xs text-slate-400">Searching…</p>
      <button
        v-for="(result, index) in results"
        v-else
        :key="`${result.kind}:${result.id}`"
        class="block w-full border-b border-slate-100 px-4 py-3 text-left last:border-0 dark:border-slate-900"
        :class="
          selectedIndex === index
            ? 'bg-slate-50 dark:bg-slate-900'
            : 'hover:bg-slate-50 dark:hover:bg-slate-900'
        "
        type="button"
        role="option"
        :aria-selected="selectedIndex === index"
        @mousemove="selectedIndex = index"
        @click="choose(result)"
      >
        <span class="flex items-center justify-between gap-3">
          <span class="truncate text-sm font-medium">{{ result.title }}</span>
          <span class="text-[10px] uppercase tracking-wide text-slate-400">{{ result.kind }}</span>
        </span>
        <span v-if="result.excerpt" class="mt-1 block truncate text-xs text-slate-400">{{
          result.excerpt
        }}</span>
      </button>
      <p v-if="!loading && !results.length" class="px-4 py-5 text-xs text-slate-400">
        No matching tasks, projects, notes, or events.
      </p>
    </div>
  </div>
</template>
