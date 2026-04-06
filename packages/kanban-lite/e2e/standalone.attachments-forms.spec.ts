import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Page } from '@playwright/test'
import { describeStandaloneScenario, test, expect } from './fixture'

const seedCardId = '21-attachments-forms-host'
const seededAttachmentName = 'evidence.txt'
const uploadedAttachmentName = 'playwright-upload.txt'
const uploadedAttachmentNamePattern = /^(?:playwright-upload\.txt|.*-playwright-upload\.txt)$/
const updatedInspectionNote = 'Updated from Playwright E2E coverage.'

function seededCard(page: Page) {
  return page.locator(`[data-card-id="${seedCardId}"]`)
}

async function openSeededCard(page: Page): Promise<void> {
  await seededCard(page).click()
  await expect(page.getByLabel('Close card')).toBeVisible()
  await expect(page.getByLabel('Card assignee')).toHaveValue('Taylor Field')
}

async function reopenSeededCardAfterReload(page: Page): Promise<void> {
  await page.getByLabel('Close card').click()
  await expect(seededCard(page)).toBeVisible()
  await page.reload()
  await expect(seededCard(page)).toBeVisible()
  await openSeededCard(page)
}

describeStandaloneScenario('standalone attachment detail flow', 'attachments-forms', (scenario) => {
  const uploadFixturePath = path.join(scenario.templateDir, 'uploads', uploadedAttachmentName)

  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
  })

  test('uploads a deterministic local attachment and keeps it visible after reload', async ({ page }) => {
    expect(fs.existsSync(uploadFixturePath)).toBe(true)

    await openSeededCard(page)
    await expect(page.getByRole('button', { name: seededAttachmentName, exact: true })).toBeVisible()

    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Add attachment', exact: true }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(uploadFixturePath)

    await expect(page.getByRole('button', { name: uploadedAttachmentNamePattern })).toBeVisible()

    await reopenSeededCardAfterReload(page)
    await expect(page.getByRole('button', { name: uploadedAttachmentNamePattern })).toBeVisible()
  })
})

describeStandaloneScenario('standalone form detail flow', 'attachments-forms', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
  })

  test('renders the seeded inspection form, submits one field change, and keeps it after reload', async ({ page }) => {
    await openSeededCard(page)

    await page.getByRole('button', { name: 'form: Inspection', exact: true }).click()

    await expect(page.getByLabel('Reporter')).toHaveValue('Taylor Field')
    await expect(page.getByLabel('Region')).toHaveValue('north')
    await expect(page.getByLabel('Note')).toHaveValue('Existing field note')

    await page.getByLabel('Note').fill(updatedInspectionNote)
    await page.getByRole('button', { name: 'Submit', exact: true }).click()

    await expect(page.getByRole('button', { name: /Logs/ })).toContainText('1')
    await expect(page.getByLabel('Note')).toHaveValue(updatedInspectionNote)

    await reopenSeededCardAfterReload(page)
    await page.getByRole('button', { name: 'form: Inspection', exact: true }).click()
    await expect(page.getByLabel('Note')).toHaveValue(updatedInspectionNote)
  })
})