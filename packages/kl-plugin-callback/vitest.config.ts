import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/index.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      'kanban-lite/sdk': resolve(__dirname, '../kanban-lite/src/sdk/index.ts'),
    },
  },
})
