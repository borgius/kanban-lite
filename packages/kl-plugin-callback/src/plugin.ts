import type { EventBus, KanbanSDK, SDKEventListenerPlugin } from 'kanban-lite/sdk'

import {
  CALLBACK_PACKAGE_ID,
  CALLBACK_PROVIDER_ID,
  type CallbackPluginOptionsSchemaFactory,
  type CallbackRuntimeContext,
  getAvailableCallbackEventNames,
  isAfterEventPayload,
  runMatchingHandlers,
} from './handlers'
import { createCallbackOptionsSchema } from './schema'

export type {
  CallbackHandlerConfig,
  CallbackHandlerType,
  CallbackPluginOptions,
  CallbackPluginOptionsSchemaFactory,
  CallbackProcessEnvelope,
  CallbackRuntimeContext,
  KanbanSDK,
  PluginSettingsOptionsSchemaMetadata,
  SDKEventListenerPlugin,
} from './handlers'

export class CallbackListenerPlugin implements SDKEventListenerPlugin {
  readonly manifest = {
    id: CALLBACK_PACKAGE_ID,
    provides: ['event.listener'] as const,
  }

  readonly optionsSchema = createCallbackOptionsSchema

  private _unsubscribe: (() => void) | null = null
  private _workspaceRoot: string | null
  private _sdk: KanbanSDK | null = null

  constructor(workspaceRoot?: string) {
    this._workspaceRoot = workspaceRoot ?? null
  }

  attachRuntimeContext(context: CallbackRuntimeContext): void {
    this._workspaceRoot = context.workspaceRoot
    this._sdk = context.sdk
  }

  register(bus: EventBus): void {
    if (this._unsubscribe) return
    if (!this._workspaceRoot) {
      console.error('[kl-plugin-callback] callback runtime listener is missing a workspace root.')
      return
    }

    const availableAfterEvents = new Set(getAvailableCallbackEventNames(this._sdk ?? undefined))

    this._unsubscribe = bus.onAny((eventName, payload) => {
      if (availableAfterEvents.size > 0 && !availableAfterEvents.has(eventName)) return
      if (!isAfterEventPayload(payload.data) || payload.data.event !== eventName) return

      void runMatchingHandlers({
        workspaceRoot: this._workspaceRoot as string,
        sdk: this._sdk,
        event: payload.data,
      })
    })
  }

  unregister(): void {
    if (!this._unsubscribe) return
    this._unsubscribe()
    this._unsubscribe = null
  }
}

export const callbackListenerPlugin: SDKEventListenerPlugin & {
  optionsSchema: CallbackPluginOptionsSchemaFactory
} = {
  manifest: {
    id: CALLBACK_PACKAGE_ID,
    provides: ['event.listener'],
  },
  optionsSchema: createCallbackOptionsSchema,
  register(): void {
    // Discovery/schema surfaces use this lightweight export. Runtime loading
    // prefers `CallbackListenerPlugin` so each SDK gets its own listener instance.
  },
  unregister(): void {
    // No-op for the schema/discovery export.
  },
}

export const pluginManifest = {
  id: CALLBACK_PACKAGE_ID,
  capabilities: {
    'callback.runtime': [CALLBACK_PROVIDER_ID] as const,
  },
  integrations: ['event.listener'] as const,
} as const

export const optionsSchemas: Record<string, CallbackPluginOptionsSchemaFactory> = {
  [CALLBACK_PROVIDER_ID]: createCallbackOptionsSchema,
  [CALLBACK_PACKAGE_ID]: createCallbackOptionsSchema,
}

const callbackPluginPackage = {
  pluginManifest,
  callbackListenerPlugin,
  optionsSchemas,
}

export default callbackPluginPackage
