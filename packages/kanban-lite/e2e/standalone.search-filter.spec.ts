import type { Page } from '@playwright/test'
import { describeStandaloneScenario, test, expect } from './fixture'

const seedCardIds = {
  backlog: '1-refactor-auth-flow',
  todo: '2-fix-monorepo-ci',
} as const

function seededCard(page: Page, cardId: string) {
  return page.locator(`[data-card-id="${cardId}"]`)
}

describeStandaloneScenario('standalone board load and filters', 'core-workflow', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(page.getByLabel('Search cards')).toBeVisible()
  })

  test('loads the seeded board with visible columns and cards', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'To Do' })).toBeVisible()
    await expect(seededCard(page, seedCardIds.backlog)).toBeVisible()
    await expect(seededCard(page, seedCardIds.todo)).toBeVisible()
  })

  test('narrows and restores the board with search and assignee filters', async ({ page }) => {
    const backlogCard = seededCard(page, seedCardIds.backlog)
    const todoCard = seededCard(page, seedCardIds.todo)

    await page.getByLabel('Search cards').fill('Jordan')

    await expect(todoCard).toBeVisible()
    await expect(backlogCard).toHaveCount(0)
    await expect(page.getByText('Search: "Jordan"', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(backlogCard).toBeVisible()
    await expect(todoCard).toBeVisible()

    await page.getByRole('button', { name: /Filters/ }).click()
    await page.getByLabel('Filter by assignee').selectOption('unassigned')

    await expect(backlogCard).toBeVisible()
    await expect(todoCard).toHaveCount(0)
    await expect(page.getByText('Assignee: Unassigned', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(backlogCard).toBeVisible()
    await expect(todoCard).toBeVisible()
  })
})