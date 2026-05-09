declare module './sdk-runtime.mjs' {
  export type KanbanSdkRuntimeModule = typeof import('kanban-lite/sdk')

  export const sdkRuntime: KanbanSdkRuntimeModule
  export const assertCallableCallbackModuleExport: KanbanSdkRuntimeModule['assertCallableCallbackModuleExport']
  export const buildCallbackExecutionPlan: KanbanSdkRuntimeModule['buildCallbackExecutionPlan']
  export const buildCallbackHandlerRevisionInput: KanbanSdkRuntimeModule['buildCallbackHandlerRevisionInput']
  export const createCloudflareCallbackQueueMessageEnvelope: KanbanSdkRuntimeModule['createCloudflareCallbackQueueMessageEnvelope']
  export const createDurableCallbackDispatchMetadata: KanbanSdkRuntimeModule['createDurableCallbackDispatchMetadata']
  export const createDurableCallbackHandlerClaims: KanbanSdkRuntimeModule['createDurableCallbackHandlerClaims']
  export const createDurableCallbackHandlerRevision: KanbanSdkRuntimeModule['createDurableCallbackHandlerRevision']
  export const getDurableCallbackDispatchMetadata: KanbanSdkRuntimeModule['getDurableCallbackDispatchMetadata']
  export const normalizeCallbackHandlers: KanbanSdkRuntimeModule['normalizeCallbackHandlers']
  export const readConfig: KanbanSdkRuntimeModule['readConfig']
  export const resolveCallbackModuleTarget: KanbanSdkRuntimeModule['resolveCallbackModuleTarget']
  export const resolveCallbackRuntimeModule: KanbanSdkRuntimeModule['resolveCallbackRuntimeModule']
}
