import { z } from 'zod'
import { KanbanSDK, PluginSettingsOperationError, createPluginSettingsErrorPayload } from '../sdk/KanbanSDK'
import { buildChecklistReadModel } from '../sdk/modules/checklist'
import { resolveMcpPlugins, type CardStateCursor, type McpToolContext } from '../sdk/plugins'
import {
  buildMcpCardStateMutationModel,
  buildMcpCardStateReadModel,
  createMcpErrorResult,
  createMcpJsonResult,
  resolveMcpCardId,
  resolveOptionalBoardId,
  runWithResolvedMcpCardId,
  type McpAuthRunner,
  type McpPluginSettingsInstallModel,
  type McpPluginSettingsListModel,
  type McpPluginSettingsReadModel,
  type McpToolRegistrar,
} from './shared'

function registerJsonTool<TArgs extends Record<string, unknown>>(
  server: McpToolRegistrar,
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  handler: (args: TArgs) => Promise<unknown>,
): void {
  server.tool(name, description, inputSchema, async (args) => {
    try {
      return createMcpJsonResult(await handler(args as TArgs))
    } catch (err) {
      return createMcpErrorResult(err)
    }
  })
}

export function registerCardStateMcpTools(
  server: McpToolRegistrar,
  options: {
    sdk: KanbanSDK
    runWithAuth: McpAuthRunner
  },
): string[] {
  const registeredNames = [
    'get_card_state_status',
    'get_card_state',
    'open_card',
    'read_card',
  ]

  registerJsonTool(
    server,
    'get_card_state_status',
    'Get the active card-state provider status for this workspace.',
    {},
    async () => options.sdk.getCardStateStatus(),
  )

  registerJsonTool(
    server,
    'get_card_state',
    'Get the side-effect-free unread/open summary for one card. Supports partial ID matching and never mutates unread state implicitly.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ boardId, cardId }) => {
      const resolvedBoardId = resolveOptionalBoardId(boardId)
      return options.runWithAuth(async () => {
        const resolvedId = await resolveMcpCardId(options.sdk, String(cardId), resolvedBoardId)
        return buildMcpCardStateReadModel(options.sdk, resolvedId, resolvedBoardId)
      })
    },
  )

  registerJsonTool(
    server,
    'open_card',
    'Persist an explicit actor-scoped open mutation through the shared SDK card-state APIs. This acknowledges unread activity and records open-card state without changing active-card UI state.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ boardId, cardId }) => {
      const resolvedBoardId = resolveOptionalBoardId(boardId)
      return options.runWithAuth(async () => {
        const resolvedId = await resolveMcpCardId(options.sdk, String(cardId), resolvedBoardId)
        const unread = await options.sdk.markCardOpened(resolvedId, resolvedBoardId)
        return buildMcpCardStateMutationModel(options.sdk, unread)
      })
    },
  )

  registerJsonTool(
    server,
    'read_card',
    'Persist an explicit actor-scoped unread acknowledgement through the shared SDK card-state APIs without changing open-card state.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      readThrough: z.object({
        cursor: z.string().describe('Opaque unread activity cursor to acknowledge explicitly.'),
        updatedAt: z.string().optional().describe('Optional timestamp associated with the cursor.'),
      }).optional().describe('Optional explicit unread cursor to acknowledge instead of the latest activity.'),
    },
    async ({ boardId, cardId, readThrough }) => {
      const resolvedBoardId = resolveOptionalBoardId(boardId)
      return options.runWithAuth(async () => {
        const resolvedId = await resolveMcpCardId(options.sdk, String(cardId), resolvedBoardId)
        const unread = await options.sdk.markCardRead(
          resolvedId,
          resolvedBoardId,
          readThrough as CardStateCursor | undefined,
        )
        return buildMcpCardStateMutationModel(options.sdk, unread)
      })
    },
  )

  return registeredNames
}

