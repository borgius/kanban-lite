import type { Page } from '@playwright/test'
import { describeStandaloneScenario, test, expect } from './fixture'

const seededCardId = '11-comments-checklist-host'

const commentDraft = {
  author: 'Jordan Reviewer',
  content: 'Ready to ship after the final QA pass.',
} as const

const checklistDraft = {
  title: 'Publish release summary',
  description: 'Share the final release note link with support.',
} as const

function seededCard(page: Page) {
  return page.locator(`[data-card-id="${seededCardId}"]`)
}

async function openSeededCard(page: Page, baseURL: string): Promise<void> {
  await page.goto(baseURL)
  const closeCardButton = page.getByRole('button', { name: 'Close card' })

  if (await closeCardButton.isVisible()) {
    return
  }

  await expect(seededCard(page)).toBeVisible()
  await seededCard(page).click()
  await expect(closeCardButton).toBeVisible()
}

async function openCommentsTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Comments/ }).click()
  await expect(page.getByLabel('Comment author name')).toBeVisible()
}

async function openTasksTab(page: Page, expectedProgress?: string): Promise<void> {
  await page.getByRole('button', { name: /Tasks/ }).click()
  if (expectedProgress) {
    await expect(page.getByText(expectedProgress, { exact: true })).toBeVisible()
  }
}

describeStandaloneScenario('standalone comment detail flow', 'comments-checklist', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await openSeededCard(page, scenario.baseURL)
    await openCommentsTab(page)
  })

  test('adds a visible comment from the card detail drawer', async ({ page }) => {
    await page.getByLabel('Comment author name').fill(commentDraft.author)
    await page.getByPlaceholder('Add a comment... (Markdown supported)').fill(commentDraft.content)
    await page.getByRole('button', { name: 'Comment', exact: true }).click()

    await expect(page.getByRole('button', { name: /Comments/ })).toContainText('2')
    await expect(page.getByText(commentDraft.author, { exact: true })).toBeVisible()
    await expect(page.getByText(commentDraft.content, { exact: true })).toBeVisible()
  })
})

describeStandaloneScenario('standalone checklist detail flow', 'comments-checklist', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await openSeededCard(page, scenario.baseURL)
    await openTasksTab(page, '1 of 2 complete')
  })

  test('adds and completes a checklist task and keeps it after reload', async ({ page }) => {
    await page.getByPlaceholder('New task title...').fill(checklistDraft.title)
    await page.getByPlaceholder('Description (optional)').fill(checklistDraft.description)
    await page.getByRole('button', { name: 'Add task' }).click()

    await expect(page.getByRole('button', { name: `Check task ${checklistDraft.title}` })).toBeVisible()
    await expect(page.getByText('1 of 3 complete', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: `Check task ${checklistDraft.title}` }).click()

    await expect(page.getByRole('button', { name: `Uncheck task ${checklistDraft.title}` })).toBeVisible()
    await expect(page.getByText('2 of 3 complete', { exact: true })).toBeVisible()

    await page.reload()
    await openSeededCard(page, scenario.baseURL)
    await openTasksTab(page, '2 of 3 complete')

    await expect(page.getByRole('button', { name: `Uncheck task ${checklistDraft.title}` })).toBeVisible()
    await expect(page.getByText('2 of 3 complete', { exact: true })).toBeVisible()
  })
})
