import * as path from 'node:path'
import type { Page } from '@playwright/test'
import { describeStandaloneScenario, test, expect } from './fixture'

const seededCardId = '51-card-drawer-host'

function seededCard(page: Page) {
  return page.locator(`[data-card-id="${seededCardId}"]`)
}

async function openSeededCard(page: Page): Promise<void> {
  await seededCard(page).locator('h3').click()
  await expect(page.getByLabel('Close card')).toBeVisible()
}

async function saveAndReopen(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(seededCard(page)).toBeVisible()
  await openSeededCard(page)
}

// ─── Block 1: Read-only checks ───────────────────────────────────────────────

describeStandaloneScenario('card drawer - read-only checks', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
  })

  test('shows assignee, due date and priority in the details panel', async ({ page }) => {
    await expect(page.getByLabel('Card assignee')).toHaveValue('Alice')
    await expect(page.getByLabel('Card due date')).toHaveValue('2030-01-15')
    await expect(page.getByLabel('Card priority')).toContainText('High')
  })

  test('shows seeded labels as filter buttons in the details panel', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Filter cards by label feature' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Filter cards by label ui' }).first()).toBeVisible()
  })

  test('shows seeded body content in the preview tab', async ({ page }) => {
    await expect(page.getByText('This card seeds all card drawer features for comprehensive Playwright coverage.').first()).toBeVisible()
  })

  test('shows task progress in the tasks tab', async ({ page }) => {
    await page.getByRole('button', { name: /Tasks/ }).click()
    await expect(page.getByText('1 of 2 complete', { exact: true })).toBeVisible()
  })

  test('shows the seeded comment from Bob', async ({ page }) => {
    await page.getByRole('button', { name: /Comments/ }).click()
    await expect(page.getByText('Seeded comment for the card drawer e2e scenario.')).toBeVisible()
  })

  test('shows seeded metadata YAML in the meta tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Meta', exact: true }).click()
    const metaArea = page.locator('[data-testid="card-metadata-editor"] .cm-content')
    await expect(metaArea).toBeVisible()
    await expect(metaArea).toContainText('region: east')
    await expect(metaArea).toContainText('ticket: PROJ-99')
  })

  test('shows the Qa Check form tab button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'form: Qa Check', exact: true })).toBeVisible()
  })

  test('renders the form with tester pre-filled as Alice', async ({ page }) => {
    await page.getByRole('button', { name: 'form: Qa Check', exact: true }).click()
    await expect(page.getByLabel('Tester')).toHaveValue('Alice')
  })

  test('shows the seeded attachment screenshot.txt', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'screenshot.txt', exact: true })).toBeVisible()
  })
})

// ─── Block 2: Board filter chips ─────────────────────────────────────────────

describeStandaloneScenario('card drawer - board filters', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
  })

  test('clicking a label chip on the board card applies a label filter', async ({ page }) => {
    await page.getByRole('button', { name: 'Filter cards by label feature' }).first().click()
    await expect(page.getByText('Label: feature', { exact: true })).toBeVisible()
  })

  test('clicking a metadata filter button in the Advanced section applies a metadata filter', async ({ page }) => {
    await openSeededCard(page)
    // expand Advanced section
    await page.getByRole('button', { name: /Advanced/i }).click()
    await page.getByRole('button', { name: 'Filter cards by metadata region = east' }).click()
    await expect(page.getByText('meta.region: east', { exact: true })).toBeVisible()
  })
})

// ─── Block 3: Body edit ──────────────────────────────────────────────────────

describeStandaloneScenario('card drawer - body edit', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
  })

  test('edits the body in the Edit tab and persists after reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const body = page.locator('[data-testid="card-markdown-editor"] .cm-content')
    await body.fill('# Webhook retry logic\n\nPlaywright edit.')
    await saveAndReopen(page)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.locator('[data-testid="card-markdown-editor"] .cm-content')).toContainText('Playwright edit.')
  })
})

// ─── Block 4: Assignee + due date edits ──────────────────────────────────────

describeStandaloneScenario('card drawer - overview edits assignee', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
  })

  test('changes assignee and persists after reload', async ({ page }) => {
    const input = page.getByLabel('Card assignee')
    await input.fill('Charlie')
    await saveAndReopen(page)
    await expect(page.getByLabel('Card assignee')).toHaveValue('Charlie')
  })
})

describeStandaloneScenario('card drawer - overview edits due date', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
  })

  test('changes due date and persists after reload', async ({ page }) => {
    await page.getByLabel('Card due date').fill('2031-06-30')
    await saveAndReopen(page)
    await expect(page.getByLabel('Card due date')).toHaveValue('2031-06-30')
  })
})

// ─── Block 5: Label remove ───────────────────────────────────────────────────

describeStandaloneScenario('card drawer - label remove', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
  })

  test("removes the 'ui' label and persists after reload", async ({ page }) => {
    await page.getByRole('button', { name: 'Remove label ui' }).click()
    await saveAndReopen(page)
    await expect(page.getByRole('button', { name: 'Filter cards by label ui' }).first()).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Filter cards by label feature' }).first()).toBeVisible()
  })
})

