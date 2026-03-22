import { defineConfig } from '@playwright/test'

const port = 4173

export default defineConfig({
  testDir: './packages/kanban-lite/e2e',
  outputDir: './tmp/playwright',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: './tmp/playwright-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm run standalone:e2e',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
})
