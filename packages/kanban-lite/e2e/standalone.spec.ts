import * as fs from 'node:fs'
import * as path from 'node:path'
import { describeStandaloneScenario, test, expect } from './fixture'

const seedCardIds = {
  update: '1-refactor-auth-flow',
  delete: '2-fix-monorepo-ci',
} as const

const createdCardTitle = 'Playwright coverage card'
const updatedAssignee = 'Taylor QA'
const deletedCardToast = 'Deleted "Fix monorepo CI"'

function seededCard(page: Parameters<typeof test.beforeEach>[0]['page'], cardId: string) {
  return page.locator(`[data-card-id="${cardId}"]`)
}

describeStandaloneScenario('standalone core workflow persistence', 'core-workflow', (scenario) => {
  const backlogDir = path.join(scenario.kanbanDir, 'boards', 'default', 'backlog')
  const todoDir = path.join(scenario.kanbanDir, 'boards', 'default', 'todo')

  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page, seedCardIds.update)).toBeVisible()
    await expect(seededCard(page, seedCardIds.delete)).toBeVisible()
  })

  test('creates a card from the standalone UI and keeps it after reload', async ({ page }) => {
    await page.getByRole('button', { name: 'New Card' }).click()
    await page.getByPlaceholder('Card title...').fill(createdCardTitle)
    await page.getByRole('button', { name: 'Save' }).click()

    const createdCard = page.getByText(createdCardTitle, { exact: true })
    await expect(createdCard).toBeVisible()

    await page.reload()
    await expect(createdCard).toBeVisible()
  })

  test('updates a card field, moves the card, and keeps the change after reload', async ({ page }) => {
    const updatedCard = seededCard(page, seedCardIds.update)
    const sourcePath = path.join(backlogDir, `${seedCardIds.update}.md`)
    const targetPath = path.join(todoDir, `${seedCardIds.update}.md`)

    await updatedCard.click()

    const assigneeInput = page.getByLabel('Card assignee')
    await expect(assigneeInput).toBeVisible()
    await assigneeInput.fill(updatedAssignee)

    await page.getByLabel('Card status').click()
    await page.getByRole('button', { name: 'To Do', exact: true }).click()

    await expect(page.getByLabel('Card status')).toContainText('To Do')

    await expect.poll(() => ({
      sourceExists: fs.existsSync(sourcePath),
      targetExists: fs.existsSync(targetPath),
      targetContent: fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '',
    }), {
      timeout: 12_000,
      message: 'expected the moved card to persist the updated assignee before reload',
    }).toMatchObject({
      sourceExists: false,
      targetExists: true,
      targetContent: expect.stringContaining(`assignee: "${updatedAssignee}"`),
    })

    await page.getByLabel('Close card').click()
    await expect(updatedCard).toBeVisible()
    await page.reload()

    await expect(updatedCard).toBeVisible()
    await updatedCard.click()
    await expect(page.getByLabel('Card assignee')).toHaveValue(updatedAssignee)
    await expect(page.getByLabel('Card status')).toContainText('To Do')
    await page.getByLabel('Close card').click()
  })

  test('soft-deletes a card and keeps it removed after the undo window expires', async ({ page }) => {
    const deletedCard = seededCard(page, seedCardIds.delete)
    const toast = page.getByText(deletedCardToast, { exact: true })

    await deletedCard.click()
    await page.getByLabel('Move to deleted').click()

    await expect(deletedCard).toHaveCount(0)
    await expect(toast).toBeVisible()
    await expect(toast).toHaveCount(0, { timeout: 7_000 })

    await page.reload()
    await expect(deletedCard).toHaveCount(0)
  })
})
