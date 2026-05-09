import {
  assertCallableCallbackModuleExport,
  buildCallbackExecutionPlan,
  buildCallbackHandlerRevisionInput,
  normalizeCallbackHandlers,
  resolveCallbackModuleTarget,
} from '../../kanban-lite/src/sdk/callbacks/core.ts'
import {
  createCloudflareCallbackQueueMessageEnvelope,
} from '../../kanban-lite/src/sdk/callbacks/cloudflare.ts'
import {
  createDurableCallbackDispatchMetadata,
  createDurableCallbackHandlerClaims,
  createDurableCallbackHandlerRevision,
  getDurableCallbackDispatchMetadata,
} from '../../kanban-lite/src/sdk/callbacks/contract.ts'
import { resolveCallbackRuntimeModule } from '../../kanban-lite/src/sdk/plugins/plugin-loader.ts'
import { readConfig } from '../../kanban-lite/src/shared/config/io.ts'

export const sdkRuntime = {
  assertCallableCallbackModuleExport,
  buildCallbackExecutionPlan,
  buildCallbackHandlerRevisionInput,
  createCloudflareCallbackQueueMessageEnvelope,
  createDurableCallbackDispatchMetadata,
  createDurableCallbackHandlerClaims,
  createDurableCallbackHandlerRevision,
  getDurableCallbackDispatchMetadata,
  normalizeCallbackHandlers,
  readConfig,
  resolveCallbackModuleTarget,
  resolveCallbackRuntimeModule,
}

export {
  assertCallableCallbackModuleExport,
  buildCallbackExecutionPlan,
  buildCallbackHandlerRevisionInput,
  createCloudflareCallbackQueueMessageEnvelope,
  createDurableCallbackDispatchMetadata,
  createDurableCallbackHandlerClaims,
  createDurableCallbackHandlerRevision,
  getDurableCallbackDispatchMetadata,
  normalizeCallbackHandlers,
  readConfig,
  resolveCallbackModuleTarget,
  resolveCallbackRuntimeModule,
}
