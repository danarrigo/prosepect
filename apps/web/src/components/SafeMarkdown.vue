<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

const props = defineProps<{ source: string }>()
const element = ref<HTMLElement | null>(null)

function render(source: string) {
  if (!element.value) return
  element.value.innerHTML = DOMPurify.sanitize(marked.parse(source, { async: false }) as string)
}

watch(() => props.source, render)
onMounted(() => render(props.source))
</script>

<template>
  <div ref="element" />
</template>
