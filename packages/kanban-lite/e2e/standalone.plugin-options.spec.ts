import type { Locator, Page } from '@playwright/test'
import { describeStandaloneScenario, test, expect } from './fixture'

const seedCardId = '41-plugin-settings-public'
const capability = 'auth.visibility'
const providerId = 'kl-plugin-auth-visibility'
const providerCacheKey = `${capability}:${providerId}`

function seededCard(page: Page): Locator {
  return page.locator(`[data-card-id="${seedCardId}"]`)
}

function pluginListEntry(page: Page): Locator {
  return page.getByTestId(`plugin-package-${providerId}`)
}

function pluginOptionsSection(page: Page): Locator {
  return page.getByTestId(`plugin-options-section-${capability}-${providerId}`)
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

async function openProviderOptions(page: Page): Promise<Locator> {
  await pluginListEntry(page).click()

  const providerToggle = page.getByRole('switch', {
    name: `Toggle ${capability} provider ${providerId}`,
    exact: true,
  })
  await expect(providerToggle).toBeVisible()
  await expect(providerToggle).toHaveAttribute('aria-checked', 'true')

  const section = pluginOptionsSection(page)
  await expect(section).toBeVisible({ timeout: 10_000 })
  return section
}

describeStandaloneScenario('standalone plugin options smoke', 'plugin-options', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000)

    await page.goto('/')
    await expect(page.getByLabel('Search cards')).toBeVisible()
  })

  test('persists one non-secret plugin option after editing a known active provider', async ({ page }) => {
    await openSettings(page)
    await openPluginOptions(page)

    const section = await openProviderOptions(page)

    // The seeded fixture has 1 matching role in the first rule ("viewer").
    // Plain string arrays render through the JsonFormsStringListControl chip-free editor.
    const rolesList = section.locator('.kl-jsonforms-string-list').filter({ hasText: 'Matching roles' }).first()
    await expect(rolesList).toBeVisible()
    const rowsBefore = await rolesList.locator('.kl-jsonforms-string-list__row').count()
    expect(rowsBefore).toBe(1)

    // Add a second matching role via the header "Add role" button
    const addRoleButton = rolesList.locator('.kl-jsonforms-string-list__add').first()
    await addRoleButton.click()

    // Fill in a valid role name so the form is not in error state
    const newRoleInput = rolesList.locator('.kl-jsonforms-string-list__row').last().locator('input')
    await newRoleInput.fill('admin')

    // Verify the count increased
    await expect(rolesList.locator('.kl-jsonforms-string-list__row')).toHaveCount(rowsBefore + 1)

    // Save
    await section.getByRole('button', { name: 'Save options', exact: true }).click()

    // Close settings and reload
    await page.getByRole('button', { name: 'Close settings', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)

    await page.reload()
    await expect(page.getByLabel('Search cards')).toBeVisible()

    // Reopen and verify the new row persisted
    await openSettings(page)
    await openPluginOptions(page)

    const reopenedSection = await openProviderOptions(page)
    const reopenedRolesList = reopenedSection
      .locator('.kl-jsonforms-string-list')
      .filter({ hasText: 'Matching roles' })
      .first()
    await expect(reopenedRolesList.locator('.kl-jsonforms-string-list__row')).toHaveCount(rowsBefore + 1)
  })
})
