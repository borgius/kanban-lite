/**
 * Focused tests for T3: SDK webhook delegation to the external provider.
 *
 * Tests are ordered intentionally: "no provider" tests run BEFORE any
 * installTempPackage call so the require cache starts clean for those assertions.
 */

import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import { MarkdownStorageEngine } from '../plugins/markdown'

const runtimeRequire = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function installTempPackage(packageName: string, entrySource: string): () => void {
  const packageDir = path.join(process.cwd(), 'node_modules', packageName)
  const siblingPackagePath = path.join(process.cwd(), '..', packageName)

  const clearPackageCache = (): void => {
    for (const candidate of [packageName, packageDir, siblingPackagePath]) {
      try {
        const resolved = runtimeRequire.resolve(candidate)
        delete runtimeRequire.cache[resolved]
      } catch {
        // Ignore cache entries that do not currently resolve.
      }
    }
  }

  // Detect whether the existing entry is a symlink (common in pnpm workspaces).
  // When it is a symlink, save the link target for restoration instead of
  // copying the entire linked directory tree (which can fail on circular
  // node_modules symlinks and is unnecessarily expensive).
  let existingSymlinkTarget: string | null = null
  let backupDir: string | null = null

  if (fs.existsSync(packageDir)) {
    try {
      existingSymlinkTarget = fs.readlinkSync(packageDir)
    } catch {
      // Not a symlink — copy the directory for a safe restoration.
      backupDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `${packageName.replace(/[^a-z0-9-]/gi, '-')}-backup-`),
      )
      fs.cpSync(packageDir, backupDir, { recursive: true })
    }
    // Remove the existing entry so we can install the mock in its place.
    fs.rmSync(packageDir, { recursive: true, force: true })
  }

  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageName, main: 'index.js' }, null, 2),
    'utf-8',
  )
  fs.writeFileSync(path.join(packageDir, 'index.js'), entrySource, 'utf-8')
  clearPackageCache()

  return () => {
    clearPackageCache()
    fs.rmSync(packageDir, { recursive: true, force: true })
    if (existingSymlinkTarget !== null) {
      // Restore the original symlink.
      fs.symlinkSync(existingSymlinkTarget, packageDir)
    } else if (backupDir) {
      fs.mkdirSync(path.dirname(packageDir), { recursive: true })
      fs.cpSync(backupDir, packageDir, { recursive: true })
      fs.rmSync(backupDir, { recursive: true, force: true })
    }
    clearPackageCache()
  }
}

