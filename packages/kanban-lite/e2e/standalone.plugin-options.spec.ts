import type { Locator, Page } from '@playwright/test'
import { describeStandaloneScenario, test, expect } from './fixture'

const seedCardId = '41-plugin-settings-public'
const pluginPackageName = 'kl-plugin-auth-visibility'
const capability = 'auth.visibility'
const providerId = 'kl-plugin-auth-visibility'
const initialVisibleLabel = 'public'
const updatedVisibleLabel = 'playwright-public'

function seededCard(page: Page): Locator {
  return page.locator(`[data-card-id="${seedCardId}"]`)
}

function pluginListEntry(page: Page): Locator {
  return page.getByTestId(`plugin-package-${pluginPackageName}`)
}

function pluginOptionsSection(page: Page): Locator {
  return page.getByTestId(`plugin-options-section-${capability}-${providerId}`)
}

function pluginArrayField(section: Locator, fieldLabel: string): Locator {
  return section.locator('.array-table-layout').filter({ hasText: fieldLabel }).first()
}

function pluginArrayFieldInput(section: Locator, fieldLabel: string): Locator {
  return pluginArrayField(section, fieldLabel).locator('input').first()
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Board options:/ }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}

async function openPluginOptions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Plugin Options', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Plugin providers', exact: true })).toBeVisible()
}

async function selectAuthVisibilityProvider(page: Page, expectedLabelValue: string = initialVisibleLabel): Promise<Locator> {
  await pluginListEntry(page).click()

  const providerToggle = page.getByRole('switch', {
    name: `Toggle ${capability} provider ${providerId}`,
    exact: true,
  })
  await expect(providerToggle).toBeVisible()

  if ((await providerToggle.getAttribute('aria-checked')) !== 'true') {
    await providerToggle.click()
  }

  await expect(providerToggle).toHaveAttribute('aria-checked', 'true')

  const section = pluginOptionsSection(page)
  await expect(section).toBeVisible()
  await expect(pluginArrayFieldInput(section, 'Labels')).toHaveValue(expectedLabelValue)

  return section
}

describeStandaloneScenario('standalone plugin options smoke', 'plugin-options', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000)

    await page.goto('/')
    await expect(seededCard(page)).toBeVisible()
  })

  test('persists one non-secret plugin option after selecting a known provider', async ({ page }) => {
    await openSettings(page)
    await openPluginOptions(page)

    const section = await selectAuthVisibilityProvider(page)
    const labelInput = pluginArrayFieldInput(section, 'Labels')

    await labelInput.fill(updatedVisibleLabel)
    await section.getByRole('button', { name: 'Save options', exact: true }).click()

    await expect(pluginArrayFieldInput(section, 'Labels')).toHaveValue(updatedVisibleLabel)

    await page.getByRole('button', { name: 'Close settings', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)

    await page.reload()
    await expect(page.getByLabel('Search cards')).toBeVisible()

    await openSettings(page)
    await openPluginOptions(page)

    const reopenedSection = await selectAuthVisibilityProvider(page, updatedVisibleLabel)
    await expect(reopenedSection).toBeVisible()
    await expect(page.getByRole('switch', {
      name: `Toggle ${capability} provider ${providerId}`,
      exact: true,
    })).toHaveAttribute('aria-checked', 'true')
    await expect(pluginArrayFieldInput(reopenedSection, 'Labels')).toHaveValue(updatedVisibleLabel)
  })
})