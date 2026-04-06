import type { Page } from '@playwright/test'
import { describeStandaloneScenario, test, expect } from './fixture'

const localPassword = 'secret123'
const seedCardIds = {
  public: 'public-card',
  private: 'private-card',
} as const

function seededCard(page: Page, cardId: string) {
  return page.locator(`[data-card-id="${cardId}"]`)
}

async function expectLoginPage(page: Page, expectedReturnTo: string): Promise<void> {
  await expect(page).toHaveURL(/\/auth\/login\?returnTo=/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByLabel('Username')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(expectedReturnTo)
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(localPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function expectBoardLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible()
  await expect(page.getByLabel('Search cards')).toBeVisible()
}

async function expectHiddenCardDenied(page: Page): Promise<void> {
  await expectBoardLoaded(page)
  await expect(seededCard(page, seedCardIds.public)).toBeVisible()
  await expect(seededCard(page, seedCardIds.private)).toHaveCount(0)
  await expect(page.locator('[data-panel-drawer]')).toHaveCount(0)
  await expect(page.getByLabel('Close card')).toHaveCount(0)
  await expect(page.getByLabel('Card assignee')).toHaveCount(0)
  await expect(page.getByText('Only the admin fixture user should be able to open this card.', { exact: true })).toHaveCount(0)
}

describeStandaloneScenario('standalone auth redirect and visibility browser flows', 'auth-visibility', (scenario) => {
  test('redirects an anonymous browser to login and returns to the board after sign-in', async ({ page }) => {
    await page.goto(scenario.baseURL)

    await expectLoginPage(page, '/')
    await signIn(page, 'admin')

    await expectBoardLoaded(page)
    await expect(page).not.toHaveURL(/\/auth\/login/)
    await expect(seededCard(page, seedCardIds.public)).toBeVisible()
    await expect(seededCard(page, seedCardIds.private)).toBeVisible()
  })

  test('denies a hidden deep link for the reader user and keeps it denied after reload', async ({ page }) => {
    const hiddenCardRoute = `${scenario.baseURL}/default/${seedCardIds.private}/preview`

    await page.goto(hiddenCardRoute)

    await expectLoginPage(page, `/default/${seedCardIds.private}/preview`)
    await signIn(page, 'reader')

    await expectHiddenCardDenied(page)

    await page.reload()

    await expectHiddenCardDenied(page)
    await expect(page.url()).not.toContain('/auth/login')
  })
})