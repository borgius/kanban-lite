import * as fs from 'node:fs'
import * as path from 'node:path'
import { test, expect } from '@playwright/test'

const repoRoot = process.cwd()
const standaloneE2EWorkspaceDir = path.join(repoRoot, 'tmp', 'e2e', 'workspace')
const standaloneE2EKanbanDir = path.join(standaloneE2EWorkspaceDir, '.kanban')

const backlogDir = path.join(standaloneE2EKanbanDir, 'boards', 'default', 'backlog')
const todoDir = path.join(standaloneE2EKanbanDir, 'boards', 'default', 'todo')
const deletedDir = path.join(standaloneE2EKanbanDir, 'boards', 'default', 'deleted')

const seedCardIds = {
  update: '1-refactor-auth-flow',
  delete: '2-fix-monorepo-ci',
} as const

const createdCardTitle = 'Playwright coverage card'
const updatedAssignee = 'Taylor QA'

function listMarkdownFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith('.md'))
    .map((file) => path.join(directory, file))
}

function findCardFileByTitle(directory: string, title: string): string | null {
  for (const filePath of listMarkdownFiles(directory)) {
    const content = fs.readFileSync(filePath, 'utf8')
    if (content.includes(`# ${title}`)) return filePath
  }

  return null
}

function readCardFile(filePath: string | null): string {
  if (!filePath) {
    throw new Error('Expected card file path to exist before reading it')
  }

  return fs.readFileSync(filePath, 'utf8')
}

test.describe('standalone persisted flows', () => {
  test.beforeAll(() => {
    expect(fs.existsSync(path.join(standaloneE2EWorkspaceDir, '.kanban.json'))).toBe(true)
    expect(fs.existsSync(backlogDir)).toBe(true)
    expect(fs.existsSync(todoDir)).toBe(true)
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator(`[data-card-id="${seedCardIds.update}"]`)).toBeVisible()
    await expect(page.locator(`[data-card-id="${seedCardIds.delete}"]`)).toBeVisible()
  })

  test('creates a card from the standalone UI and persists it to disk', async ({ page }) => {
    await page.getByRole('button', { name: 'New Card' }).click()
    await page.getByPlaceholder('Card title...').fill(createdCardTitle)
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText(createdCardTitle)).toBeVisible()

    await expect.poll(() => findCardFileByTitle(backlogDir, createdCardTitle), {
      message: 'expected the created card to be written into the backlog fixture directory',
    }).not.toBeNull()

    const createdPath = findCardFileByTitle(backlogDir, createdCardTitle)
    expect(readCardFile(createdPath)).toContain(`# ${createdCardTitle}`)
  })

  test('updates a card field, moves the card, and keeps the change after reload', async ({ page }) => {
    const sourcePath = path.join(backlogDir, `${seedCardIds.update}.md`)
    const targetPath = path.join(todoDir, `${seedCardIds.update}.md`)

    await page.locator(`[data-card-id="${seedCardIds.update}"]`).click()

    const editor = page.locator('.card-view-shell').last()
    await expect(editor).toBeVisible()

    const assigneeInput = editor.locator('.card-property-row').filter({ hasText: 'Assignee' }).locator('input[type="text"]')
    await assigneeInput.fill(updatedAssignee)

    const statusRow = editor.locator('.card-property-row').filter({ hasText: 'Status' })
    await statusRow.locator('button').first().click()
    await editor.locator('.card-floating-menu__item').filter({ hasText: 'To Do' }).first().click()

    await expect.poll(() => ({
      sourceExists: fs.existsSync(sourcePath),
      targetExists: fs.existsSync(targetPath),
      targetContent: fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '',
    }), {
      message: 'expected the updated card to move to todo and persist the assignee change',
    }).toMatchObject({
      sourceExists: false,
      targetExists: true,
      targetContent: expect.stringContaining(`assignee: "${updatedAssignee}"`),
    })

    await page.getByLabel('Close card').click()
    await page.reload()

    await expect(page.locator(`[data-card-id="${seedCardIds.update}"]`)).toBeVisible()
    await page.locator(`[data-card-id="${seedCardIds.update}"]`).click()
    await expect(editor.locator('.card-property-row').filter({ hasText: 'Assignee' }).locator('input[type="text"]')).toHaveValue(updatedAssignee)
    await page.getByLabel('Close card').click()
  })

  test('deletes a card from the active board and persists the soft-delete move', async ({ page }) => {
    const sourcePath = path.join(todoDir, `${seedCardIds.delete}.md`)
    const deletedPath = path.join(deletedDir, `${seedCardIds.delete}.md`)

    await page.locator(`[data-card-id="${seedCardIds.delete}"]`).click()
    await page.getByLabel('Move to deleted').click()

    await expect(page.locator(`[data-card-id="${seedCardIds.delete}"]`)).toHaveCount(0)

    await expect.poll(() => ({
      sourceExists: fs.existsSync(sourcePath),
      deletedExists: fs.existsSync(deletedPath),
    }), {
      timeout: 12_000,
      message: 'expected the deleted card to move into the deleted status directory after the undo window expires',
    }).toEqual({
      sourceExists: false,
      deletedExists: true,
    })

    await page.reload()
    await expect(page.locator(`[data-card-id="${seedCardIds.delete}"]`)).toHaveCount(0)
  })
})
