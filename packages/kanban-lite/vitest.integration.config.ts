import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    root: resolve(__dirname),
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})
