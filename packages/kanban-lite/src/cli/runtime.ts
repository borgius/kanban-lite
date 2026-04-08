import { KanbanSDK, PluginSettingsOperationError, createPluginSettingsErrorPayload } from '../sdk/KanbanSDK'
import { readConfig } from '../shared/config'
import { CARD_STATE_OPEN_DOMAIN, CardStateError, type KanbanCliPlugin } from '../sdk/types'
import { collectActiveExternalPackageNames, loadExternalModule } from '../sdk/plugins/index'
import {
  bold,
  green,
  printCardStateMutationModel,
  printCardStateReadModel,
  printCardStateStatus,
  printPluginSettingsDisabledSelection,
  printPluginSettingsInstallResult,
  printPluginSettingsList,
  printPluginSettingsReadModel,
  red,
  yellow,
} from './output'
import {
  getBoardId,
  getCliAuthStatus,
  handleCardStateError,
  parseJsonObjectFlag,
  runWithCliAuth,
  type Flags,
} from './shared'

const PLUGIN_SETTINGS_GLOBAL_FLAG_NAMES = ['config', 'dir', 'json', 'token'] as const

function formatPluginSettingsCommand(command: { command: string; args: string[] }): string {
  return [command.command, ...command.args].join(' ')
}

function assertNoUnexpectedPluginSettingsFlags(flags: Flags, allowedSubcommandFlags: readonly string[], commandLabel: string): void {
  const allowedFlags = new Set<string>([...PLUGIN_SETTINGS_GLOBAL_FLAG_NAMES, ...allowedSubcommandFlags])
  const unexpectedFlags = Object.keys(flags).filter(flag => !allowedFlags.has(flag))
  if (unexpectedFlags.length === 0) return

  const subcommandFlagUsage = allowedSubcommandFlags.length > 0
    ? ` only ${allowedSubcommandFlags.map(flag => `--${flag}`).join(', ')} plus`
    : ''
  console.error(red(`Error: ${commandLabel} accepts${subcommandFlagUsage} global CLI flags (--config, --dir, --json, --token).`))
  process.exit(1)
}

function handlePluginSettingsError(error: PluginSettingsOperationError, flags: Flags): never {
  if (flags.json) {
    console.error(JSON.stringify(error.payload, null, 2))
    process.exit(1)
  }

  console.error(red(`Error: ${error.payload.message}`))
  if (error.payload.capability) console.error(`Capability:        ${error.payload.capability}`)
  if (error.payload.providerId) console.error(`Provider:          ${error.payload.providerId}`)

  const details = error.payload.details
  if (details) {
    if (typeof details.packageName === 'string') console.error(`Package:           ${details.packageName}`)
    if (typeof details.scope === 'string') console.error(`Scope:             ${details.scope}`)
    if (typeof details.exitCode === 'number') console.error(`Exit code:         ${details.exitCode}`)

    const manualInstall = details.manualInstall as { command?: string; args?: string[] } | undefined
    if (manualInstall?.command && Array.isArray(manualInstall.args)) {
      console.error(`Manual install:    ${formatPluginSettingsCommand({ command: manualInstall.command, args: manualInstall.args })}`)
    }

    if (typeof details.stderr === 'string' && details.stderr.trim().length > 0) {
      console.error('Sanitized stderr:')
      console.error(details.stderr)
    } else if (typeof details.stdout === 'string' && details.stdout.trim().length > 0) {
      console.error('Sanitized stdout:')
      console.error(details.stdout)
    }
  }

  process.exit(1)
}

function exitPluginSettingsProviderNotFound(capability: string, providerId: string, flags: Flags): never {
  handlePluginSettingsError(new PluginSettingsOperationError(createPluginSettingsErrorPayload({
    code: 'plugin-settings-provider-not-found',
    message: 'Plugin provider not found',
    capability: capability as never,
    providerId,
  })), flags)
}

