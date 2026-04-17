import { describeStandaloneScenario, test, expect } from './fixture'

describeStandaloneScenario('standalone openauth plugin browser flows', 'openauth', (scenario) => {
  test('login page renders at /auth/openauth/login', async ({ page }) => {
    await page.goto(`${scenario.baseURL}/auth/openauth/login`)

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /sign in with openauth/i })).toBeVisible()
  })

  test('unauthenticated page request redirects to openauth login', async ({ page }) => {
    await page.goto(scenario.baseURL)

    await expect(page).toHaveURL(/\/auth\/openauth\/login/)
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
  })

  test('unauthenticated API request returns 401', async ({ request }) => {
    const response = await request.get(`${scenario.baseURL}/api/boards`)
    expect(response.status()).toBe(401)

    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Authentication required')
  })

  test('authorize route handles unreachable issuer gracefully', async ({ page }) => {
    // Navigate to authorize → issuer unreachable → redirect to login with error
    await page.goto(`${scenario.baseURL}/auth/openauth/authorize?returnTo=/boards`)

    // Should redirect back to the login page with an error message
    await expect(page).toHaveURL(/\/auth\/openauth\/login/)
    await expect(page.getByText(/failed to start authentication/i)).toBeVisible()
  })

  test('logout route clears cookies and redirects to login', async ({ page }) => {
    await page.goto(`${scenario.baseURL}/auth/openauth/logout`)

    await expect(page).toHaveURL(/\/auth\/openauth\/login/)
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
  })

  test('login page preserves returnTo param', async ({ page }) => {
    await page.goto(`${scenario.baseURL}/auth/openauth/login?returnTo=/boards`)

    // The "Sign in with OpenAuth" link should include the returnTo
    const signInLink = page.getByRole('link', { name: /sign in with openauth/i })
    await expect(signInLink).toBeVisible()
    const href = await signInLink.getAttribute('href')
    expect(href).toContain('returnTo=')
  })
})
