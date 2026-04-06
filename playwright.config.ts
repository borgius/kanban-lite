import { defineConfig } from '@playwright/test'

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
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
