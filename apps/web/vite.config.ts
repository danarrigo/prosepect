import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const deployment: { headers?: { source: string; headers: { key: string; value: string }[] }[] } =
  JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'))

export default defineConfig({
  preview: {
    headers: Object.fromEntries(
      deployment.headers
        ?.find(({ source }) => source === '/(.*)')
        ?.headers.map(({ key, value }) => [key, value]) ?? [],
    ),
  },

  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000',
      '/ready': 'http://127.0.0.1:3000',
    },
  },
})