export async function cmdStorage(sdk: KanbanSDK, positional: string[], flags: Flags, workspaceRoot: string): Promise<void> {
  const sub = positional[0] || 'status'
  const storageStatus = sdk.getStorageStatus()
  const providers = storageStatus.providers
    ? {
        'card.storage': storageStatus.providers['card.storage'].provider,
        'attachment.storage': storageStatus.providers['attachment.storage'].provider,
      }
    : null

  if (sub === 'status') {
    const cfg = readConfig(workspaceRoot)
    if (flags.json) {
      console.log(JSON.stringify({
        storageEngine: storageStatus.storageEngine,
        sqlitePath: cfg.sqlitePath ?? null,
        providers,
        configStorage: storageStatus.configStorage,
        isFileBacked: storageStatus.isFileBacked,
        watchGlob: storageStatus.watchGlob,
      }))
    } else {
      console.log(`Storage engine: ${bold(storageStatus.storageEngine)}`)
      if (cfg.sqlitePath) console.log(`SQLite path:    ${cfg.sqlitePath}`)
      if (providers) {
        console.log(`Card provider:  ${providers['card.storage']}`)
        console.log(`Attach provider:${providers['attachment.storage']}`)
      }
      const configuredConfigStorage = storageStatus.configStorage.configured?.provider
      const effectiveConfigStorage = storageStatus.configStorage.effective?.provider ?? 'unavailable'
      const configStorageSummary = configuredConfigStorage
        ? `${configuredConfigStorage} -> ${effectiveConfigStorage} (${storageStatus.configStorage.mode})`
        : `${effectiveConfigStorage} (${storageStatus.configStorage.mode})`
      console.log(`Config store:   ${configStorageSummary}`)
      if (storageStatus.configStorage.failure) {
        console.log(`Config issue:   ${storageStatus.configStorage.failure.message}`)
      }
      console.log(`File-backed:    ${storageStatus.isFileBacked ? 'yes' : 'no'}`)
      if (storageStatus.watchGlob) console.log(`Watch glob:     ${storageStatus.watchGlob}`)
    }
    return
  }

  if (sub === 'migrate-to-sqlite') {
    const dbPath = typeof flags['sqlite-path'] === 'string' ? flags['sqlite-path'] : undefined
    console.log('Migrating cards to SQLite…')
    const count = await runWithCliAuth(sdk, flags, () => sdk.migrateToSqlite(dbPath))
    if (flags.json) {
      console.log(JSON.stringify({ ok: true, count, storageEngine: 'sqlite' }))
    } else {
      console.log(green(`✓ Migrated ${count} card(s) to SQLite`))
      const cfg = readConfig(workspaceRoot)
      console.log(`  Database: ${cfg.sqlitePath ?? '.kanban/kanban.db'}`)
    }
    return
  }

  if (sub === 'migrate-to-markdown') {
    console.log('Migrating cards to markdown…')
    const count = await runWithCliAuth(sdk, flags, () => sdk.migrateToMarkdown())
    if (flags.json) {
      console.log(JSON.stringify({ ok: true, count, storageEngine: 'markdown' }))
    } else {
      console.log(green(`✓ Migrated ${count} card(s) to markdown`))
    }
    return
  }

  console.error(red(`Unknown storage sub-command: ${sub}`))
  console.error('Usage: kl storage <status|migrate-to-sqlite|migrate-to-markdown>')
  process.exit(1)
}

