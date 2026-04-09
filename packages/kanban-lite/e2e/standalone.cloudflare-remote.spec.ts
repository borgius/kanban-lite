import { test, expect } from '@playwright/test'

const baseURL = process.env.KANBAN_E2E_BASE_URL
const healthURL = baseURL ? new URL('/api/health', baseURL).toString() : undefined

test.describe('cloudflare deployed standalone smoke', () => {
  test.skip(!baseURL, 'Set KANBAN_E2E_BASE_URL to run the deployed Cloudflare smoke tests.')

  test('health endpoint responds', async ({ request }) => {
    const response = await request.get(healthURL as string)
    expect(response.ok()).toBe(true)
  })

  test('loads the board and persists a created card after reload', async ({ page }) => {
    const cardTitle = `Cloudflare smoke ${Date.now()}`

    await page.goto(baseURL as string)
    await expect(page.getByRole('button', { name: 'New Card' })).toBeVisible()
    await expect(page.getByLabel('Search cards')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible()

    await page.getByRole('button', { name: 'New Card' }).click()
    await page.getByPlaceholder('Card title...').fill(cardTitle)
    await page.getByRole('button', { name: 'Save' }).click()

    const createdCard = page.getByText(cardTitle, { exact: true })
    await expect(createdCard).toBeVisible()

    await page.reload()
    await expect(createdCard).toBeVisible()
  })
})
