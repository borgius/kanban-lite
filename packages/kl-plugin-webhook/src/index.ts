import type {
  CliPluginContext,
  KanbanCliPlugin,
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactionPolicy,
  Webhook,
  KanbanSDK,
} from 'kanban-lite/sdk'
import {
  SDK_AFTER_EVENT_NAMES,
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
} from './helpers'

export type {
  CliPluginContext,
  KanbanCliPlugin,
  McpPluginRegistration,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
  SDKExtensionPlugin,
  StandaloneHttpPlugin,
  Webhook,
  WebhookProviderPlugin
} from 'kanban-lite/sdk'
export type { WebhookSdkExtensions } from './plugins'
export {
  WebhookListenerPlugin,
  webhookProviderPlugin,
  sdkExtensionPlugin,
  mcpPlugin,
  standaloneHttpPlugin,
} from './plugins'

function _bold(s: string): string {
  return `\x1b[1m${s}\x1b[0m`
}
function _green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`
}
function _red(s: string): string {
  return `\x1b[31m${s}\x1b[0m`
}
function _dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`
}

/**
 * CLI plugin that contributes the `webhooks` top-level command family to the
 * `kl` CLI.
 *
 * This plugin owns the canonical CLI implementation for webhook CRUD.
 * The core `kl` CLI loads this plugin automatically when `kl-plugin-webhook`
 * is active (the default for all workspaces) and routes the `webhooks`,
 * `webhook`, and `wh` commands here.
 *
 * Sub-commands: `list` (default), `add`, `update`, `remove` / `rm`
 *
 * @example
 * ```sh
 * kl webhooks
 * kl webhooks add --url https://example.com/hook --events task.created
 * kl webhooks update wh_abc --active false
 * kl webhooks remove wh_abc
 * ```
 */
export const cliPlugin: KanbanCliPlugin = {
  manifest: { id: 'webhooks' },
  command: 'webhooks',
  aliases: ['webhook', 'wh'],
  async run(
    subArgs: string[],
    flags: Record<string, string | boolean | string[]>,
    context: CliPluginContext
  ): Promise<void> {
    const { workspaceRoot } = context
    const subcommand = subArgs[0] || 'list'
    const sdk = context.sdk
    const runCliMutation = <T>(fn: () => Promise<T>): Promise<T> =>
      context.runWithCliAuth ? context.runWithCliAuth(fn) : fn()

    // Helpers that delegate through SDK auth when the core CLI context is present,
    // falling back to direct local calls for backward compatibility (e.g. unit tests).
    const _list = (): Webhook[] => (sdk ? sdk.listWebhooks() : listWebhooks(workspaceRoot))
    const _create = (input: {
      url: string
      events: string[]
      secret?: string
    }): Promise<Webhook> =>
      sdk
        ? runCliMutation(() => Promise.resolve(sdk.createWebhook(input)))
        : Promise.resolve(createWebhook(workspaceRoot, input))
    const _delete = (id: string): Promise<boolean> =>
      sdk
        ? runCliMutation(() => Promise.resolve(sdk.deleteWebhook(id)))
        : Promise.resolve(deleteWebhook(workspaceRoot, id))
    const _update = (
      id: string,
      updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>>
    ): Promise<Webhook | null> =>
      sdk
        ? runCliMutation(() => Promise.resolve(sdk.updateWebhook(id, updates)))
        : Promise.resolve(updateWebhook(workspaceRoot, id, updates))

    switch (subcommand) {
      case 'list': {
        const webhooks = _list()
        if (flags.json) {
          console.log(JSON.stringify(webhooks, null, 2))
        } else if (webhooks.length === 0) {
          console.log(_dim('  No webhooks registered.'))
        } else {
          console.log(
            `  ${_dim('ID'.padEnd(22))}  ${_dim('URL'.padEnd(40))}  ${_dim('EVENTS'.padEnd(20))}  ${_dim('ACTIVE')}`
          )
          console.log(_dim('  ' + '-'.repeat(90)))
          for (const w of webhooks) {
            const events = w.events.join(', ')
            const active = w.active ? _green('yes') : _red('no')
            console.log(
              `  ${_bold(w.id.padEnd(22))}  ${w.url.padEnd(40)}  ${events.padEnd(20)}  ${active}`
            )
          }
        }
        break
      }
      case 'add': {
        const url = typeof flags.url === 'string' ? flags.url : ''
        if (!url) {
          console.error(
            _red('Usage: kl webhooks add --url <url> [--events <event1,event2>] [--secret <key>]')
          )
          process.exit(1)
        }
        const events =
          typeof flags.events === 'string' ? flags.events.split(',').map((e) => e.trim()) : ['*']
        const secret = typeof flags.secret === 'string' ? flags.secret : undefined
        const webhook = await _create({ url, events, secret })
        if (flags.json) {
          console.log(JSON.stringify(webhook, null, 2))
        } else {
          console.log(_green(`Created webhook: ${webhook.id}`))
          console.log(`  URL:    ${webhook.url}`)
          console.log(`  Events: ${webhook.events.join(', ')}`)
          if (webhook.secret) console.log(`  Secret: ${_dim('(configured)')}`)
        }
        break
      }
      case 'remove':
      case 'rm': {
        const webhookId = subArgs[1]
        if (!webhookId) {
          console.error(_red('Usage: kl webhooks remove <id>'))
          process.exit(1)
        }
        const removed = await _delete(webhookId)
        if (removed) {
          console.log(_green(`Removed webhook: ${webhookId}`))
        } else {
          console.error(_red(`Webhook not found: ${webhookId}`))
          process.exit(1)
        }
        break
      }
      case 'update': {
        const webhookId = subArgs[1]
        if (!webhookId) {
          console.error(
            _red(
              'Usage: kl webhooks update <id> [--url <url>] [--events <e1,e2>] [--secret <key>] [--active true|false]'
            )
          )
          process.exit(1)
        }
        const updates: Partial<Pick<Webhook, 'url' | 'events' | 'secret' | 'active'>> = {}
        if (typeof flags.url === 'string') updates.url = flags.url
        if (typeof flags.events === 'string')
          updates.events = flags.events.split(',').map((e) => e.trim())
        if (typeof flags.secret === 'string') updates.secret = flags.secret
        if (typeof flags.active === 'string') updates.active = flags.active === 'true'
        const updated = await _update(webhookId, updates)
        if (!updated) {
          console.error(_red(`Webhook not found: ${webhookId}`))
          process.exit(1)
        }
        if (flags.json) {
          console.log(JSON.stringify(updated, null, 2))
        } else {
          console.log(_green(`Updated webhook: ${updated.id}`))
          console.log(`  URL:    ${updated.url}`)
          console.log(`  Events: ${updated.events.join(', ')}`)
          console.log(`  Active: ${updated.active ? _green('yes') : _red('no')}`)
        }
        break
      }
      default:
        console.error(_red(`Unknown webhooks subcommand: ${subcommand}`))
        console.error('Available: list, add, update, remove')
        process.exit(1)
    }
  }
}

/** Standard package manifest for engine discovery. */
export const pluginManifest = {
  id: 'kl-plugin-webhook',
  capabilities: {
    'webhook.delivery': ['webhooks'] as const
  },
  integrations: ['standalone.http', 'cli', 'mcp.tools', 'sdk.extension', 'event.listener'] as const
} as const

// ---------------------------------------------------------------------------
// Options schema — plugin-settings discovery
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: ['read', 'list', 'error']
}

