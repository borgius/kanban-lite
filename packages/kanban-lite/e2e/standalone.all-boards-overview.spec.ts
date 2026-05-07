import { describeStandaloneScenario, test, expect } from './fixture'

describeStandaloneScenario('standalone all-boards overview', 'core-workflow', (_scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for the toolbar to be ready
    await expect(page.getByLabel(/Board options:/)).toBeVisible()
  })

  test('opens all-boards overview from board menu and shows board card', async ({ page }) => {
    const currentBoardName = (await page.getByLabel(/Switch board:/).innerText()).trim()

    // Open the board menu (MoreHorizontal button)
    await page.getByLabel(/Board options:/).click()

    // Click "All Boards" menu item
    await page.getByRole('button', { name: 'All Boards', exact: true }).click()

    // The overview page should show the board name
    await expect(page.getByRole('heading', { name: 'All Boards' })).toBeVisible()

    // The current board card should be visible in the overview
    await expect(page.getByRole('heading', { level: 3, name: currentBoardName })).toBeVisible()
  })

  test('shows card count in board overview card', async ({ page }) => {
    await page.getByLabel(/Board options:/).click()
    await page.getByRole('button', { name: 'All Boards', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'All Boards' })).toBeVisible()

    // At least one card count is shown (the fixture has seeded cards)
    await expect(page.getByText(/^\d+\s+cards?$/i)).toBeVisible()
  })

  test('navigates back to board from overview via Open board button', async ({ page }) => {
    // Navigate to overview
    await page.getByLabel(/Board options:/).click()
    await page.getByRole('button', { name: 'All Boards', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'All Boards' })).toBeVisible()

    // Click "Open board" button on the first board card
    await page.getByRole('button', { name: 'Open board' }).first().click()

    // Should return to the board view — the search input is visible in normal board mode
    await expect(page.getByLabel('Search cards')).toBeVisible()
    // Overview heading should be gone
    await expect(page.getByRole('heading', { name: 'All Boards' })).not.toBeVisible()
  })

  test('back button in overview returns to board view', async ({ page }) => {
    await page.getByLabel(/Board options:/).click()
    await page.getByRole('button', { name: 'All Boards', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'All Boards' })).toBeVisible()

    // Click the back arrow button
    await page.getByRole('button', { name: /back/i }).click()

    // Should be back on the board
    await expect(page.getByLabel('Search cards')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'All Boards' })).not.toBeVisible()
  })
})