export function registerPluginSettingsMcpTools(
  server: McpToolRegistrar,
  options: {
    sdk: KanbanSDK
    runWithAuth: McpAuthRunner
  },
): string[] {
  const registeredNames = [
    'list_plugin_settings',
    'get_plugin_settings',
    'select_plugin_settings_provider',
    'update_plugin_settings_options',
    'install_plugin_settings_package',
  ]

  registerJsonTool(
    server,
    'list_plugin_settings',
    'List the capability-grouped plugin provider inventory for this workspace, including selected config.storage resolution state when present.',
    {},
    async () => {
      const payload: McpPluginSettingsListModel = await options.runWithAuth(() => options.sdk.listPluginSettings())
      return payload
    },
  )

  registerJsonTool(
    server,
    'get_plugin_settings',
    'Read the redacted provider state for one capability/provider pair, including configured-versus-effective config.storage resolution details when applicable.',
    {
      capability: z.string().describe('Capability namespace to inspect (for example auth.identity, card.storage, or config.storage).'),
      providerId: z.string().describe('Provider identifier to read for the capability.'),
    },
    async ({ capability, providerId }) => {
      const payload: McpPluginSettingsReadModel | null = await options.runWithAuth(() =>
        options.sdk.getPluginSettings(String(capability) as never, String(providerId)),
      )
      if (!payload) {
        throw new PluginSettingsOperationError(createPluginSettingsErrorPayload({
          code: 'plugin-settings-provider-not-found',
          message: 'Plugin provider not found',
          capability: String(capability) as never,
          providerId: String(providerId),
        }))
      }
      return payload
    },
  )

  registerJsonTool(
    server,
    'select_plugin_settings_provider',
    'Persist the selected provider for a plugin capability and return the redacted provider read model. Rejected config.storage topology mutations are surfaced as explicit errors.',
    {
      capability: z.string().describe('Capability namespace to update (for example auth.identity, card.storage, or config.storage).'),
      providerId: z.string().describe('Provider identifier to select for the capability.'),
    },
    async ({ capability, providerId }) =>
      options.runWithAuth(() =>
        options.sdk.selectPluginSettingsProvider(String(capability) as never, String(providerId)),
      ),
  )

  registerJsonTool(
    server,
    'update_plugin_settings_options',
    'Persist provider options for a capability/provider pair and return the redacted provider read model, preserving explicit config.storage error/degraded state when reported by the SDK.',
    {
      capability: z.string().describe('Capability namespace to update (for example auth.identity, card.storage, or config.storage).'),
      providerId: z.string().describe('Provider identifier whose options should be updated.'),
      options: z.record(z.string(), z.unknown()).describe('Provider options payload to persist under the selected capability/provider pair.'),
    },
    async ({ capability, providerId, options: nextOptions }) => {
      const payload: McpPluginSettingsReadModel = await options.runWithAuth(() =>
        options.sdk.updatePluginSettingsOptions(
          String(capability) as never,
          String(providerId),
          nextOptions as Record<string, unknown>,
        ),
      )
      return payload
    },
  )

  registerJsonTool(
    server,
    'install_plugin_settings_package',
    'Install a supported plugin package with the shared SDK guardrails and return the redacted install result.',
    {
      packageName: z.string().describe('Exact unscoped kl-* package name to install.'),
      scope: z.enum(['workspace', 'global']).describe('Install destination for the supported plugin package.'),
    },
    async ({ packageName, scope }) => {
      const payload: McpPluginSettingsInstallModel = await options.runWithAuth(() => options.sdk.installPluginSettingsPackage({
        packageName,
        scope,
      }))
      return payload
    },
  )

  return registeredNames
}

