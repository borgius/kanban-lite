import type { SDKEventListenerPlugin } from 'kanban-lite/sdk'
import { createCronOptionsSchema } from './schema'
import {
  CRON_PACKAGE_ID,
  CRON_PROVIDER_ID,
  CronListenerPlugin,
  getCronRuntimeEventDeclarations,
} from './runtime'

export type {
  CronRuntimeEventConfig,
} from './runtime'
export type {
  CronPluginOptionsSchemaFactory,
} from './schema'
export {
  CRON_PACKAGE_ID,
  CRON_PROVIDER_ID,
  CronListenerPlugin,
  getCronRuntimeEventDeclarations,
} from './runtime'
export {
  createCronOptionsSchema,
  validateCronPluginOptions,
} from './schema'

export const cronListenerPlugin: SDKEventListenerPlugin & {
  optionsSchema: typeof createCronOptionsSchema
} = {
  manifest: {
    id: CRON_PACKAGE_ID,
    provides: ['event.listener'],
  },
  optionsSchema: createCronOptionsSchema,
  register(): void {
    // Discovery/schema surfaces use this lightweight export.
  },
  unregister(): void {
    // Discovery/schema surfaces use this lightweight export.
  },
}

export const pluginManifest = {
  id: CRON_PACKAGE_ID,
  capabilities: {
    'cron.runtime': [CRON_PROVIDER_ID] as const,
  },
  integrations: ['event.listener'] as const,
} as const

export const optionsSchemas: Record<string, typeof createCronOptionsSchema> = {
  [CRON_PROVIDER_ID]: createCronOptionsSchema,
  [CRON_PACKAGE_ID]: createCronOptionsSchema,
}

const cronPluginPackage = {
  pluginManifest,
  cronListenerPlugin,
  optionsSchemas,
}

export default cronPluginPackage