export async function cmdCardState(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const sub = positional[0] || 'status'
  const boardId = getBoardId(flags)

  if (sub === 'status' && !positional[1]) {
    const status = sdk.getCardStateStatus()
    if (flags.json) {
      console.log(JSON.stringify(status, null, 2))
    } else {
      printCardStateStatus(status)
    }
    return
  }

  const cardId = positional[1]
  if (!cardId) {
    console.error(red('Usage: kl card-state <status [id]|open <id>|read <id>>'))
    process.exit(1)
  }

  try {
    if (sub === 'status') {
      const payload = await runWithCliAuth(sdk, flags, async () => {
        const unread = await sdk.getUnreadSummary(cardId, boardId)
        const open = await sdk.getCardState(cardId, boardId, CARD_STATE_OPEN_DOMAIN)
        return {
          cardId: unread.cardId,
          boardId: unread.boardId,
          cardState: { unread, open },
        }
      })
      if (flags.json) {
        console.log(JSON.stringify(payload, null, 2))
      } else {
        printCardStateReadModel('Card-state status for', payload)
      }
      return
    }

    if (sub === 'open') {
      const payload = await runWithCliAuth(sdk, flags, async () => {
        const unread = await sdk.markCardOpened(cardId, boardId)
        const open = await sdk.getCardState(unread.cardId, unread.boardId, CARD_STATE_OPEN_DOMAIN)
        return { unread, cardState: { unread, open } }
      })
      if (flags.json) {
        console.log(JSON.stringify(payload, null, 2))
      } else {
        printCardStateMutationModel('Opened', payload)
      }
      return
    }

    if (sub === 'read') {
      const payload = await runWithCliAuth(sdk, flags, async () => {
        const unread = await sdk.markCardRead(cardId, boardId)
        const open = await sdk.getCardState(unread.cardId, unread.boardId, CARD_STATE_OPEN_DOMAIN)
        return { unread, cardState: { unread, open } }
      })
      if (flags.json) {
        console.log(JSON.stringify(payload, null, 2))
      } else {
        printCardStateMutationModel('Marked read', payload)
      }
      return
    }

    console.error(red(`Unknown card-state sub-command: ${sub}`))
    console.error('Usage: kl card-state <status [id]|open <id>|read <id>>')
    process.exit(1)
  } catch (err) {
    if (err instanceof CardStateError) handleCardStateError(err, flags)
    throw err
  }
}

export function loadCliPlugins(workspaceRoot: string): KanbanCliPlugin[] {
  let config: ReturnType<typeof readConfig>
  try {
    config = readConfig(workspaceRoot)
  } catch {
    return []
  }
  const plugins: KanbanCliPlugin[] = []
  for (const pkg of collectActiveExternalPackageNames(config)) {
    try {
      const mod = loadExternalModule(pkg) as Record<string, unknown>
      const cli = mod.cliPlugin
      if (cli && typeof (cli as KanbanCliPlugin).run === 'function') {
        plugins.push(cli as KanbanCliPlugin)
      }
    } catch {
      continue
    }
  }
  return plugins
}

export function findCliPlugin(cliPlugins: readonly KanbanCliPlugin[], command: string): KanbanCliPlugin | undefined {
  return cliPlugins.find((plugin) => plugin.command === command || plugin.aliases?.includes(command))
}

export async function runCliPlugin(
  plugin: KanbanCliPlugin,
  positional: string[],
  flags: Flags,
  workspaceRoot: string,
  sdk: KanbanSDK,
): Promise<void> {
  await plugin.run(positional, flags, {
    workspaceRoot,
    sdk,
    runWithCliAuth: (fn) => runWithCliAuth(sdk, flags, fn),
  })
}

export async function cmdAuth(
  sdk: KanbanSDK,
  positional: string[],
  flags: Flags,
  cliPlugins: KanbanCliPlugin[],
  workspaceRoot: string,
): Promise<void> {
  const sub = positional[0] || 'status'
  if (sub !== 'status') {
    const authPlugin = findCliPlugin(cliPlugins, 'auth')
    if (authPlugin) {
      await runCliPlugin(authPlugin, positional, flags, workspaceRoot, sdk)
      return
    }
    console.error(red(`Unknown auth sub-command: ${sub}`))
    console.error('Usage: kl auth status')
    process.exit(1)
  }

  const status = getCliAuthStatus(sdk, flags)
  if (flags.json) {
    console.log(JSON.stringify(status, null, 2))
    return
  }

  console.log(`Identity provider: ${bold(status.identityProvider)}`)
  console.log(`Policy provider:   ${bold(status.policyProvider)}`)
  console.log(`Configured:        ${status.configured ? green('yes') : yellow('no')}`)
  console.log(`Token present:     ${status.tokenPresent ? green('yes') : yellow('no')}`)
  if (status.tokenSource) console.log(`Token source:      ${status.tokenSource}`)
  console.log(`Transport:         ${status.transport}`)
}