export function registerChecklistMcpTools(
  server: McpToolRegistrar,
  options: {
    sdk: KanbanSDK
    runWithAuth: McpAuthRunner
  },
): string[] {
  const registeredNames = [
    'list_card_checklist_items',
    'add_card_checklist_item',
    'edit_card_checklist_item',
    'delete_card_checklist_item',
    'check_card_checklist_item',
    'uncheck_card_checklist_item',
  ]

  registerJsonTool(
    server,
    'list_card_checklist_items',
    'List the checklist items for a card, including expectedRaw values for optimistic concurrency.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
    },
    async ({ boardId, cardId }) => {
      const resolvedBoardId = resolveOptionalBoardId(boardId)
      return runWithResolvedMcpCardId(options.sdk, options.runWithAuth, String(cardId), resolvedBoardId, async (resolvedId) => {
        const card = await options.sdk.getCard(resolvedId, resolvedBoardId)
        if (!card) throw new Error(`Card not found: ${cardId}`)
        return buildChecklistReadModel(card)
      })
    },
  )

  registerJsonTool(
    server,
    'add_card_checklist_item',
    'Add a checklist item to a card and return the caller-scoped checklist payload. expectedToken is required to avoid lost concurrent appends.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      title: z.string().describe('Checklist item title.'),
      description: z.string().optional().describe('Optional checklist item description (multiline supported).'),
      expectedToken: z.string().describe('Checklist token from list_card_checklist_items required for optimistic concurrency.'),
    },
    async ({ boardId, cardId, title, description, expectedToken }) => {
      const resolvedBoardId = resolveOptionalBoardId(boardId)
      return runWithResolvedMcpCardId(options.sdk, options.runWithAuth, String(cardId), resolvedBoardId, async (resolvedId) =>
        buildChecklistReadModel(await options.sdk.addChecklistItem(resolvedId, String(title), typeof description === 'string' ? description : '', String(expectedToken), resolvedBoardId))
      )
    },
  )

  registerJsonTool(
    server,
    'edit_card_checklist_item',
    'Edit an existing checklist item. modifiedAt is recommended to avoid stale overwrites.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      index: z.number().int().nonnegative().describe('Checklist item index.'),
      title: z.string().describe('Replacement checklist item title.'),
      description: z.string().optional().describe('Replacement checklist item description (multiline supported).'),
      modifiedAt: z.string().optional().describe('ISO timestamp of the item currently known to the caller, used for stale-write protection.'),
    },
    async ({ boardId, cardId, index, title, description, modifiedAt }) => {
      const resolvedBoardId = resolveOptionalBoardId(boardId)
      return runWithResolvedMcpCardId(options.sdk, options.runWithAuth, String(cardId), resolvedBoardId, async (resolvedId) =>
        buildChecklistReadModel(await options.sdk.editChecklistItem(resolvedId, index as number, String(title), typeof description === 'string' ? description : '', typeof modifiedAt === 'string' ? modifiedAt : undefined, resolvedBoardId))
      )
    },
  )

  registerJsonTool(
    server,
    'delete_card_checklist_item',
    'Delete an existing checklist item. modifiedAt is recommended to avoid stale deletes.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      index: z.number().int().nonnegative().describe('Checklist item index.'),
      modifiedAt: z.string().optional().describe('ISO timestamp of the item currently known to the caller, used for stale-write protection.'),
    },
    async ({ boardId, cardId, index, modifiedAt }) => {
      const resolvedBoardId = resolveOptionalBoardId(boardId)
      return runWithResolvedMcpCardId(options.sdk, options.runWithAuth, String(cardId), resolvedBoardId, async (resolvedId) =>
        buildChecklistReadModel(await options.sdk.deleteChecklistItem(resolvedId, index as number, typeof modifiedAt === 'string' ? modifiedAt : undefined, resolvedBoardId))
      )
    },
  )

  registerJsonTool(
    server,
    'check_card_checklist_item',
    'Mark a checklist item as checked. modifiedAt is recommended to avoid stale writes.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      index: z.number().int().nonnegative().describe('Checklist item index.'),
      modifiedAt: z.string().optional().describe('ISO timestamp of the item currently known to the caller, used for stale-write protection.'),
    },
    async ({ boardId, cardId, index, modifiedAt }) => {
      const resolvedBoardId = resolveOptionalBoardId(boardId)
      return runWithResolvedMcpCardId(options.sdk, options.runWithAuth, String(cardId), resolvedBoardId, async (resolvedId) =>
        buildChecklistReadModel(await options.sdk.checkChecklistItem(resolvedId, index as number, typeof modifiedAt === 'string' ? modifiedAt : undefined, resolvedBoardId))
      )
    },
  )

  registerJsonTool(
    server,
    'uncheck_card_checklist_item',
    'Mark a checklist item as unchecked. modifiedAt is recommended to avoid stale writes.',
    {
      boardId: z.string().optional().describe('Board ID (uses default board if omitted)'),
      cardId: z.string().describe('Card ID (or partial ID)'),
      index: z.number().int().nonnegative().describe('Checklist item index.'),
      modifiedAt: z.string().optional().describe('ISO timestamp of the item currently known to the caller, used for stale-write protection.'),
    },
    async ({ boardId, cardId, index, modifiedAt }) => {
      const resolvedBoardId = resolveOptionalBoardId(boardId)
      return runWithResolvedMcpCardId(options.sdk, options.runWithAuth, String(cardId), resolvedBoardId, async (resolvedId) =>
        buildChecklistReadModel(await options.sdk.uncheckChecklistItem(resolvedId, index as number, typeof modifiedAt === 'string' ? modifiedAt : undefined, resolvedBoardId))
      )
    },
  )

  return registeredNames
}

export function createMcpPluginContext(options: {
  sdk: KanbanSDK
  workspaceRoot: string
  kanbanDir: string
  runWithAuth: McpAuthRunner
}): McpToolContext {
  return {
    sdk: options.sdk,
    workspaceRoot: options.workspaceRoot,
    kanbanDir: options.kanbanDir,
    runWithAuth: options.runWithAuth,
    toErrorResult: createMcpErrorResult,
  }
}

export function registerPluginMcpTools(
  server: McpToolRegistrar,
  config: Parameters<typeof resolveMcpPlugins>[0],
  ctx: McpToolContext,
): string[] {
  const registeredNames: string[] = []
  const seenNames = new Set<string>()

  for (const plugin of resolveMcpPlugins(config)) {
    for (const tool of plugin.registerTools(ctx)) {
      if (seenNames.has(tool.name)) {
        throw new Error(`Duplicate MCP tool registration attempted for "${tool.name}".`)
      }
      seenNames.add(tool.name)
      registeredNames.push(tool.name)
      server.tool(tool.name, tool.description, tool.inputSchema(z), async (args) => tool.handler(args, ctx))
    }
  }

  return registeredNames
}
