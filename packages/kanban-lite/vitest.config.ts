import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    root: resolve(__dirname),
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    testTimeout: 30000
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})
