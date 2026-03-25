/**
 * Take screenshots of the kanban-lite standalone UI for use in README / docs.
 *
 * Usage:
 *   npx tsx scripts/take-screenshots.ts
 *
 * Prerequisites:
 *   - The standalone bundle must be built (pnpm build or pnpm build:standalone)
 *   - Playwright chromium must be installed (npx playwright install chromium)
 *
 * Outputs: docs/images/{board-overview,editor-view,card-detail,dark-mode,search-view,settings-panel}.png
 */

import * as child_process from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from 'playwright'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const workspaceDir = path.join(repoRoot, 'tmp', 'screenshots-workspace')
const kanbanDir = path.join(workspaceDir, '.kanban')
const standaloneJs = path.join(repoRoot, 'packages', 'kanban-lite', 'dist', 'standalone.js')
const outputDir = path.join(repoRoot, 'docs', 'images')
const PORT = 4174
const BASE_URL = `http://127.0.0.1:${PORT}`

// ── sanity checks ─────────────────────────────────────────────────────────────

if (!fs.existsSync(standaloneJs)) {
  console.error(`ERROR: ${standaloneJs} not found. Run 'pnpm build' first.`)
  process.exit(1)
}

if (!fs.existsSync(workspaceDir)) {
  console.error(
    `ERROR: Screenshots workspace not found at ${workspaceDir}.\n` +
      `Run 'mkdir -p tmp/screenshots-workspace' and populate it before running this script.`,
  )
  process.exit(1)
}

fs.mkdirSync(outputDir, { recursive: true })

// ── helpers ───────────────────────────────────────────────────────────────────

async function waitForServer(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`)
      if (res.ok) return
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`)
}

function out(name: string): string {
  return path.join(outputDir, `${name}.png`)
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Start the standalone server
  console.log('Starting standalone server…')
  const server = child_process.spawn(
    process.execPath,
    [standaloneJs, '--dir', kanbanDir, '--port', String(PORT), '--no-browser'],
    { stdio: ['ignore', 'pipe', 'pipe'], cwd: workspaceDir },
  )

  server.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`))
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`))

  try {
    await waitForServer(BASE_URL)
    console.log('Server ready.')

    const browser = await chromium.launch({ headless: true })
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 860 },
      deviceScaleFactor: 2,
    })

    const page = await ctx.newPage()

    // ── 1. board-overview ────────────────────────────────────────────────────
    console.log('Taking board-overview.png…')
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-card-id]', { timeout: 10_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: out('board-overview'), fullPage: false })

    // ── 2. card-detail ───────────────────────────────────────────────────────
    console.log('Taking card-detail.png…')
    // Click the first "In Progress" card (7-s3-attachment-plugin)
    await page.click('[data-card-id="7-s3-attachment-plugin"]')
    await page.waitForSelector('.card-view-shell', { timeout: 8_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: out('card-detail'), fullPage: false })

    // ── 3. editor-view ───────────────────────────────────────────────────────
    console.log('Taking editor-view.png…')
    // Switch to the Markdown tab inside the card detail panel
    const markdownTab = page.locator('button:has-text("Markdown")').first()
    if (await markdownTab.isVisible()) {
      await markdownTab.click()
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: out('editor-view'), fullPage: false })

    // ── 4. dark-mode ─────────────────────────────────────────────────────────
    console.log('Taking dark-mode.png…')
    // Close card detail first
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    // Dark mode is inside the "Board options" dropdown (MoreHorizontal button)
    await page.click('button[title="Board options"]')
    await page.waitForTimeout(200)
    await page.locator('button:has-text("Dark Theme"), button:has-text("Light Theme")').first().click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: out('dark-mode'), fullPage: false })

    // ── 5. search-view ───────────────────────────────────────────────────────
    console.log('Taking search-view.png…')
    // Focus the search input which should be in the toolbar
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"]').first()
    await searchInput.fill('plugin')
    await page.waitForTimeout(400)
    await page.screenshot({ path: out('search-view'), fullPage: false })

    // ── 6. settings-panel ────────────────────────────────────────────────────
    console.log('Taking settings-panel.png…')
    // Clear search first
    await searchInput.fill('')
    await page.waitForTimeout(200)
    // Settings is inside "Board options" dropdown
    await page.click('button[title="Board options"]')
    await page.waitForTimeout(200)
    await page.locator('button:has-text("Settings")').first().click()
    await page.waitForSelector('[data-panel-drawer], h2:text("Settings")', { timeout: 6_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: out('settings-panel'), fullPage: false })

    await browser.close()
    console.log(`\nAll screenshots saved to ${outputDir}`)
  } finally {
    server.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