// ─── Block 6: Task – add new task ────────────────────────────────────────────

describeStandaloneScenario('card drawer - task add', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
    await page.getByRole('button', { name: /Tasks/ }).click()
  })

  test('adds a new task and it persists after reload', async ({ page }) => {
    await page.getByPlaceholder('New task title...').fill('Deploy to staging')
    await page.getByRole('button', { name: 'Add task' }).click()
    await saveAndReopen(page)
    await page.getByRole('button', { name: /Tasks/ }).click()
    await expect(page.getByText('Deploy to staging')).toBeVisible()
  })
})

// ─── Block 7: Task – check existing task ─────────────────────────────────────

describeStandaloneScenario('card drawer - task check', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
    await page.getByRole('button', { name: /Tasks/ }).click()
  })

  test('checks the unchecked task and persists after reload', async ({ page }) => {
    await expect(page.getByText('1 of 2 complete', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Check task Review PR' }).click()
    await saveAndReopen(page)
    await page.getByRole('button', { name: /Tasks/ }).click()
    await expect(page.getByText('2 of 2 complete', { exact: true })).toBeVisible()
  })
})

// ─── Block 8: Comment add ────────────────────────────────────────────────────

describeStandaloneScenario('card drawer - comment add', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
    await page.getByRole('button', { name: /Comments/ }).click()
  })

  test('adds a new comment and it persists after reload', async ({ page }) => {
    await page.getByLabel('Comment author name').fill('Dana')
    await page.getByPlaceholder('Add a comment... (Markdown supported)').fill('E2E comment from Playwright.')
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await saveAndReopen(page)
    await page.getByRole('button', { name: /Comments/ }).click()
    await expect(page.getByText('E2E comment from Playwright.')).toBeVisible()
  })
})

// ─── Block 9: Metadata edit ──────────────────────────────────────────────────

describeStandaloneScenario('card drawer - metadata edit', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
    await page.getByRole('button', { name: 'Meta', exact: true }).click()
  })

  test('edits metadata YAML and persists after reload', async ({ page }) => {
    const metaArea = page.locator('[data-testid="card-metadata-editor"] .cm-content')
    await metaArea.fill('region: west\nticket: PROJ-99')
    await saveAndReopen(page)
    await page.getByRole('button', { name: 'Meta', exact: true }).click()
    await expect(page.locator('[data-testid="card-metadata-editor"] .cm-content')).toContainText('region: west')
  })
})

// ─── Block 10a: Form submit + log badge ─────────────────────────────────────

describeStandaloneScenario('card drawer - form submit badge', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
    await page.getByRole('button', { name: 'form: Qa Check', exact: true }).click()
  })

  test('submits the form and shows a log badge in the Logs tab', async ({ page }) => {
    await page.getByLabel('Result').selectOption('pass')
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByRole('button', { name: /Logs/ })).toContainText('1')
  })
})

// ─── Block 10b: Form submit + log entries ────────────────────────────────────

describeStandaloneScenario('card drawer - form submit logs', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
    await page.getByRole('button', { name: 'form: Qa Check', exact: true }).click()
  })

  test('shows form submission in the logs tab after submit', async ({ page }) => {
    await page.getByLabel('Result').selectOption('pass')
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await page.getByRole('button', { name: /Logs/ }).click()
    await expect(page.getByText('1 entries')).toBeVisible()
  })
})

// ─── Block 11: Attachment upload ─────────────────────────────────────────────

describeStandaloneScenario('card drawer - attachment upload', 'card-drawer', (scenario) => {
  test('uploads a new attachment and it persists after reload', async ({ page }) => {
    const uploadFixturePath = path.join(scenario.templateDir, 'uploads', 'cd-upload.txt')
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)

    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Add attachment', exact: true }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(uploadFixturePath)

    // wait for upload to complete before saving
    await expect(page.getByRole('button', { name: 'cd-upload.txt', exact: true })).toBeVisible()

    await saveAndReopen(page)
    await expect(page.getByRole('button', { name: 'cd-upload.txt', exact: true })).toBeVisible()
  })
})

// ─── Block 12: Priority edit ─────────────────────────────────────────────────

describeStandaloneScenario('card drawer - priority edit', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
  })

  test('changes priority to critical and persists after reload', async ({ page }) => {
    await page.getByLabel('Card priority').click()
    await page.getByRole('button', { name: 'Critical' }).click()
    await saveAndReopen(page)
    await expect(page.getByLabel('Card priority')).toContainText('Critical')
  })
})

// ─── Block 13: Status change ─────────────────────────────────────────────────

describeStandaloneScenario('card drawer - status change', 'card-drawer', (scenario) => {
  test.beforeEach(async ({ page }) => {
    await page.goto(scenario.baseURL)
    await expect(seededCard(page)).toBeVisible()
    await openSeededCard(page)
  })

  test('changes status to In Progress and persists after reload', async ({ page }) => {
    await page.getByLabel('Card status').click()
    await page.getByRole('button', { name: 'In Progress', exact: true }).click()
    await saveAndReopen(page)
    await expect(page.getByLabel('Card status')).toContainText('In Progress')
  })
})