export async function cmdPluginSettings(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const sub = positional[0] || 'list'

  try {
    switch (sub) {
      case 'list': {
        assertNoUnexpectedPluginSettingsFlags(flags, [], 'plugin-settings list')
        const inventory = await runWithCliAuth(sdk, flags, () => sdk.listPluginSettings())
        if (flags.json) {
          console.log(JSON.stringify(inventory, null, 2))
        } else {
          printPluginSettingsList(inventory)
        }
        return
      }
      case 'show': {
        assertNoUnexpectedPluginSettingsFlags(flags, [], 'plugin-settings show')
        const capability = positional[1]
        const providerId = positional[2]
        if (!capability || !providerId || positional[3]) {
          console.error(red('Usage: kl plugin-settings show <capability> <provider>'))
          process.exit(1)
        }

        const provider = await runWithCliAuth(sdk, flags, () =>
          sdk.getPluginSettings(capability as never, providerId),
        )
        if (!provider) exitPluginSettingsProviderNotFound(capability, providerId, flags)

        if (flags.json) {
          console.log(JSON.stringify(provider, null, 2))
        } else {
          printPluginSettingsReadModel(provider)
        }
        return
      }
      case 'select': {
        assertNoUnexpectedPluginSettingsFlags(flags, [], 'plugin-settings select')
        const capability = positional[1]
        const providerId = positional[2]
        if (!capability || !providerId || positional[3]) {
          console.error(red('Usage: kl plugin-settings select <capability> <provider>'))
          process.exit(1)
        }

        const provider = await runWithCliAuth(sdk, flags, () =>
          sdk.selectPluginSettingsProvider(capability as never, providerId),
        )
        if (flags.json) {
          console.log(JSON.stringify(provider, null, 2))
        } else if (provider) {
          console.log(green('Selected plugin provider.'))
          printPluginSettingsReadModel(provider)
        } else {
          console.log(green('Disabled plugin provider.'))
          printPluginSettingsDisabledSelection(capability)
        }
        return
      }
      case 'update-options': {
        assertNoUnexpectedPluginSettingsFlags(flags, ['options'], 'plugin-settings update-options')
        const capability = positional[1]
        const providerId = positional[2]
        if (!capability || !providerId || positional[3]) {
          console.error(red('Usage: kl plugin-settings update-options <capability> <provider> --options <json|@file>'))
          process.exit(1)
        }
        if (typeof flags.options !== 'string') {
          console.error(red('Error: --options is required and must be a JSON object or @path to a JSON file'))
          process.exit(1)
        }

        const nextOptions = await parseJsonObjectFlag(flags.options, 'options')
        const provider = await runWithCliAuth(sdk, flags, () =>
          sdk.updatePluginSettingsOptions(capability as never, providerId, nextOptions),
        )
        if (flags.json) {
          console.log(JSON.stringify(provider, null, 2))
        } else {
          console.log(green('Updated plugin options.'))
          printPluginSettingsReadModel(provider)
        }
        return
      }
      case 'install': {
        assertNoUnexpectedPluginSettingsFlags(flags, ['scope'], 'plugin-settings install')
        const packageName = positional[1]
        if (!packageName || positional[2]) {
          console.error(red('Usage: kl plugin-settings install <packageName> --scope <workspace|global>'))
          process.exit(1)
        }

        const result = await runWithCliAuth(sdk, flags, () => sdk.installPluginSettingsPackage({
          packageName,
          scope: flags.scope,
        }))
        if (flags.json) {
          console.log(JSON.stringify(result, null, 2))
        } else {
          printPluginSettingsInstallResult(result)
        }
        return
      }
      default:
        console.error(red(`Unknown plugin-settings sub-command: ${sub}`))
        console.error('Usage: kl plugin-settings <list|show|select|update-options|install>')
        process.exit(1)
    }
  } catch (error) {
    if (error instanceof PluginSettingsOperationError) handlePluginSettingsError(error, flags)
    throw error
  }
}
