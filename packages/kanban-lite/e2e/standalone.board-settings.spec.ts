import * as fs from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { describeStandaloneScenario, test, expect, type StandaloneE2EScenario } from './fixture'

type BoardSettingsSlug = 'defaults' | 'title' | 'actions' | 'labels' | 'meta'

type BoardSettingsConfig = {
  defaultPriority?: string
  boards: {
    default: {
      defaultPriority?: string
      title?: string[]
      metadata?: Record<string, unknown>
      actions?: Record<string, string>
    }
  }
  labels?: Record<string, { color?: string; group?: string }>
}

function readConfig(scenario: StandaloneE2EScenario): BoardSettingsConfig {
  return JSON.parse(fs.readFileSync(scenario.configPath, 'utf8')) as BoardSettingsConfig
}

function settingsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Settings' })
}

async function expectSettingsDialog(page: Page): Promise<void> {
  await expect(settingsDialog(page)).toBeVisible()
}

async function openBoardSettings(page: Page, route: string = '/settings/board/defaults'): Promise<void> {
  await page.goto(route)
  await expectSettingsDialog(page)
}

async function switchBoardSubTab(page: Page, label: string, slug: BoardSettingsSlug): Promise<void> {
  await settingsDialog(page).getByRole('button', { name: label, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/settings/board/${slug}$`))
}

describeStandaloneScenario('standalone board settings routes', 'board-settings', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByLabel('Search cards')).toBeVisible()
  })

  test('redirects /settings/board to defaults and persists default priority changes', async ({ page }) => {
    await openBoardSettings(page, '/settings/board')
    await expect(page).toHaveURL(/\/settings\/board\/defaults$/)
    await expect(settingsDialog(page).getByText('Default Priority', { exact: true })).toBeVisible()

    await settingsDialog(page).getByRole('button', { name: 'Medium', exact: true }).click()
    await page.getByRole('button', { name: 'High', exact: true }).click()

    await expect.poll(() => readConfig(scenario).defaultPriority).toBe('high')
  })

  test('routes to the title tab and persists added title fields', async ({ page }) => {
    await openBoardSettings(page)
    await switchBoardSubTab(page, 'Title', 'title')
    await expect(settingsDialog(page).getByRole('heading', { name: 'Title Template', exact: true })).toBeVisible()

    await settingsDialog(page).getByRole('button', { name: 'location', exact: true }).click()

    await expect.poll(() => readConfig(scenario).boards.default.title ?? []).toEqual(['ticketId', 'location'])
  })

  test('routes to the actions tab and persists new board actions', async ({ page }) => {
    await openBoardSettings(page)
    await switchBoardSubTab(page, 'Actions', 'actions')
    await expect(settingsDialog(page).getByRole('heading', { name: 'Board Actions', exact: true })).toBeVisible()

    await settingsDialog(page).getByRole('button', { name: 'Add action', exact: true }).click()
    await settingsDialog(page).locator('input[placeholder="Action Key"]').last().fill('rollback')
    await settingsDialog(page).locator('input[placeholder="Action Title"]').last().fill('Rollback release')

    await expect.poll(() => readConfig(scenario).boards.default.actions?.rollback ?? null).toBe('Rollback release')
  })

  test('redirects legacy labels routes and persists added label definitions', async ({ page }) => {
    await openBoardSettings(page, '/settings/labels')
    await expect(page).toHaveURL(/\/settings\/board\/labels$/)
    await expect(settingsDialog(page).getByText('urgent', { exact: true })).toBeVisible()

    await settingsDialog(page).getByPlaceholder('New label name...').fill('customer-facing')
    await settingsDialog(page).getByPlaceholder('Group (optional)').fill('Ops')
    await settingsDialog(page).getByRole('button', { name: 'Add', exact: true }).click()

    await expect.poll(() => readConfig(scenario).labels?.['customer-facing'] ?? null).toMatchObject({
      group: 'Ops',
    })
  })

  test('routes to the meta tab and persists added board metadata fields', async ({ page }) => {
    await openBoardSettings(page)
    await switchBoardSubTab(page, 'Meta', 'meta')
    await expect(settingsDialog(page).getByRole('heading', { name: 'Metadata Fields', exact: true })).toBeVisible()

    await settingsDialog(page).getByRole('button', { name: 'Add field', exact: true }).click()
    await settingsDialog(page).locator('input[name="metadataFieldName"]').fill('region')
    await settingsDialog(page).locator('textarea[name="metadataFieldDescription"]').fill('Deployment region for the work item')
    await settingsDialog(page).locator('input[name="metadataFieldHighlighted"]').check()
    await settingsDialog(page).getByRole('button', { name: 'Save field', exact: true }).click()

    await expect.poll(() => readConfig(scenario).boards.default.metadata?.region ?? null).toMatchObject({
      description: 'Deployment region for the work item',
      highlighted: true,
    })
  })
})