async function getAvailableEvents(sdk?: KanbanSDK): Promise<string[]> {
  const events = typeof sdk?.listAvailableEvents === 'function'
    ? await sdk.listAvailableEvents({ type: 'after' })
    : undefined
  const configuredEvents = events
    ?.filter((event) => event.phase === 'after')
    .map((event) => event.event)
  const names = configuredEvents && configuredEvents.length > 0
    ? configuredEvents
    : [...SDK_AFTER_EVENT_NAMES]
  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}


function createWebhookOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        webhooks: {
          type: 'array',
          title: 'Webhooks',
          description: 'Registered webhook endpoints.',
          items: {
            type: 'object',
            required: ['url', 'events', 'active'],
            additionalProperties: false,
            properties: {
              id: {
                type: 'string',
                title: 'ID',
                description: 'Unique webhook identifier. Leave empty to auto-generate it on first save.'
              },
              url: {
                type: 'string',
                title: 'URL',
                description: 'HTTP(S) URL that receives POST requests with event payloads.',
                format: 'uri'
              },
              events: {
                type: 'array',
                title: 'Events',
                description: 'Event names to subscribe to, or ["*"] for all events.',
                items: {
                  type: 'string',
                  enum: getAvailableEvents
                }
              },
              secret: {
                type: 'string',
                title: 'Signing secret',
                description: 'Optional HMAC-SHA256 signing key for payload verification.'
              },
              active: {
                type: 'boolean',
                title: 'Active',
                description: 'Whether this webhook is active.',
                default: true
              }
            }
          }
        }
      }
    },
    secrets: [{ path: 'webhooks.*.secret', redaction: WEBHOOK_SECRET_REDACTION }]
  }
}

/** Options schemas keyed by provider id for plugin-settings discovery. */
export const optionsSchemas: Record<string, () => PluginSettingsOptionsSchemaMetadata> = {
  webhooks: createWebhookOptionsSchema
}