function createTempWorkspace(): {
  workspaceDir: string
  kanbanDir: string
  cleanup: () => void
} {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-delegation-test-'))
  const kanbanDir = path.join(workspaceDir, '.kanban')
  fs.mkdirSync(kanbanDir, { recursive: true })
  fs.writeFileSync(
    path.join(workspaceDir, '.kanban.json'),
    JSON.stringify(
      {
        version: 2,
        boards: {
          default: {
            name: 'Default',
            columns: [],
            nextCardId: 1,
            defaultStatus: 'backlog',
            defaultPriority: 'medium',
          },
        },
        defaultBoard: 'default',
        kanbanDirectory: '.kanban',
        aiAgent: 'claude',
        defaultPriority: 'medium',
        defaultStatus: 'backlog',
        nextCardId: 1,
        showPriorityBadges: true,
        showAssignee: true,
        showDueDate: true,
        showLabels: true,
        showBuildWithAI: true,
        showFileName: false,
        markdownEditorMode: false,
        showDeletedColumn: false,
        boardZoom: 100,
        cardZoom: 100,
        port: 2954,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  )
  return {
    workspaceDir,
    kanbanDir,
    cleanup: () => fs.rmSync(workspaceDir, { recursive: true, force: true }),
  }
}

/** Minimal mock package source for kl-plugin-webhook using the T8+ listener-only contract. */
const MOCK_PACKAGE_SOURCE = `
module.exports = {
  webhookProviderPlugin: {
    manifest: { id: 'test-webhooks', provides: ['webhook.delivery'] },
    listWebhooks: (_root) => [{ id: 'wh_from_provider', url: 'http://provider.example.com', events: ['*'], active: true }],
    createWebhook: (_root, input) => ({ id: 'wh_created', url: input.url, events: input.events, active: true }),
    updateWebhook: (_root, id, updates) => ({ id, url: updates.url || 'http://updated.example.com', events: updates.events || ['*'], active: updates.active !== false }),
    deleteWebhook: (_root, id) => id === 'wh_exists',
  },
  WebhookListenerPlugin: class WebhookListenerPlugin {
    constructor(workspaceRoot) {
      this.workspaceRoot = workspaceRoot
      this.manifest = { id: 'test-webhooks-listener', provides: ['event.listener'] }
    }
    register(_bus) {}
    unregister() {}
  },
}
`

// ---------------------------------------------------------------------------
// Tests using options.storage (pre-built engine path — no plugin, no fallback)
// ---------------------------------------------------------------------------

describe('KanbanSDK – webhook delegation without provider (pre-built storage path)', () => {
  it('capabilities is null when options.storage is injected directly (no provider path)', () => {
    const { kanbanDir, cleanup } = createTempWorkspace()
    try {
      // Inject a pre-built storage engine — this bypasses resolveCapabilityBag entirely,
      // so capabilities is null.
      const storage = new MarkdownStorageEngine(kanbanDir)
      const sdk = new KanbanSDK(kanbanDir, { storage })
      expect(sdk.capabilities).toBeNull()
      expect(sdk.getWebhookStatus().webhookProvider).toBe('none')
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('listWebhooks throws a plugin-missing error when options.storage injected without provider', () => {
    const { kanbanDir, cleanup } = createTempWorkspace()
    try {
      const storage = new MarkdownStorageEngine(kanbanDir)
      const sdk = new KanbanSDK(kanbanDir, { storage })
      expect(() => sdk.listWebhooks()).toThrow('Webhook commands require kl-plugin-webhook')
      sdk.destroy()
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Single delivery regression: one SDK mutation → exactly one outbound delivery
// The workspace has no explicit webhookPlugin, so the default 'webhooks' →
// 'kl-plugin-webhook' alias causes the sibling at ../kl-plugin-webhook to
// be loaded via the sibling-fallback path.  This MUST run BEFORE
// installTempPackage is called so the require-cache does NOT yet contain the
// mock node_modules package, exercising the true sibling loading path.
// ---------------------------------------------------------------------------

/**
 * Regression: a single SDK mutation must cause exactly one HTTP POST to a
 * registered webhook endpoint. The workspace config has no explicit
 * webhookPlugin entry, so normalizeWebhookCapabilities defaults to provider
 * 'webhooks' → alias 'kl-plugin-webhook'. The sibling at
 * ../kl-plugin-webhook is loaded via the sibling-fallback path, establishing
 * a true end-to-end sibling-loading + delivery assertion.
 */
describe('KanbanSDK – single delivery regression: one SDK mutation → one outbound webhook POST', () => {
  it('createCard triggers exactly one HTTP POST to the registered webhook endpoint', async () => {
    const received: Array<{ event: string; data: unknown }> = []

    // Start a minimal HTTP server to capture webhook deliveries
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += String(chunk) })
        req.on('end', () => {
          try { received.push(JSON.parse(body) as { event: string; data: unknown }) } catch { /* ignore */ }
          res.writeHead(200)
          res.end()
        })
      } else {
        res.writeHead(405)
        res.end()
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as net.AddressInfo).port

    const { workspaceDir, kanbanDir, cleanup } = createTempWorkspace()
    // Register a webhook pointing to the test server in the workspace config
    const configPath = path.join(workspaceDir, '.kanban.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    config.webhooks = [
      { id: 'wh_single_delivery', url: `http://127.0.0.1:${port}/hook`, events: ['task.created'], active: true },
    ]
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

    try {
      // The workspace has no explicit webhookPlugin config, so
      // normalizeWebhookCapabilities defaults to provider 'webhooks' →
      // 'kl-plugin-webhook'. The sibling at ../kl-plugin-webhook is loaded
      // via sibling fallback (no node_modules package installed yet), proving
      // end-to-end sibling loading + delivery through the provider-backed seam.
      const sdk = new KanbanSDK(kanbanDir)
      await sdk.createCard({ content: '# Single delivery regression\n\nDescribes the test.' })
      // Wait briefly for async fire-and-forget HTTP delivery
      await new Promise(resolve => setTimeout(resolve, 300))

      // Exactly ONE delivery for exactly ONE mutation
      expect(received).toHaveLength(1)
      expect(received[0].event).toBe('task.created')

      sdk.destroy()
    } finally {
      cleanup()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})

// ---------------------------------------------------------------------------
// Tests WITH the provider installed
// (installed once for the entire suite due to require-cache constraints)
// ---------------------------------------------------------------------------

describe('KanbanSDK – webhook delegation with provider', () => {
  let cleanupPackage: () => void

  beforeAll(() => {
    cleanupPackage = installTempPackage('kl-plugin-webhook', MOCK_PACKAGE_SOURCE)
  })

  afterAll(() => {
    cleanupPackage?.()
  })

  it('resolves webhookProvider from capability bag when package is installed', () => {
    const { kanbanDir, cleanup } = createTempWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      expect(sdk.capabilities?.webhookProvider).not.toBeNull()
      expect(sdk.capabilities?.webhookProvider?.manifest.id).toBeTruthy()
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('uses the plugin-provided webhook listener when the plugin exports one', () => {
    const { kanbanDir, cleanup } = createTempWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      // kl-plugin-webhook exports WebhookListenerPlugin; capabilities.webhookListener must be non-null.
      expect(sdk.capabilities!.webhookListener).not.toBeNull()
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('listWebhooks delegates to provider.listWebhooks', () => {
    const { kanbanDir, cleanup } = createTempWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const provider = sdk.capabilities!.webhookProvider!
      const spy = vi.spyOn(provider, 'listWebhooks').mockReturnValue([
        { id: 'wh_from_provider', url: 'http://provider.example.com', events: ['*'], active: true },
      ])
      const result = sdk.listWebhooks()
      expect(spy).toHaveBeenCalledWith(sdk.workspaceRoot)
      expect(result[0].id).toBe('wh_from_provider')
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('createWebhook delegates to provider.createWebhook', async () => {
    const { kanbanDir, cleanup } = createTempWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const provider = sdk.capabilities!.webhookProvider!
      const input = { url: 'http://new.example.com', events: ['task.created'] }
      const spy = vi.spyOn(provider, 'createWebhook').mockReturnValue({
        id: 'wh_created',
        url: input.url,
        events: input.events,
        active: true,
      })
      const result = await sdk.createWebhook(input)
      expect(spy).toHaveBeenCalledWith(sdk.workspaceRoot, input)
      expect(result.id).toBe('wh_created')
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('updateWebhook delegates to provider.updateWebhook', async () => {
    const { kanbanDir, cleanup } = createTempWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const provider = sdk.capabilities!.webhookProvider!
      const spy = vi.spyOn(provider, 'updateWebhook').mockReturnValue({
        id: 'wh_abc',
        url: 'http://updated.example.com',
        events: ['*'],
        active: true,
      })
      const updates = { url: 'http://updated.example.com' }
      const result = await sdk.updateWebhook('wh_abc', updates)
      expect(spy).toHaveBeenCalledWith(sdk.workspaceRoot, 'wh_abc', updates)
      expect(result).toMatchObject({ id: 'wh_abc', url: 'http://updated.example.com' })
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('deleteWebhook delegates to provider.deleteWebhook', async () => {
    const { kanbanDir, cleanup } = createTempWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const provider = sdk.capabilities!.webhookProvider!
      const spy = vi.spyOn(provider, 'deleteWebhook').mockReturnValue(true)
      const result = await sdk.deleteWebhook('wh_exists')
      expect(spy).toHaveBeenCalledWith(sdk.workspaceRoot, 'wh_exists')
      expect(result).toBe(true)
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('unregisters the plugin listener on destroy', () => {
    const { kanbanDir, cleanup } = createTempWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const providerListener = sdk.capabilities!.webhookListener
      expect(providerListener).not.toBeNull()
      const providerUnregisterSpy = vi.spyOn(providerListener!, 'unregister')
      sdk.destroy()
      expect(providerUnregisterSpy).toHaveBeenCalledOnce()
    } finally {
      cleanup()
    }
  })

  /**
   * Single-path / no-duplicate guarantee:
   * When the plugin exports its own WebhookListenerPlugin the listener manifest id
   * must not be 'builtin:webhook-listener' — exactly one (plugin-owned) delivery path is active.
   */
  it('exactly one listener path active — plugin-owned listener has non-builtin manifest id', () => {
    const { kanbanDir, cleanup } = createTempWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const listener = sdk.capabilities!.webhookListener
      expect(listener).not.toBeNull()
      // Verify it is NOT the removed core built-in shim id.
      expect(listener?.manifest.id).not.toBe('builtin:webhook-listener')
      sdk.destroy()
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// SDK extension resolution tests (SPE-02)
// Verify that getExtension(id) surfaces plugin-contributed extension bags,
// and that the webhook compatibility shims remain functional alongside the
// extension access path.
//
// Uses a fake package name that doesn't exist in the workspace packages/
// directory so loadExternalModule skips the workspace-local path and resolves
// from the temp node_modules entry installed by installTempPackage.
// ---------------------------------------------------------------------------

/** Fake package name that is not present in workspace packages/ (won't be overridden). */
const EXT_TEST_PACKAGE = 'kanban-test-sdk-ext-pkg'

/** Mock package that exports BOTH webhookProviderPlugin AND sdkExtensionPlugin. */
const EXT_TEST_PACKAGE_SOURCE = `
const sdkExtensionPlugin = {
  manifest: { id: '${EXT_TEST_PACKAGE}', provides: ['sdk.extension'] },
  extensions: {
    listWebhooks: (workspaceRoot) => [{ id: 'wh_from_ext', url: 'http://ext.example.com', events: ['*'], active: true }],
    createWebhook: (workspaceRoot, input) => ({ id: 'wh_ext_created', url: input.url, events: input.events, active: true }),
    customMethod: () => 'ext-custom-result',
  },
};
module.exports = {
  webhookProviderPlugin: {
    manifest: { id: '${EXT_TEST_PACKAGE}', provides: ['webhook.delivery'] },
    listWebhooks: (root) => sdkExtensionPlugin.extensions.listWebhooks(root),
    createWebhook: (root, input) => sdkExtensionPlugin.extensions.createWebhook(root, input),
    updateWebhook: (root, id, updates) => ({ id, url: updates.url || 'http://ext-updated.example.com', events: updates.events || ['*'], active: updates.active !== false }),
    deleteWebhook: (root, id) => id === 'wh_ext_exists',
  },
  sdkExtensionPlugin,
  WebhookListenerPlugin: class WebhookListenerPlugin {
    constructor(workspaceRoot) {
      this.workspaceRoot = workspaceRoot;
      this.manifest = { id: '${EXT_TEST_PACKAGE}-listener', provides: ['event.listener'] };
    }
    register(_bus) {}
    unregister() {}
  },
};
`

function createExtTestWorkspace(): {
  workspaceDir: string
  kanbanDir: string
  cleanup: () => void
} {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ext-test-'))
  const kanbanDir = path.join(workspaceDir, '.kanban')
  fs.mkdirSync(kanbanDir, { recursive: true })
  fs.writeFileSync(
    path.join(workspaceDir, '.kanban.json'),
    JSON.stringify(
      {
        version: 2,
        boards: {
          default: {
            name: 'Default',
            columns: [],
            nextCardId: 1,
            defaultStatus: 'backlog',
            defaultPriority: 'medium',
          },
        },
        defaultBoard: 'default',
        kanbanDirectory: '.kanban',
        aiAgent: 'claude',
        defaultPriority: 'medium',
        defaultStatus: 'backlog',
        nextCardId: 1,
        showPriorityBadges: true,
        showAssignee: true,
        showDueDate: true,
        showLabels: true,
        showBuildWithAI: true,
        showFileName: false,
        markdownEditorMode: false,
        showDeletedColumn: false,
        boardZoom: 100,
        cardZoom: 100,
        port: 2954,
        // Point to the fake package so loadExternalModule skips workspace packages/
        plugins: {
          'webhook.delivery': { provider: EXT_TEST_PACKAGE },
        },
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  )
  return {
    workspaceDir,
    kanbanDir,
    cleanup: () => fs.rmSync(workspaceDir, { recursive: true, force: true }),
  }
}

describe('KanbanSDK – SDK extension resolution (SPE-02)', () => {
  let cleanupExtPackage: () => void

  beforeAll(() => {
    cleanupExtPackage = installTempPackage(EXT_TEST_PACKAGE, EXT_TEST_PACKAGE_SOURCE)
  })

  afterAll(() => {
    cleanupExtPackage?.()
  })

  it('getExtension returns undefined when no plugin has registered the given id', () => {
    const { kanbanDir, cleanup } = createExtTestWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const result = sdk.getExtension('nonexistent-plugin')
      expect(result).toBeUndefined()
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('getExtension returns the extension bag contributed by the matching plugin', () => {
    const { kanbanDir, cleanup } = createExtTestWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const ext = sdk.getExtension(EXT_TEST_PACKAGE)
      expect(ext).toBeDefined()
      expect(typeof ext?.listWebhooks).toBe('function')
      expect(typeof ext?.createWebhook).toBe('function')
      expect(typeof ext?.customMethod).toBe('function')
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('sdkExtensions array in capability bag contains the contributed extension entry', () => {
    const { kanbanDir, cleanup } = createExtTestWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const exts = sdk.capabilities!.sdkExtensions
      expect(exts).toBeDefined()
      expect(exts.length).toBeGreaterThanOrEqual(1)
      const entry = exts.find(e => e.id === EXT_TEST_PACKAGE)
      expect(entry).toBeDefined()
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('extension-path method returns results from the plugin extension bag', () => {
    const { kanbanDir, cleanup } = createExtTestWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const ext = sdk.getExtension<{ listWebhooks(root: string): Array<{ id: string }> }>(EXT_TEST_PACKAGE)
      const results = ext!.listWebhooks(sdk.workspaceRoot)
      expect(results[0].id).toBe('wh_from_ext')
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('compatibility shim listWebhooks still delegates to webhookProvider when extension is also present', () => {
    const { kanbanDir, cleanup } = createExtTestWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      // Shim must work regardless of whether an sdkExtensionPlugin is also present.
      const results = sdk.listWebhooks()
      expect(Array.isArray(results)).toBe(true)
      sdk.destroy()
    } finally {
      cleanup()
    }
  })

  it('compatibility shim createWebhook still works when extension is also present', async () => {
    const { kanbanDir, cleanup } = createExtTestWorkspace()
    try {
      const sdk = new KanbanSDK(kanbanDir)
      const created = await sdk.createWebhook({ url: 'http://shim-test.example.com', events: ['task.created'] })
      expect(created.id).toBeTruthy()
      sdk.destroy()
    } finally {
      cleanup()
    }
  })
})


