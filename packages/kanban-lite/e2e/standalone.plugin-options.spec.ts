import type { Locator, Page } from '@playwright/test'
import { describeStandaloneScenario, test, expect } from './fixture'

const seedCardId = '41-plugin-settings-public'
const pluginPackageName = 'kl-plugin-auth-visibility'
const capability = 'auth.visibility'
const providerId = 'kl-plugin-auth-visibility'

function seededCard(page: Page): Locator {
  return page.locator(`[data-card-id="${seedCardId}"]`)
}

function pluginListEntry(page: Page): Locator {
  return page.getByTestId(`plugin-package-${pluginPackageName}`)
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
    // String arrays render as array-table-layout with editable rows.
    const rolesTable = section.locator('.array-table-layout').filter({ hasText: 'Matching roles' }).first()
    await expect(rolesTable).toBeVisible()
    const rowsBefore = await rolesTable.locator('tbody tr').count()
    expect(rowsBefore).toBe(1)

    // Add a second matching role
    const addRoleButton = section.getByRole('button', { name: /Add to Matching roles/i }).first()
    await addRoleButton.click()

    // Fill in a valid role name so the form is not in error state
    const newRoleInput = rolesTable.locator('tbody tr').last().locator('input')
    await newRoleInput.fill('admin')

    // Verify the count increased
    await expect(rolesTable.locator('tbody tr')).toHaveCount(rowsBefore + 1)

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
    const reopenedRolesTable = reopenedSection
      .locator('.array-table-layout')
      .filter({ hasText: 'Matching roles' })
      .first()
    await expect(reopenedRolesTable.locator('tbody tr')).toHaveCount(rowsBefore + 1)
  })
})
